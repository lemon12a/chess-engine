# board_utils.py
import numpy as np
import chess
import torch

def board_to_tensor(board):
    """Chuyển đổi bàn cờ sang Tensor 12x8x8"""
    piece_types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]
    tensor = np.zeros((12, 8, 8), dtype=np.float32)
    
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is not None:
            plane_idx = piece_types.index(piece.piece_type)
            if piece.color == chess.BLACK:
                plane_idx += 6
            row, col = divmod(square, 8)
            tensor[plane_idx, row, col] = 1.0
            
    return torch.tensor(tensor).unsqueeze(0) # Trả về dạng (1, 12, 8, 8)

def move_to_index(move):
    """Mã hóa nước đi thành chỉ số từ 0 đến 4095"""
    return move.from_square * 64 + move.to_square