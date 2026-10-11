"""game_record.py — lưu 1 ván đấu dạng PGN chuẩn, mở được bằng mọi phần mềm cờ vua
(hoặc dán thẳng vào https://lichess.org/paste để xem lại tương tác, tua từng nước)."""
import os
import time
import chess
import chess.pgn


def save_pgn(moves, white_name, black_name, result, out_dir="games"):
    os.makedirs(out_dir, exist_ok=True)
    game = chess.pgn.Game()
    game.headers["White"] = white_name
    game.headers["Black"] = black_name
    game.headers["Result"] = result
    game.headers["Date"] = time.strftime("%Y.%m.%d")

    node = game
    for move in moves:
        node = node.add_variation(move)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    safe = lambda s: s.replace(" ", "").replace("/", "-")
    filename = f"{timestamp}_{safe(white_name)}_vs_{safe(black_name)}_{safe(result)}.pgn"
    path = os.path.join(out_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(str(game))
    return path
