# main.py
import chess
from model import ChessNet
from mcts import mcts_search

def run_engine_demo():
    # Khởi tạo bàn cờ tiêu chuẩn 8x8
    board = chess.Board()
    
    # Tải mô hình não bộ
    model = ChessNet()
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