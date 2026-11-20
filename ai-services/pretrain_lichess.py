# pretrain_lichess.py
"""
Pretrain ChessNet bằng ván cờ thật của Lichess (học có giám sát / imitation learning),
để model KHÔNG bắt đầu self-play từ trọng số ngẫu nhiên.

Với mỗi nước đi trong 1 ván Lichess:
    - đầu vào  : thế cờ TRƯỚC nước đó, mã hoá y hệt board.board_to_tensor() (13 plane)
    - nhãn policy: nước người chơi thực tế đã đi (move_to_index)  -> cross-entropy
    - nhãn value : kết quả ván đấu theo góc nhìn của BÊN ĐANG ĐẾN LƯỢT (+1/0/-1) -> MSE
Đúng quy ước của model.py/mcts.py/train.py nên checkpoint sinh ra nạp thẳng vào
vòng self-play được.

Nguồn dữ liệu (--pgn nhận đường dẫn file HOẶC URL, định dạng .pgn / .pgn.zst / .zip):
    * https://database.lichess.org/            (toàn bộ ván của Lichess, mỗi tháng 1 file .pgn.zst)
    * https://database.nikonoel.fr/            (Lichess Elite: ván của người chơi rất mạnh, file .zip nhỏ)
Script đọc kiểu STREAMING và dừng khi đủ dữ liệu (--max-positions / --max-games), nên
không cần tải trọn 1 file tháng của Lichess về.

Chạy thử (rất nhanh, không cần dữ liệu ngoài):
    python pretrain_lichess.py --selftest

Chạy thật (ví dụ):
    pip install zstandard
    python pretrain_lichess.py \
        --pgn https://database.lichess.org/standard/lichess_db_standard_rated_2017-01.pgn.zst \
        --min-elo 2000 --max-positions 2000000 --epochs 2 \
        --cache /content/drive/MyDrive/chess-engine/lichess_2017-01_2000.npz

Kết quả (mặc định ../results/pretrain/):
    checkpoint_00000.pt / pretrained_lichess.pt   - trọng số sau pretrain (optimizer=None)
    pretrain_metrics.csv                          - loss/độ chính xác theo bước (để vẽ biểu đồ báo cáo)
    pretrain_summary.json                         - cấu hình, thống kê dữ liệu, số tham số, kết quả cuối
"""
import argparse
import csv
import io
import json
import math
import os
import random
import shutil
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import chess
import chess.pgn
import torch
import torch.nn.functional as F

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from board import move_to_index, board_to_tensor
from model import ChessNet, save_checkpoint

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = str(SCRIPT_DIR.parent / "results" / "pretrain")

RESULT_TO_WHITE = {"1-0": 1, "0-1": -1, "1/2-1/2": 0}

# Mã quân 1..12 = plane_idx + 1 của board_to_tensor (0 = ô trống). Lưu bàn cờ dạng uint8[64]
# thay vì tensor float 13x8x8 để 2-3 triệu thế cờ vẫn vừa RAM/VRAM; giải mã sang tensor
# ngay trên GPU theo từng batch (decode_batch).
_PIECE_ORDER = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]
_CODE = {(pt, color): _PIECE_ORDER.index(pt) + (6 if color == chess.BLACK else 0) + 1
         for pt in _PIECE_ORDER for color in (chess.WHITE, chess.BLACK)}


# ----------------------------------------------------------------------------------------
# Mã hoá
# ----------------------------------------------------------------------------------------
def decode_batch(boards_u8, turns_u8):
    """(B,64) uint8 + (B,) uint8 -> (B,13,8,8) float32, GIỐNG HỆT board_to_tensor().
    Chỉ số ô square = row*8+col (row = hàng/rank) nên reshape thẳng (12,64)->(12,8,8) là đúng."""
    planes = F.one_hot(boards_u8.long(), 13)[..., 1:]            # (B,64,12)
    planes = planes.permute(0, 2, 1).float().reshape(-1, 12, 8, 8)
    turn = turns_u8.float().view(-1, 1, 1, 1).expand(-1, 1, 8, 8)  # 1.0 nếu Trắng đi
    return torch.cat([planes, turn], dim=1)


