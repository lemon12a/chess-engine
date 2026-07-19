# model.py
import os
import torch
import torch.nn as nn
import torch.nn.functional as F

from board import ACTION_SPACE_SIZE


class ChessNet(nn.Module):
    def __init__(self):
        super(ChessNet, self).__init__()
        # Trích xuất đặc trưng không gian bàn cờ
        self.conv1 = nn.Conv2d(12, 64, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(64)
        
        # Nhánh Policy: xuất logits cho từng hành động trong không gian ACTION_SPACE_SIZE
        # (4096 nước đi thường/phong Hậu + 576 nước phong cấp Mã/Tượng/Xe - xem board.py)
        self.policy_conv = nn.Conv2d(64, 2, kernel_size=1)
        self.policy_fc = nn.Linear(2 * 8 * 8, ACTION_SPACE_SIZE)
        
        # Nhánh Value: Đánh giá điểm số thắng/thua [-1, 1]
        self.value_conv = nn.Conv2d(64, 1, kernel_size=1)
        self.value_fc1 = nn.Linear(1 * 8 * 8, 64)
        self.value_fc2 = nn.Linear(64, 1)

    def forward(self, x):
        x = F.relu(self.bn1(self.conv1(x)))
        
        # Tính xác suất chọn nước đi
        p = F.relu(self.policy_conv(x)).view(x.size(0), -1)
        policy_logits = self.policy_fc(p)
        
        # Tính giá trị thế trận
        v = F.relu(self.value_conv(x)).view(x.size(0), -1)
        v = F.relu(self.value_fc1(v))
        value = torch.tanh(self.value_fc2(v))
        
        return policy_logits, value


# ==== Lưu / tải checkpoint ====
# Trước đây chưa có cơ chế này -> mỗi lần chạy lại là mất hết, phải huấn luyện từ đầu.

def save_checkpoint(model, optimizer=None, iteration=0, checkpoint_dir="checkpoints"):
    """Lưu trọng số model (+ trạng thái optimizer nếu có) để dùng lại / huấn luyện tiếp sau này."""
    os.makedirs(checkpoint_dir, exist_ok=True)
    path = os.path.join(checkpoint_dir, f"checkpoint_iter{iteration}.pt")
    checkpoint = {
        "iteration": iteration,
        "model_state_dict": model.state_dict(),
    }
    if optimizer is not None:
        checkpoint["optimizer_state_dict"] = optimizer.state_dict()
    torch.save(checkpoint, path)
    return path


def load_checkpoint(path, model, optimizer=None, device="cpu"):
    """Tải checkpoint vào model (và optimizer nếu được truyền vào để huấn luyện tiếp)."""
    checkpoint = torch.load(path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])
    if optimizer is not None and "optimizer_state_dict" in checkpoint:
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    return checkpoint.get("iteration", 0)


def find_latest_checkpoint(checkpoint_dir="checkpoints"):
    """Tìm checkpoint có số iteration lớn nhất trong checkpoint_dir. Trả về None nếu chưa có checkpoint."""
    if not os.path.isdir(checkpoint_dir):
        return None
    files = [f for f in os.listdir(checkpoint_dir) if f.startswith("checkpoint_iter") and f.endswith(".pt")]
    if not files:
        return None
    files.sort(key=lambda f: int(f.replace("checkpoint_iter", "").replace(".pt", "")))
    return os.path.join(checkpoint_dir, files[-1])