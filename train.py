# train.py
"""
Vòng lặp huấn luyện kiểu AlphaZero cho ChessNet:
    Self-play (tự đối kháng bằng MCTS + model hiện tại)
        -> thu thập dữ liệu (state, policy_target, value_target)
        -> huấn luyện mạng neural trên dữ liệu vừa thu được
        -> lặp lại với model đã cập nhật.

Cách chạy:
    python train.py                              # dùng tham số mặc định
    python train.py --iterations 20 --games 8 --simulations 60
"""
import random
import argparse
from collections import deque

import numpy as np
import chess
import torch
import torch.nn.functional as F
import torch.optim as optim

from board import board_to_tensor, ACTION_SPACE_SIZE
from model import ChessNet, save_checkpoint, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search


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
):
    """
    Mỗi iteration gồm 2 giai đoạn:
      1. Self-play: chơi `games_per_iteration` ván bằng model hiện tại để lấy dữ liệu mới
      2. Học: lấy mẫu từ buffer, chạy `epochs_per_iteration` bước gradient để cập nhật model

    Đây là bản đơn giản hoá (chạy tuần tự, 1 model, không có bước evaluation model
    mới-vs-cũ như AlphaZero gốc) - phù hợp để demo/thử nghiệm trên máy cá nhân. Muốn
    huấn luyện ra 1 engine chơi tốt cần chạy rất nhiều iteration/game hơn nữa và nhiều
    thời gian/tài nguyên tính toán hơn đáng kể so với các giá trị mặc định ở đây.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Thiết bị: {device}")

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

    for iteration in range(start_iteration, start_iteration + num_iterations):
        # ----- Giai đoạn Self-play -----
        model.eval()  # self-play chỉ dùng để suy luận, không cập nhật thống kê BatchNorm
        for game_idx in range(games_per_iteration):
            game_data = self_play_game(
                model, num_simulations=num_simulations,
                max_moves=max_moves, temperature_moves=temperature_moves,
            )
            buffer.push(game_data)
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

        if iteration % checkpoint_every == 0:
            path = save_checkpoint(model, optimizer, iteration, checkpoint_dir)
            print(f"Đã lưu checkpoint: {path}")

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
    )