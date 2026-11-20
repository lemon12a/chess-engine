# train.py
"""
Vòng lặp huấn luyện kiểu AlphaZero cho ChessNet:
    Self-play (tự đối kháng bằng MCTS + model hiện tại, có Dirichlet noise ở gốc để
    tăng khám phá)
        -> thu thập dữ liệu (state, policy_target, value_target)
        -> huấn luyện mạng neural trên dữ liệu vừa thu được
        -> đấu loại (gating): candidate vừa train phải thắng đủ áp đảo "best" hiện tại
           mới được công nhận là best mới, tránh thoái hóa âm thầm
        -> lặp lại.

Cách chạy:
    python train.py                              # dùng tham số mặc định
    python train.py --iterations 20 --games 8 --simulations 60
    python train.py --iterations 40 --games 25 --simulations 40 --epochs 6 --checkpoint-every 5

Cấu trúc thư mục kết quả (mặc định, tính TƯƠNG ĐỐI THEO VỊ TRÍ FILE train.py, không
phụ thuộc bạn đứng ở thư mục nào khi chạy lệnh):
    ../results/checkpoints/        - checkpoint .pt, DÙNG CHUNG xuyên suốt mọi lần chạy
    ../results/training_<N>/       - log/CSV/biểu đồ RIÊNG của lần chạy thứ N
        training_log.txt
        training_metrics.csv       - loss (total/value/policy) + buffer size, theo bước gradient
        iteration_metrics.csv      - độ dài ván self-play TB + kết quả đấu loại, theo iteration
        training_curves.png        - vẽ bằng plot_training_curves.py sau khi train xong
Số N tự tăng dựa vào các thư mục training_<N> đã có sẵn trong ../results/ (dùng --run
để tự chỉ định nếu muốn).
"""
import os
import re
import sys
import csv
import random
import shutil
import argparse
from pathlib import Path
from collections import deque

import numpy as np
import chess
import torch
import torch.nn.functional as F
import torch.optim as optim

# Trên Windows, khi stdout không gắn trực tiếp với console, Python tự động dùng bảng
# mã hệ thống cũ (cp1252) thay vì UTF-8, gây lỗi UnicodeEncodeError với ký tự tiếng Việt.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from board import board_to_tensor, ACTION_SPACE_SIZE
from model import ChessNet, save_checkpoint, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search
from agents import MCTSAgent
from arena import play_match

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_RESULTS_DIR = str(SCRIPT_DIR.parent / "results")
DEFAULT_CHECKPOINT_DIR = str(SCRIPT_DIR.parent / "results" / "checkpoints")


class Tee:
    """Ghi đồng thời ra console và file log, LUÔN ở UTF-8 - không phụ thuộc vào
    encoding mặc định của PowerShell (hay là UTF-16LE, gây lỗi hiển thị tiếng
    Việt nếu dùng `| tee` của PowerShell thay vì ghi file trực tiếp như ở đây)."""
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()

    def flush(self):
        for s in self.streams:
            s.flush()


def get_next_run_number(results_dir):
    """Tự tìm số thứ tự lần chạy tiếp theo, dựa vào các thư mục training_<N> đã
    có sẵn trong results_dir. Không cần file đếm riêng, tự "lành" nếu có thư mục
    bị xoá giữa chừng."""
    pattern = re.compile(r"training_(\d+)$")
    existing = []
    if os.path.isdir(results_dir):
        for name in os.listdir(results_dir):
            m = pattern.match(name)
            if m and os.path.isdir(os.path.join(results_dir, name)):
                existing.append(int(m.group(1)))
    return max(existing, default=0) + 1


def log_row(csv_path, row, header):
    """Append 1 dòng vào file CSV, tự ghi header nếu file chưa tồn tại."""
    write_header = not os.path.isfile(csv_path)
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(header)
        writer.writerow(row)


