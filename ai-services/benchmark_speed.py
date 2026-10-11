"""benchmark_speed.py — đo tốc độ self-play thật trên máy này, dùng để tính
--iterations/--games phù hợp cho 1 phiên train (vd qua đêm).

Chạy: python benchmark_speed.py
"""
import time
import torch
from model import ChessNet
from train import self_play_game

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Device:", device)
if device.type == "cuda":
    print("GPU:", torch.cuda.get_device_name(0))

model = ChessNet().to(device)
model.eval()

start = time.time()
data = self_play_game(model, num_simulations=40)
elapsed = time.time() - start

print(f"1 ván: {elapsed:.1f}s | {len(data)} nước đi | {elapsed/len(data):.2f}s/nước")
print(f"Ước tính 1 giờ chạy được: ~{3600/elapsed:.0f} ván (num_simulations=40)")
print("Lưu ý: lần đầu có độ trễ 'khởi động' CUDA, chạy lại 1-2 lần để lấy số chính xác hơn.")
