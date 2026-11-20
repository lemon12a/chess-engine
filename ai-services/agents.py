"""
agents.py — các "đấu thủ" dùng để so sánh hiệu năng: từ ngẫu nhiên, tham lam,
đến các checkpoint của ChessNet với số simulation MCTS khác nhau. Mỗi agent
chỉ cần implement 1 phương thức: choose_move(board) -> chess.Move.
"""
import random
import chess
import torch

from model import ChessNet, load_checkpoint
from mcts import mcts_search

PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
               chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


class Agent:
    name = "Agent"

    def choose_move(self, board: chess.Board) -> chess.Move:
        raise NotImplementedError


class RandomAgent(Agent):
    """Baseline yếu nhất: chọn ngẫu nhiên trong các nước hợp lệ."""
    name = "Random"

    def choose_move(self, board):
        return random.choice(list(board.legal_moves))


class GreedyMaterialAgent(Agent):
    """Baseline trung bình: luôn ưu tiên ăn quân có giá trị cao nhất (nhìn 1 nước)."""
    name = "GreedyMaterial"

    def choose_move(self, board):
        moves = list(board.legal_moves)
        best_score, best_moves = -1, []
        for move in moves:
            score = 0
            if board.is_capture(move):
                captured = board.piece_at(move.to_square)
                if captured:
                    score = PIECE_VALUE.get(captured.piece_type, 0)
            if score > best_score:
                best_score, best_moves = score, [move]
            elif score == best_score:
                best_moves.append(move)
        return random.choice(best_moves)


class MCTSAgent(Agent):
    """
    Agent dùng ChessNet + MCTS — engine thật đang phát triển.
    checkpoint_path=None -> trọng số ngẫu nhiên (đo xem MCTS "đóng góp" được bao
    nhiêu khi KHÔNG có model dẫn đường, tách biệt khỏi việc model đã học được gì).

    Lưu ý: add_root_noise mặc định False ở đây - agent này dùng để ĐÁNH GIÁ/ĐẤU THẬT
    (arena, gating), không phải self-play thu thập dữ liệu, nên không cần Dirichlet
    noise (noise chỉ nên bật khi train.py tự chơi để thu thập dữ liệu đa dạng).
    """
    def __init__(self, checkpoint_path=None, num_simulations=50, device=None, name=None):
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = ChessNet().to(self.device)
        if checkpoint_path:
            load_checkpoint(checkpoint_path, self.model, device=self.device)
        self.model.eval()
        self.num_simulations = num_simulations
        self.name = name or f"MCTS[{checkpoint_path or 'random-weights'}, sim={num_simulations}]"

    def choose_move(self, board):
        return mcts_search(board, self.model, num_simulations=self.num_simulations)