def evaluate_and_promote(candidate_path, best_path, num_simulations, eval_games=10, win_threshold=0.55):
    """
    Đấu loại (gating) kiểu AlphaZero gốc: model vừa train (candidate) phải đấu với
    model tốt nhất đã được công nhận trước đó (best) và thắng đủ áp đảo (mặc định
    >=55% điểm số) mới được "thăng chức" thành best mới. Nếu không, best cũ được
    giữ nguyên - tránh tình trạng model bị thoái hóa mà không ai nhận ra.

    Trả về (promoted: bool, win_rate: float | None). win_rate=None khi chưa có best
    để so sánh (lần đầu tiên).
    """
    if not Path(best_path).exists():
        shutil.copy(candidate_path, best_path)
        print(f"Chưa có model best trước đó, dùng luôn {candidate_path} làm best.")
        return True, None

    candidate = MCTSAgent(checkpoint_path=candidate_path, num_simulations=num_simulations, name="candidate")
    best = MCTSAgent(checkpoint_path=best_path, num_simulations=num_simulations, name="best")

    print(f"Đấu loại: candidate ({Path(candidate_path).name}) vs best ({Path(best_path).name}), "
          f"{eval_games} ván...")
    results = play_match(candidate, best, num_games=eval_games, verbose=False)
    win_rate = results["win_rate_a"]
    print(f"Win rate candidate: {win_rate*100:.1f}% (ngưỡng để thắng: {win_threshold*100:.0f}%)")

    if win_rate >= win_threshold:
        shutil.copy(candidate_path, best_path)
        print("-> Candidate THẮNG, cập nhật best_checkpoint.pt")
        return True, win_rate

    print("-> Candidate chưa đủ mạnh, GIỮ NGUYÊN best cũ cho self-play vòng sau.")
    return False, win_rate


class ReplayBuffer:
    """
    Lưu các mẫu (state, policy_target, value_target) từ self-play để lấy mẫu ngẫu nhiên
    khi huấn luyện. deque(maxlen=capacity) tự động loại bỏ dữ liệu cũ nhất khi đầy.
    LƯU Ý: buffer chỉ tồn tại trong RAM của phiên chạy này - không được lưu/khôi phục
    khi resume từ checkpoint (chỉ model weights + optimizer state được lưu).
    """
    def __init__(self, capacity=20000):
        self.buffer = deque(maxlen=capacity)

    def push(self, samples):
        self.buffer.extend(samples)

    def sample(self, batch_size):
        batch_size = min(batch_size, len(self.buffer))
        return random.sample(self.buffer, batch_size)

    def __len__(self):
        return len(self.buffer)


def self_play_game(model, num_simulations=50, max_moves=200, temperature_moves=15):
    """
    Chơi 1 ván cờ hoàn chỉnh, cả 2 bên đều dùng MCTS + model hiện tại (tự đối kháng).
    add_root_noise=True ở lời gọi mcts_search bên dưới: CHỈ self-play mới bật Dirichlet
    noise ở node gốc - run_web.py (AI đánh thật với người) và agents.py (đánh giá/đấu
    loại) KHÔNG bật, để AI chơi "nghiêm túc" khi đối mặt thật sự.
    """
    board = chess.Board()
    history = []
    move_count = 0

    while not board.is_game_over(claim_draw=True) and move_count < max_moves:
        temperature = 1.0 if move_count < temperature_moves else 0.0

        move, policy_target = mcts_search(
            board, model,
            num_simulations=num_simulations,
            temperature=temperature,
            return_policy=True,
            add_root_noise=True,
        )

        history.append((board_to_tensor(board), policy_target, board.turn))
        board.push(move)
        move_count += 1

    if board.is_checkmate():
        white_pov_result = -1.0 if board.turn == chess.WHITE else 1.0
    else:
        white_pov_result = 0.0

    training_data = []
    for state_tensor, policy_target, side_to_move in history:
        value_target = white_pov_result if side_to_move == chess.WHITE else -white_pov_result
        training_data.append((state_tensor, policy_target, value_target))

    return training_data


