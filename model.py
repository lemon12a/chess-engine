# model.py
import torch
import torch.nn as nn
import torch.nn.functional as F

class ChessNet(nn.Module):
    def __init__(self):
        super(ChessNet, self).__init__()
        # Trích xuất đặc trưng không gian bàn cờ
        self.conv1 = nn.Conv2d(12, 64, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm2d(64)
        
        # Nhánh Policy: Xuất xác suất nước đi (4096 hành động)
        self.policy_conv = nn.Conv2d(64, 2, kernel_size=1)
        self.policy_fc = nn.Linear(2 * 8 * 8, 4096)
        
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