# ----------------------------------------------------------------------------------------
# Đọc PGN kiểu streaming + lọc
# ----------------------------------------------------------------------------------------
def open_text_stream(src):
    if src.startswith(("http://", "https://")):
        req = urllib.request.Request(src, headers={"User-Agent": "chess-platform-pretrain/1.0"})
        raw = urllib.request.urlopen(req)
    elif src.lower().endswith(".zip"):
        zf = zipfile.ZipFile(src)
        names = [n for n in zf.namelist() if n.lower().endswith(".pgn")]
        if not names:
            raise SystemExit(f"Không thấy file .pgn bên trong {src}")
        raw = zf.open(names[0])
    else:
        raw = open(src, "rb")
    if src.lower().endswith(".zst"):
        try:
            import zstandard
        except ImportError:
            raise SystemExit("Thiếu thư viện zstandard. Chạy: pip install zstandard")
        raw = zstandard.ZstdDecompressor().stream_reader(raw)
    return io.TextIOWrapper(raw, encoding="utf-8", errors="replace")


def make_accept(args, stats):
    """Quyết định (chỉ dựa vào header) có lấy ván này không."""
    def accept(h):
        stats["games_scanned"] += 1
        if h.get("Result") not in RESULT_TO_WHITE:
            return False
        try:
            white_elo, black_elo = int(h.get("WhiteElo", "")), int(h.get("BlackElo", ""))
        except ValueError:
            return False
        if min(white_elo, black_elo) < args.min_elo:
            return False
        if not args.allow_bots and "BOT" in (h.get("WhiteTitle", ""), h.get("BlackTitle", "")):
            return False
        # Ván thua do hết giờ/bỏ cuộc: kết quả không phản ánh thế cờ -> làm nhiễu nhãn value
        if not args.allow_abnormal and h.get("Termination", "Normal") != "Normal":
            return False
        if not args.allow_bullet:
            tc = h.get("TimeControl", "-")
            if "+" in tc:
                try:
                    base, inc = tc.split("+")
                    if int(base) + 40 * int(inc) < 180:   # cách Lichess phân loại bullet
                        return False
                except ValueError:
                    pass
        return True
    return accept


class _FilterBuilder(chess.pgn.GameBuilder):
    """Bỏ qua phần nước đi của ván không đạt bộ lọc -> đọc rất nhanh."""
    def __init__(self, accept):
        super().__init__()
        self._accept = accept

    def end_headers(self):
        if not self._accept(self.game.headers):
            return chess.pgn.SKIP
        return None


def collect_data(args):
    stats = {"games_scanned": 0}
    accept = make_accept(args, stats)
    boards_l, turns_l, moves_l, values_l, gid_l = [], [], [], [], []
    avg_elos, game_plies = [], []
    results = {"1-0": 0, "0-1": 0, "1/2-1/2": 0}
    n_pos, game_id, t0 = 0, 0, time.time()

    print(f"Đọc dữ liệu từ: {args.pgn}")
    stream = open_text_stream(args.pgn)
    try:
        while (n_pos < args.max_positions and game_id < args.max_games
               and stats["games_scanned"] < args.max_scan_games):
            try:
                game = chess.pgn.read_game(stream, Visitor=lambda: _FilterBuilder(accept))
            except Exception as e:   # mất mạng / dữ liệu hỏng giữa chừng: giữ phần đã đọc
                print(f"Dừng đọc do lỗi: {e!r}")
                break
            if game is None:
                break
            moves = list(game.mainline_moves())
            if len(moves) < args.min_plies:
                continue

            white_v = RESULT_TO_WHITE[game.headers["Result"]]
            n = len(moves)
            bs = np.zeros((n, 64), dtype=np.uint8)
            ts = np.zeros(n, dtype=np.uint8)
            ms = np.zeros(n, dtype=np.int16)
            vs = np.zeros(n, dtype=np.int8)
            board = game.board()
            try:
                for i, mv in enumerate(moves):
                    for sq, p in board.piece_map().items():
                        bs[i, sq] = _CODE[(p.piece_type, p.color)]
                    white_to_move = board.turn == chess.WHITE
                    ts[i] = 1 if white_to_move else 0
                    ms[i] = move_to_index(mv)
                    vs[i] = white_v if white_to_move else -white_v
                    board.push(mv)
            except Exception:
                continue   # ván lỗi (nước đi bất hợp lệ...) -> bỏ cả ván

            n_total = n
            if args.ply_stride > 1:   # lấy mỗi ply_stride nước (lệch ngẫu nhiên mỗi ván) -> nhiều ván hơn cho cùng số thế cờ
                keep = np.arange(random.randrange(args.ply_stride), n, args.ply_stride)
                if len(keep) == 0:
                    continue
                bs, ts, ms, vs = bs[keep], ts[keep], ms[keep], vs[keep]
                n = len(keep)
            boards_l.append(bs); turns_l.append(ts); moves_l.append(ms); values_l.append(vs)
            gid_l.append(np.full(n, game_id, dtype=np.int32))
            avg_elos.append((int(game.headers["WhiteElo"]) + int(game.headers["BlackElo"])) / 2)
            game_plies.append(n_total)
            results[game.headers["Result"]] += 1
            n_pos += n
            game_id += 1
            if game_id % 500 == 0:
                print(f"  giữ {game_id} ván / quét {stats['games_scanned']} ván | "
                      f"{n_pos:,} thế cờ | {time.time() - t0:.0f}s")
    finally:
        stream.close()

    if n_pos == 0:
        raise SystemExit("Không lấy được thế cờ nào. Thử hạ --min-elo, bật --allow-bullet, "
                         "hoặc kiểm tra lại --pgn.")

    data = {
        "boards": np.concatenate(boards_l), "turns": np.concatenate(turns_l),
        "moves": np.concatenate(moves_l), "values": np.concatenate(values_l),
        "game_ids": np.concatenate(gid_l),
    }
    info = {
        "source": args.pgn, "min_elo": args.min_elo,
        "games_scanned": stats["games_scanned"], "games_kept": game_id, "positions": n_pos,
        "results": results,
        "avg_plies_per_game": float(np.mean(game_plies)),
        "avg_elo_mean": float(np.mean(avg_elos)),
        "avg_elo_min": float(np.min(avg_elos)), "avg_elo_max": float(np.max(avg_elos)),
        "read_seconds": round(time.time() - t0, 1),
    }
    print(f"Xong: {game_id} ván, {n_pos:,} thế cờ (quét {stats['games_scanned']} ván, "
          f"{info['read_seconds']}s)")
    return data, info