def compute_loss(model, batch, device):
    """
    loss = value_loss (MSE) + policy_loss (cross-entropy dạng soft-label), vì
    policy_target là 1 PHÂN PHỐI xác suất (từ visit_count của MCTS), không phải nhãn
    lớp duy nhất.
    """
    state_batch = torch.cat([s for s, _, _ in batch], dim=0).to(device)
    policy_target_batch = torch.tensor(
        np.array([p for _, p, _ in batch]), dtype=torch.float32
    ).to(device)
    value_target_batch = torch.tensor(
        [v for _, _, v in batch], dtype=torch.float32
    ).unsqueeze(1).to(device)

    policy_logits, value_pred = model(state_batch)
    value_loss = F.mse_loss(value_pred, value_target_batch)
    log_probs = F.log_softmax(policy_logits, dim=1)
    policy_loss = -(policy_target_batch * log_probs).sum(dim=1).mean()
    total_loss = value_loss + policy_loss
    return total_loss, value_loss.item(), policy_loss.item()


def train(
    num_iterations=10,
    games_per_iteration=4,
    num_simulations=40,
    max_moves=200,
    temperature_moves=15,
    epochs_per_iteration=4,
    batch_size=32,
    buffer_capacity=20000,
    lr=1e-3,
    checkpoint_dir=DEFAULT_CHECKPOINT_DIR,
    checkpoint_every=1,
    resume=True,
    eval_games=10,
    win_threshold=0.55,
    run_dir=None,
):
    """
    Mỗi iteration gồm 3 giai đoạn: self-play -> học -> đấu loại (gating).
    run_dir: thư mục riêng của lần chạy này (vd ../results/training_3), nơi ghi
    training_metrics.csv/iteration_metrics.csv. Nếu None, dùng checkpoint_dir thay
    thế (không khuyến khích gọi trực tiếp kiểu này - khối __main__ luôn truyền run_dir).

    Giới hạn đã biết: self-play ở bước 1 dùng model ĐANG TRAIN, chưa đổi sang dùng
    best_checkpoint.pt đã qua gating - để nâng cấp sau, tránh đổi quá nhiều luồng dữ
    liệu cùng lúc.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Thiết bị: {device}")
    os.makedirs(checkpoint_dir, exist_ok=True)
    if run_dir:
        os.makedirs(run_dir, exist_ok=True)
    metrics_dir = run_dir or checkpoint_dir

    model = ChessNet().to(device)
    optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    buffer = ReplayBuffer(capacity=buffer_capacity)

    start_iteration = 1
    if resume:
        latest = find_latest_checkpoint(checkpoint_dir)
        if latest:
            last_iter = load_checkpoint(latest, model, optimizer, device=device)
            start_iteration = last_iter + 1
            print(f"Tiếp tục huấn luyện từ checkpoint: {latest} (iteration {start_iteration})")

    training_metrics_path = os.path.join(metrics_dir, "training_metrics.csv")
    iteration_metrics_path = os.path.join(metrics_dir, "iteration_metrics.csv")

    for iteration in range(start_iteration, start_iteration + num_iterations):
        # ----- Giai đoạn Self-play -----
        model.eval()
        iteration_game_lengths = []
        for game_idx in range(games_per_iteration):
            game_data = self_play_game(
                model, num_simulations=num_simulations,
                max_moves=max_moves, temperature_moves=temperature_moves,
            )
            buffer.push(game_data)
            iteration_game_lengths.append(len(game_data))
            print(f"[Iter {iteration}] Ván {game_idx + 1}/{games_per_iteration}: "
                  f"{len(game_data)} nước đi | buffer={len(buffer)}")

        if len(buffer) < batch_size:
            print("Buffer chưa đủ dữ liệu (< batch_size), bỏ qua bước học, tiếp tục self-play...")
            continue

        # ----- Giai đoạn huấn luyện -----
        model.train()
        for epoch in range(epochs_per_iteration):
            batch = buffer.sample(batch_size)
            optimizer.zero_grad()
            loss, v_loss, p_loss = compute_loss(model, batch, device)
            loss.backward()
            optimizer.step()
            print(f"[Iter {iteration}] Epoch {epoch + 1}/{epochs_per_iteration}: "
                  f"loss={loss.item():.4f} (value={v_loss:.4f}, policy={p_loss:.4f})")
            log_row(
                training_metrics_path,
                [iteration, epoch + 1, loss.item(), v_loss, p_loss, len(buffer)],
                header=["iteration", "epoch", "total_loss", "value_loss", "policy_loss", "buffer_size"],
            )

        # ----- Lưu checkpoint + đấu loại (gating) -----
        if iteration % checkpoint_every == 0:
            path = save_checkpoint(model, optimizer, iteration, checkpoint_dir)
            print(f"Đã lưu checkpoint: {path}")

            best_path = os.path.join(checkpoint_dir, "best_checkpoint.pt")
            promoted, win_rate = evaluate_and_promote(
                path, best_path, num_simulations=num_simulations,
                eval_games=eval_games, win_threshold=win_threshold,
            )
            print(f"Gating: {'THĂNG CHỨC' if promoted else 'giữ nguyên best cũ'} "
                  f"(win_rate={win_rate if win_rate is not None else 'N/A'})")

            avg_len = (sum(iteration_game_lengths) / len(iteration_game_lengths)
                       if iteration_game_lengths else 0)
            log_row(
                iteration_metrics_path,
                [iteration, avg_len, len(buffer), win_rate if win_rate is not None else ""],
                header=["iteration", "avg_game_length", "buffer_size", "eval_win_rate"],
            )

    print("Hoàn tất huấn luyện.")
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Huấn luyện ChessNet bằng self-play kiểu AlphaZero")
    parser.add_argument("--iterations", type=int, default=10, help="Số vòng lặp huấn luyện")
    parser.add_argument("--games", type=int, default=4, help="Số ván self-play mỗi vòng lặp")
    parser.add_argument("--simulations", type=int, default=40, help="Số simulation MCTS mỗi nước đi")
    parser.add_argument("--epochs", type=int, default=4, help="Số bước gradient mỗi vòng lặp")
    parser.add_argument("--batch-size", type=int, default=32, help="Kích thước batch huấn luyện")
    parser.add_argument("--buffer-capacity", type=int, default=20000, help="Dung lượng replay buffer")
    parser.add_argument("--lr", type=float, default=1e-3, help="Tốc độ học")
    parser.add_argument("--checkpoint-dir", type=str, default=DEFAULT_CHECKPOINT_DIR,
                         help="Thư mục checkpoint (dùng chung mọi lần chạy)")
    parser.add_argument("--results-dir", type=str, default=DEFAULT_RESULTS_DIR,
                         help="Thư mục gốc chứa các thư mục training_<N>")
    parser.add_argument("--no-resume", action="store_true", help="Huấn luyện lại từ đầu, không tải checkpoint cũ")
    parser.add_argument("--eval-games", type=int, default=10, help="Số ván đấu loại (gating) mỗi iteration")
    parser.add_argument("--win-threshold", type=float, default=0.55,
                         help="Tỉ lệ điểm tối thiểu để candidate được thăng chức thành best")
    parser.add_argument("--checkpoint-every", type=int, default=1, help="Lưu checkpoint + đấu loại mỗi N iteration")
    parser.add_argument("--run", type=int, default=None,
                         help="Số thứ tự lần chạy (mặc định: tự tăng dựa vào thư mục training_<N> đã có)")
    args = parser.parse_args()

    os.makedirs(args.results_dir, exist_ok=True)
    run_number = args.run if args.run is not None else get_next_run_number(args.results_dir)
    run_dir = os.path.join(args.results_dir, f"training_{run_number}")
    os.makedirs(run_dir, exist_ok=True)
    print(f"Lần chạy số: {run_number}  (log/biểu đồ lưu vào: {run_dir})")

    log_path = os.path.join(run_dir, "training_log.txt")
    log_file = open(log_path, "a", encoding="utf-8")
    sys.stdout = Tee(sys.stdout, log_file)
    sys.stderr = Tee(sys.stderr, log_file)

    train(
        num_iterations=args.iterations,
        games_per_iteration=args.games,
        num_simulations=args.simulations,
        epochs_per_iteration=args.epochs,
        batch_size=args.batch_size,
        buffer_capacity=args.buffer_capacity,
        lr=args.lr,
        checkpoint_dir=args.checkpoint_dir,
        resume=not args.no_resume,
        eval_games=args.eval_games,
        win_threshold=args.win_threshold,
        checkpoint_every=args.checkpoint_every,
        run_dir=run_dir,
    )
