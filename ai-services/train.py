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
    python train.py --iterations 40 --games 15 --simulations 40 --epochs 6 --batch-size 64

Mỗi iteration ghi thêm log vào checkpoint_dir:
    training_metrics.csv    - loss (total/value/policy) + buffer size, theo từng bước gradient
    iteration_metrics.csv   - độ dài ván self-play trung bình + kết quả đấu loại, theo iteration
Vẽ biểu đồ từ 2 file này bằng plot_training_curves.py.
"""
import os
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

class Tee:
    """Ghi đồng thời ra console và file log, luôn ở UTF-8 - không phụ thuộc
    vào encoding mặc định của PowerShell/cmd (vốn hay là UTF-16LE trên Windows,
    gây lỗi hiển thị tiếng Việt khi dùng `| tee`)."""
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()

    def flush(self):
        for s in self.streams:
            s.flush()

# Trên Windows, khi stdout không gắn trực tiếp với console (bị bọc trong
# Measure-Command, hoặc pipe qua Tee-Object/redirect ra file,...), Python tự
# động dùng bảng mã hệ thống cũ (cp1252) thay vì UTF-8, gây lỗi UnicodeEncodeError
# với các ký tự có dấu tiếng Việt (VD: "ế", "ệ"). Ép UTF-8 ngay từ đầu để tránh lỗi
# này bất kể script được chạy trực tiếp hay bị bọc/pipe qua lệnh khác.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from board import board_to_tensor, ACTION_SPACE_SIZE
from model import ChessNet, save_checkpoint, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search
from agents import MCTSAgent
from arena import play_match


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
    giữ nguyên - tránh tình trạng model bị thoái hóa (quên mất cái đã học tốt) mà
    không ai nhận ra vì train.py cứ lưu checkpoint mới nhất vô điều kiện.

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
    khi huấn luyện (phá vỡ tương quan giữa các vị trí liên tiếp trong cùng 1 ván đấu).
    deque(maxlen=capacity) tự động loại bỏ dữ liệu cũ nhất khi đầy.
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
    Ghi lại (state, policy_target) tại mỗi nước đi, sau đó gán value_target dựa trên
    kết quả cuối ván (theo góc nhìn của bên đang đi tại từng vị trí đã ghi lại).

    temperature_moves: số nước đầu tiên dùng temperature=1 (lấy mẫu theo visit_count)
    để tăng đa dạng/khám phá; các nước sau dùng temperature=0 (chọn nước tốt nhất) để
    mô phỏng lối chơi "nghiêm túc" hơn về cuối ván - đúng theo thông lệ AlphaZero.

    add_root_noise=True ở lời gọi mcts_search bên dưới: CHỈ self-play mới bật Dirichlet
    noise ở node gốc (xem giải thích đầy đủ trong mcts.py) - run_web.py (AI đánh thật
    với người) và agents.py (đánh giá/đấu loại) KHÔNG bật, để AI chơi "nghiêm túc" khi
    đối mặt thật sự, chỉ thêm nhiễu lúc tự sinh dữ liệu huấn luyện.
    """
    board = chess.Board()
    history = []  # [(state_tensor, policy_target, bên_đi_lúc_đó), ...]
    move_count = 0

    # claim_draw=True để chủ động dừng ván khi có thể claim hoà (lặp nước, luật 50 nước
    # không ăn quân/đi tốt,...), tránh self-play sinh ra các ván quá dài không cần thiết.
    # (mcts.py bên trong search KHÔNG dùng claim_draw=True, vì trong lúc dò cây, 1 draw
    # có thể claim được không có nghĩa là người chơi BẮT BUỘC phải nhận hoà ở đó).
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
        # board.turn là bên KHÔNG còn nước đi hợp lệ (vừa bị chiếu hết) -> bên đó thua
        white_pov_result = -1.0 if board.turn == chess.WHITE else 1.0
    else:
        # Hoà theo luật (lặp nước / 50 nước không ăn quân / hết vật chất / bí nước,...)
        # hoặc chạm max_moves -> đơn giản hoá, coi như hoà (0.0)
        white_pov_result = 0.0

    training_data = []
    for state_tensor, policy_target, side_to_move in history:
        value_target = white_pov_result if side_to_move == chess.WHITE else -white_pov_result
        training_data.append((state_tensor, policy_target, value_target))

    return training_data


