"""render_game.py — chuyển 1 file PGN thành chuỗi ảnh SVG bàn cờ.

Cách nhanh hơn (không cần script này): mở file .pgn, copy toàn bộ nội dung,
dán vào https://lichess.org/paste — ra bàn cờ tương tác, tua từng nước.
Dùng script này khi cần ảnh TĨNH offline (vd chèn vào slide báo cáo).

Chạy: python render_game.py games/xxx.pgn --every 5
"""
import argparse
import os
import chess
import chess.pgn
import chess.svg


def _save(board, path, lastmove=None):
    with open(path, "w", encoding="utf-8") as f:
        f.write(chess.svg.board(board=board, lastmove=lastmove, size=480))


def render_pgn_to_images(pgn_path, out_dir=None, every=5):
    with open(pgn_path, encoding="utf-8") as f:
        game = chess.pgn.read_game(f)
    if game is None:
        print(f"Không đọc được: {pgn_path}")
        return

    out_dir = out_dir or os.path.splitext(pgn_path)[0] + "_images"
    os.makedirs(out_dir, exist_ok=True)

    board = game.board()
    _save(board, os.path.join(out_dir, "move_0000_start.svg"))

    move_num, last_move = 0, None
    for move in game.mainline_moves():
        board.push(move)
        last_move = move
        move_num += 1
        if move_num % every == 0:
            _save(board, os.path.join(out_dir, f"move_{move_num:04d}.svg"), lastmove=last_move)

    _save(board, os.path.join(out_dir, f"move_{move_num:04d}_final.svg"), lastmove=last_move)
    print(f"Đã lưu ảnh vào: {out_dir}  (mở file .svg bằng trình duyệt để xem)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pgn_path")
    parser.add_argument("--every", type=int, default=5)
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()
    render_pgn_to_images(args.pgn_path, out_dir=args.out_dir, every=args.every)
