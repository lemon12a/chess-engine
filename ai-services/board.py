# board_utils.py
import numpy as np
import chess
import torch

# ==== Không gian hành động (Action Space) ====
# 4096 = 64 (from_square) x 64 (to_square): bao phủ toàn bộ nước đi thường
# (kể cả nhập thành, bắt tốt qua đường - en passant) VÀ nước phong Hậu (Queen promotion),
# vì phong Hậu vẫn có 1 cặp (from, to) duy nhất, không trùng với bất kỳ nước đi nào khác
# tại cùng thời điểm (mỗi ô chỉ có 1 quân, nên from_square xác định duy nhất quân đang đi).
#
# 576 = 3 (loại quân phong cấp khác Hậu: Mã/Tượng/Xe) x 3 (hướng đi: chéo trái/thẳng/chéo phải)
# x 64 (from_square), dành riêng cho phong cấp KHÁC Hậu (under-promotion). Các nước này có
# CÙNG (from, to) với nước phong Hậu tương ứng nên bắt buộc phải mã hoá ở vùng chỉ số riêng,
# nếu không sẽ bị trùng index với phong Hậu (xem giải thích chi tiết trong move_to_index).
ACTION_SPACE_SIZE = 4096 + 576  # = 4672

# Số plane đầu vào: 12 plane quân cờ (6 loại x 2 màu) + 1 plane lượt đi = 13.
# Phải khớp INPUT_CHANNELS trong model.py.
NUM_INPUT_PLANES = 13

# Thứ tự cố định để tính piece_idx khi mã hoá phong cấp (không gồm Hậu vì Hậu đã nằm trong 4096)
UNDERPROMOTION_PIECES = [chess.KNIGHT, chess.BISHOP, chess.ROOK]


def board_to_tensor(board):
    """
    Chuyển bàn cờ sang Tensor 13x8x8: 12 plane quân cờ (như cũ) + 1 plane lượt đi.
    Plane lượt đi = 1.0 nếu đến lượt trắng, 0.0 nếu đến lượt đen.
    """
    piece_types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]
    tensor = np.zeros((NUM_INPUT_PLANES, 8, 8), dtype=np.float32)
    
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is not None:
            plane_idx = piece_types.index(piece.piece_type)
            if piece.color == chess.BLACK:
                plane_idx += 6
            row, col = divmod(square, 8)
            tensor[plane_idx, row, col] = 1.0

    if board.turn == chess.WHITE:
        tensor[12, :, :] = 1.0
    # (Đen sắp đi -> giữ nguyên 0.0)

    return torch.tensor(tensor).unsqueeze(0) # Trả về dạng (1, 13, 8, 8)

def move_to_index(move):
    """
    Mã hóa nước đi thành chỉ số hành động duy nhất trong khoảng [0, ACTION_SPACE_SIZE).
    """
    if move.promotion is not None and move.promotion != chess.QUEEN:
        piece_idx = UNDERPROMOTION_PIECES.index(move.promotion)  # 0=Mã, 1=Tượng, 2=Xe

        from_file = chess.square_file(move.from_square)
        to_file = chess.square_file(move.to_square)
        direction_idx = (to_file - from_file) + 1  # -1,0,+1 (chéo trái/thẳng/chéo phải) -> 0,1,2

        offset = (piece_idx * 3 + direction_idx) * 64 + move.from_square
        return 4096 + offset

    return move.from_square * 64 + move.to_square


def index_to_move(index, board):
    """
    Giải mã chỉ số hành động về lại chess.Move hợp lệ trong bàn cờ hiện tại (nếu có).
    Trả về None nếu không có nước đi hợp lệ nào ứng với index này.
    """
    for legal_move in board.legal_moves:
        if move_to_index(legal_move) == index:
            return legal_move
    return None


def get_legal_action_mask(board):
    """
    Trả về mảng nhị phân kích thước ACTION_SPACE_SIZE, giá trị 1.0 tại các chỉ số ứng
    với nước đi hợp lệ ở vị trí hiện tại, còn lại là 0.0.
    """
    mask = np.zeros(ACTION_SPACE_SIZE, dtype=np.float32)
    for move in board.legal_moves:
        mask[move_to_index(move)] = 1.0
    return mask