def compute_loss(model, batch, device):
    """
    loss = value_loss (MSE) + policy_loss (cross-entropy dạng soft-label).
    policy_target là 1 PHÂN PHỐI xác suất (từ visit_count của MCTS), không phải 1 nhãn
    lớp duy nhất, nên không dùng nn.CrossEntropyLoss thông thường mà tự tính
    -sum(target * log_softmax(logits)), trung bình theo batch.
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
    checkpoint_dir="checkpoints",
    checkpoint_every=1,
    resume=True,
    eval_games=10,
    win_threshold=0.55,
):
    """
    Mỗi iteration gồm 3 giai đoạn:
      1. Self-play: chơi `games_per_iteration` ván bằng model hiện tại để lấy dữ liệu mới
         (có Dirichlet noise ở gốc để tăng khám phá - xem self_play_game)
      2. Học: lấy mẫu từ buffer, chạy `epochs_per_iteration` bước gradient để cập nhật model
      3. Đấu loại (gating): candidate vừa train đấu với best_checkpoint.pt hiện có;
         chỉ "thăng chức" nếu thắng đủ áp đảo (win_threshold) - xem evaluate_and_promote

    Đây vẫn là bản đơn giản hoá so với AlphaZero gốc (self-play ở bước 1 dùng model
    ĐANG TRAIN, không phải best_checkpoint.pt đã qua gating - việc đổi self-play sang
    dùng best model là bước nâng cấp tiếp theo, chưa làm ở bản này để tránh thay đổi
    quá nhiều luồng dữ liệu cùng lúc). Muốn huấn luyện ra 1 engine chơi tốt cần chạy
    rất nhiều iteration/game hơn nữa và nhiều thời gian/tài nguyên tính toán hơn đáng
    kể so với các giá trị mặc định ở đây.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Thiết bị: {device}")
    os.makedirs(checkpoint_dir, exist_ok=True)

    model = ChessNet().to(device)
    # weight_decay nhỏ giúp giảm overfitting, theo thông lệ huấn luyện AlphaZero
    optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
    buffer = ReplayBuffer(capacity=buffer_capacity)

    start_iteration = 1
    if resume:
        latest = find_latest_checkpoint(checkpoint_dir)
        if latest:
            last_iter = load_checkpoint(latest, model, optimizer, device=device)
            start_iteration = last_iter + 1
            print(f"Tiếp tục huấn luyện từ checkpoint: {latest} (iteration {start_iteration})")

    training_metrics_path = os.path.join(checkpoint_dir, "training_metrics.csv")
    iteration_metrics_path = os.path.join(checkpoint_dir, "iteration_metrics.csv")

    for iteration in range(start_iteration, start_iteration + num_iterations):
        # ----- Giai đoạn Self-play -----
        model.eval()  # self-play chỉ dùng để suy luận, không cập nhật thống kê BatchNorm
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
    parser.add_argument("--lr", type=float, default=1e-3, help="Tốc độ học")
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints", help="Thư mục lưu checkpoint")
    parser.add_argument("--no-resume", action="store_true", help="Huấn luyện lại từ đầu, không tải checkpoint cũ")
    parser.add_argument("--eval-games", type=int, default=10, help="Số ván đấu loại (gating) mỗi iteration")
    parser.add_argument("--win-threshold", type=float, default=0.55,
                         help="Tỉ lệ điểm tối thiểu để candidate được thăng chức thành best")
    parser.add_argument("--checkpoint-every", type=int, default=1, help="Lưu checkpoint + đấu loại mỗi N iteration")
    args = parser.parse_args()

    train(
        num_iterations=args.iterations,
        games_per_iteration=args.games,
        num_simulations=args.simulations,
        epochs_per_iteration=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        checkpoint_dir=args.checkpoint_dir,
        resume=not args.no_resume,
        eval_games=args.eval_games,
        win_threshold=args.win_threshold,
        checkpoint_every=args.checkpoint_every,
    )
