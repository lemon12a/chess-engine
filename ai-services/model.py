# model.py
"""
File này BỊ THIẾU trong bộ code bạn gửi (board.py, main.py, mcts.py, train.py đều import
từ `model` nhưng không có file model.py nào được tải lên) - đây là file mình viết bổ sung
để cả pipeline chạy được.

Kiến trúc: ResNet thu nhỏ (6 residual block x 64 filter) thay vì 19-40 block x 256 filter
như AlphaZero gốc, để vừa VRAM của GPU laptop tầm trung (GTX 1650/1660, RTX 3050, ~4-6GB).
Nếu sau này thấy GPU còn dư nhiều bộ nhớ, có thể tăng NUM_RES_BLOCKS/NUM_FILTERS ở dưới.
"""
import os
import glob

import torch
import torch.nn as nn
import torch.nn.functional as F

# Phải khớp với board.py: 12 plane quân cờ + 1 plane lượt đi (xem giải thích trong
# board_to_tensor()) = 13 kênh đầu vào.
INPUT_CHANNELS = 13
NUM_RES_BLOCKS = 6
NUM_FILTERS = 64
ACTION_SPACE_SIZE = 4672  # phải khớp board.ACTION_SPACE_SIZE


class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = out + residual
        return F.relu(out)


class ChessNet(nn.Module):
    """
    Input:  (batch, INPUT_CHANNELS, 8, 8)
    Output: (policy_logits, value)
        policy_logits: (batch, ACTION_SPACE_SIZE) - chưa qua softmax, mcts.py tự
                       mask nước bất hợp lệ rồi mới softmax
        value:         (batch, 1), trong khoảng [-1, 1] nhờ tanh, theo góc nhìn
                       của bên ĐANG ĐẾN LƯỢT (board.turn) tại vị trí input
    """
    def __init__(self, input_channels=INPUT_CHANNELS, num_filters=NUM_FILTERS,
                 num_res_blocks=NUM_RES_BLOCKS, action_space_size=ACTION_SPACE_SIZE):
        super().__init__()
        self.conv_in = nn.Conv2d(input_channels, num_filters, kernel_size=3, padding=1, bias=False)
        self.bn_in = nn.BatchNorm2d(num_filters)
        self.res_blocks = nn.ModuleList(
            [ResidualBlock(num_filters) for _ in range(num_res_blocks)]
        )

        # Policy head
        self.policy_conv = nn.Conv2d(num_filters, 2, kernel_size=1, bias=False)
        self.policy_bn = nn.BatchNorm2d(2)
        self.policy_fc = nn.Linear(2 * 8 * 8, action_space_size)

        # Value head
        self.value_conv = nn.Conv2d(num_filters, 1, kernel_size=1, bias=False)
        self.value_bn = nn.BatchNorm2d(1)
        self.value_fc1 = nn.Linear(8 * 8, 64)
        self.value_fc2 = nn.Linear(64, 1)

    def forward(self, x):
        x = F.relu(self.bn_in(self.conv_in(x)))
        for block in self.res_blocks:
            x = block(x)

        p = F.relu(self.policy_bn(self.policy_conv(x)))
        p = p.reshape(p.size(0), -1)
        policy_logits = self.policy_fc(p)

        v = F.relu(self.value_bn(self.value_conv(x)))
        v = v.reshape(v.size(0), -1)
        v = F.relu(self.value_fc1(v))
        value = torch.tanh(self.value_fc2(v))

        return policy_logits, value


def save_checkpoint(model, optimizer, iteration, checkpoint_dir="checkpoints"):
    os.makedirs(checkpoint_dir, exist_ok=True)
    path = os.path.join(checkpoint_dir, f"checkpoint_{iteration:05d}.pt")
    torch.save({
        "iteration": iteration,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict() if optimizer is not None else None,
    }, path)
    return path


def load_checkpoint(path, model, optimizer=None, device="cpu"):
    """
    main.py gọi load_checkpoint(path, model)  - chỉ 2 tham số, không cần optimizer
    train.py gọi load_checkpoint(path, model, optimizer, device=device) - đủ 4 tham số
    Hàm này hỗ trợ cả 2 cách gọi nhờ optimizer/device có giá trị mặc định.
    """
    checkpoint = torch.load(path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])
    if optimizer is not None and checkpoint.get("optimizer_state_dict") is not None:
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
    return checkpoint.get("iteration", 0)


def find_latest_checkpoint(checkpoint_dir="checkpoints"):
    if not os.path.isdir(checkpoint_dir):
        return None
    files = glob.glob(os.path.join(checkpoint_dir, "checkpoint_*.pt"))
    if not files:
        return None
    return max(files, key=os.path.getmtime)