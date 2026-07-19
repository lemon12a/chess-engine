# main.py
import chess
from model import ChessNet, load_checkpoint, find_latest_checkpoint
from mcts import mcts_search

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
    
    print("Khởi tạo ván cờ vua mới:")
    print(board)
    print("-" * 30)
    
    # Giả lập Engine đi nước đầu tiên
    best_move = mcts_search(board, model, num_simulations=40)
    print(f"Engine gợi ý nước đi tối ưu: {best_move}")
    
    # Đẩy nước đi vào bàn cờ thực tế
    board.push(best_move)
    print("\nBàn cờ sau khi Engine di chuyển:")
    print(board)

if __name__ == "__main__":
    run_engine_demo()