def load_or_collect(args):
    if args.cache and os.path.isfile(args.cache) and not args.rebuild:
        print(f"Nạp cache: {args.cache}")
        z = np.load(args.cache, allow_pickle=False)
        data = {k: z[k] for k in ("boards", "turns", "moves", "values", "game_ids")}
        info = json.loads(str(z["info"]))
        return data, info
    if not args.pgn:
        raise SystemExit("Cần --pgn (hoặc --cache trỏ tới file đã tạo trước đó).")
    data, info = collect_data(args)
    if args.cache:
        os.makedirs(os.path.dirname(os.path.abspath(args.cache)), exist_ok=True)
        np.savez_compressed(args.cache, info=json.dumps(info), **data)
        print(f"Đã lưu cache: {args.cache}")
    return data, info


# ----------------------------------------------------------------------------------------
# Huấn luyện
# ----------------------------------------------------------------------------------------
def split_indices(game_ids, val_games, max_val_positions):
    """Tách train/val THEO VÁN (không theo thế cờ) - thế cờ cùng 1 ván rất giống nhau nên
    tách theo thế cờ sẽ làm số đo trên tập val đẹp giả tạo."""
    n_games = int(game_ids.max()) + 1
    val_games = min(val_games, max(1, n_games // 10))
    cut = n_games - val_games
    train_idx = np.nonzero(game_ids < cut)[0]
    val_idx = np.nonzero(game_ids >= cut)[0]
    stride = max(1, len(val_idx) // max_val_positions)
    return train_idx, val_idx[::stride], val_games


@torch.no_grad()
def evaluate(model, boards, turns, moves, values, idx, batch=2048):
    model.eval()
    n = len(idx)
    p_sum = v_sum = top1 = top5 = sign_ok = sign_n = 0
    for i in range(0, n, batch):
        j = idx[i:i + batch]
        x = decode_batch(boards[j], turns[j])
        y = moves[j].long()
        z = values[j].float()
        logits, v = model(x)
        v = v.squeeze(1)
        p_sum += F.cross_entropy(logits, y, reduction="sum").item()
        v_sum += F.mse_loss(v, z, reduction="sum").item()
        top = logits.topk(5, dim=1).indices
        top1 += (top[:, 0] == y).sum().item()
        top5 += (top == y[:, None]).any(dim=1).sum().item()
        nz = z != 0
        sign_ok += ((v > 0) == (z > 0))[nz].sum().item()
        sign_n += nz.sum().item()
    return {
        "val_policy_loss": p_sum / n, "val_value_mse": v_sum / n,
        "val_top1": top1 / n, "val_top5": top5 / n,
        "val_value_sign_acc": (sign_ok / sign_n) if sign_n else float("nan"),
    }


def run_training(data, info, args, device, out_dir):
    boards = torch.from_numpy(data["boards"]).to(device)
    turns = torch.from_numpy(data["turns"]).to(device)
    moves = torch.from_numpy(data["moves"]).to(device)
    values = torch.from_numpy(data["values"]).to(device)

    tr_np, va_np, val_games = split_indices(data["game_ids"], args.val_games, args.max_val_positions)
    train_idx = torch.from_numpy(tr_np).to(device)
    val_idx = torch.from_numpy(va_np).to(device)
    # MSE nếu model luôn đoán value = 0: mốc tối thiểu để biết value head có học được gì không
    baseline_mse = float((values[val_idx].float() ** 2).mean().item())
    print(f"Train: {len(tr_np):,} thế cờ | Val: {len(va_np):,} thế cờ ({val_games} ván giữ lại) | "
          f"MSE mốc (đoán 0): {baseline_mse:.3f}")

    model = ChessNet().to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Số tham số ChessNet: {n_params:,}")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    steps_per_epoch = max(1, len(train_idx) // args.batch_size)
    total_steps = steps_per_epoch * args.epochs
    warmup = min(300, total_steps // 10)

    def lr_lambda(step):
        if warmup > 0 and step < warmup:
            return (step + 1) / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * progress))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)

    csv_path = os.path.join(out_dir, "pretrain_metrics.csv")
    if os.path.exists(csv_path):
        os.remove(csv_path)
    header = ["step", "epoch", "lr", "train_policy_loss", "train_value_loss", "val_policy_loss",
              "val_value_mse", "val_top1", "val_top5", "val_value_sign_acc", "elapsed_sec"]

    step, run_p, run_v, run_n, last = 0, 0.0, 0.0, 0, {}
    t0 = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = train_idx[torch.randperm(len(train_idx), device=device)]
        for b in range(steps_per_epoch):
            j = perm[b * args.batch_size:(b + 1) * args.batch_size]
            x = decode_batch(boards[j], turns[j])
            y = moves[j].long()
            z = values[j].float().unsqueeze(1)

            logits, v = model(x)
            p_loss = F.cross_entropy(logits, y, label_smoothing=args.label_smoothing)
            v_loss = F.mse_loss(v, z)
            loss = p_loss + args.value_weight * v_loss

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()

            step += 1
            run_p += p_loss.item(); run_v += v_loss.item(); run_n += 1
            if step % args.eval_every == 0 or step == total_steps:
                m = evaluate(model, boards, turns, moves, values, val_idx)
                last = {"step": step, "epoch": epoch, "lr": sched.get_last_lr()[0],
                        "train_policy_loss": run_p / run_n, "train_value_loss": run_v / run_n,
                        "elapsed_sec": round(time.time() - t0, 1), **m}
                write_header = not os.path.exists(csv_path)
                with open(csv_path, "a", newline="", encoding="utf-8") as f:
                    w = csv.writer(f)
                    if write_header:
                        w.writerow(header)
                    w.writerow([last[h] for h in header])
                print(f"[ep {epoch}/{args.epochs} step {step}/{total_steps}] "
                      f"train p={last['train_policy_loss']:.3f} v={last['train_value_loss']:.3f} | "
                      f"val p={m['val_policy_loss']:.3f} v={m['val_value_mse']:.3f} "
                      f"top1={m['val_top1']*100:.1f}% top5={m['val_top5']*100:.1f}% "
                      f"dấu-value={m['val_value_sign_acc']*100:.1f}% | {last['elapsed_sec']:.0f}s")
                run_p = run_v = 0.0; run_n = 0
                model.train()
        save_checkpoint(model, None, 0, out_dir)   # ghi đè sau mỗi epoch: phòng Colab ngắt giữa chừng

    ckpt = os.path.join(out_dir, "checkpoint_00000.pt")
    shutil.copy(ckpt, os.path.join(out_dir, "pretrained_lichess.pt"))

    summary = {
        "args": vars(args), "data": info, "num_parameters": n_params,
        "train_positions": int(len(tr_np)), "val_positions": int(len(va_np)), "val_games": val_games,
        "val_value_baseline_mse": baseline_mse, "final": last,
        "train_seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(out_dir, "pretrain_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    return model


# ----------------------------------------------------------------------------------------
def selftest():
    """Kiểm tra nhanh: decode_batch khớp board_to_tensor, và 1 bước forward/backward chạy được."""
    rng = random.Random(0)
    board, snaps = chess.Board(), []
    for _ in range(120):
        if board.is_game_over():
            board = chess.Board()
        snaps.append(board.copy())
        board.push(rng.choice(list(board.legal_moves)))
    bs = np.zeros((len(snaps), 64), dtype=np.uint8)
    ts = np.zeros(len(snaps), dtype=np.uint8)
    for i, b in enumerate(snaps):
        for sq, p in b.piece_map().items():
            bs[i, sq] = _CODE[(p.piece_type, p.color)]
        ts[i] = 1 if b.turn == chess.WHITE else 0
    mine = decode_batch(torch.from_numpy(bs), torch.from_numpy(ts))
    ref = torch.cat([board_to_tensor(b) for b in snaps], dim=0)
    assert mine.shape == ref.shape and torch.equal(mine, ref), "decode_batch KHÁC board_to_tensor!"
    print(f"OK: decode_batch khớp board_to_tensor trên {len(snaps)} thế cờ")

    model = ChessNet()
    logits, v = model(mine[:32])
    y = torch.randint(0, logits.shape[1], (32,))
    loss = F.cross_entropy(logits, y) + F.mse_loss(v.squeeze(1), torch.zeros(32))
    loss.backward()
    print(f"OK: forward/backward chạy được (loss={loss.item():.3f}, "
          f"{sum(p.numel() for p in model.parameters()):,} tham số)")


def main():
    ap = argparse.ArgumentParser(description="Pretrain ChessNet từ ván cờ Lichess")
    ap.add_argument("--selftest", action="store_true", help="Chỉ kiểm tra mã hoá + forward/backward rồi thoát")
    ap.add_argument("--pgn", type=str, default=None, help="Đường dẫn hoặc URL .pgn/.pgn.zst/.zip")
    ap.add_argument("--cache", type=str, default=None, help="File .npz lưu dữ liệu đã xử lý (dùng lại lần sau)")
    ap.add_argument("--rebuild", action="store_true", help="Đọc lại PGN dù đã có cache")
    ap.add_argument("--out-dir", type=str, default=DEFAULT_OUT_DIR)
    # lọc dữ liệu
    ap.add_argument("--min-elo", type=int, default=2000, help="Elo tối thiểu của CẢ HAI người chơi")
    ap.add_argument("--max-games", type=int, default=1_000_000)
    ap.add_argument("--max-positions", type=int, default=2_000_000)
    ap.add_argument("--max-scan-games", type=int, default=3_000_000, help="Trần số ván được quét (kể cả ván bị loại)")
    ap.add_argument("--min-plies", type=int, default=10, help="Bỏ ván ngắn hơn số nửa-nước này")
    ap.add_argument("--ply-stride", type=int, default=1,
                    help="Chỉ lấy mỗi N nước của mỗi ván (1 = lấy hết). N=4: nhiều ván hơn 4 lần cho cùng số thế cờ")
    ap.add_argument("--allow-bullet", action="store_true")
    ap.add_argument("--allow-bots", action="store_true")
    ap.add_argument("--allow-abnormal", action="store_true", help="Giữ cả ván hết giờ/bỏ cuộc")
    # huấn luyện
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--batch-size", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--weight-decay", type=float, default=1e-4)
    ap.add_argument("--value-weight", type=float, default=1.0)
    ap.add_argument("--label-smoothing", type=float, default=0.0)
    ap.add_argument("--val-games", type=int, default=1000)
    ap.add_argument("--max-val-positions", type=int, default=100_000)
    ap.add_argument("--eval-every", type=int, default=500)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    if args.selftest:
        selftest()
        return

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("Thiết bị:", device)
    os.makedirs(args.out_dir, exist_ok=True)

    data, info = load_or_collect(args)
    run_training(data, info, args, device, args.out_dir)

    print("\nHoàn tất pretrain. Bước tiếp theo (xem hướng dẫn): đưa pretrained_lichess.pt vào "
          "results/checkpoints/ dưới tên checkpoint_00000.pt và best_checkpoint.pt rồi chạy train.py.")


if __name__ == "__main__":
    main()