# main.py
import sys
import chess
from model import ChessNet, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search

# Ép UTF-8 cho stdout/stderr để tránh lỗi UnicodeEncodeError trên Windows khi output
# bị pipe/redirect (xem giải thích chi tiết trong train.py)
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

def run_engine_demo():
    # Khởi tạo bàn cờ tiêu chuẩn 8x8
    board = chess.Board()
    
    # Tải mô hình não bộ
    model = ChessNet()

    # Nếu đã chạy train.py và có checkpoint đã lưu thì tải trọng số đó lên; nếu chưa thì
    # dùng trọng số khởi tạo ngẫu nhiên (engine sẽ chơi rất yếu, gần như ngẫu nhiên)
    checkpoint_path = find_latest_checkpoint()
    if checkpoint_path:
        load_checkpoint(checkpoint_path, model)
        print(f"Đã tải checkpoint: {checkpoint_path}")
    else:
        print("Chưa có checkpoint, dùng trọng số khởi tạo ngẫu nhiên "
              "(chạy `python train.py` để huấn luyện model).")

    model.eval() # Chuyển sang chế độ suy luận (Inference)

    # Kiểm tra nhanh: engine gợi ý nước đi gì ở vị trí khởi đầu chuẩn
    best_move = mcts_search(board, model, num_simulations=40)
    print(f"Engine gợi ý nước đi tối ưu: {best_move}")

if __name__ == "__main__":
    run_engine_demo()