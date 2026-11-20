"""
arena.py — đấu 2 agent để đo hiệu năng tương đối.

Ví dụ chạy:
    python arena.py --agent1 random --agent2 greedy --games 20
    python arena.py --agent1 ../results/checkpoints/checkpoint_00005.pt --sim1 50 \
                     --agent2 ../results/checkpoints/checkpoint_00010.pt --sim2 50 --games 20
    python arena.py --agent1 ../results/checkpoints/best_checkpoint.pt --agent2 random \
                     --games 10 --save-games
"""
import argparse
import csv
import math
import os
import time
from pathlib import Path

import chess

from agents import RandomAgent, GreedyMaterialAgent, MCTSAgent

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_RESULTS_DIR = SCRIPT_DIR.parent / "results"
DEFAULT_GAMES_DIR = str(DEFAULT_RESULTS_DIR / "games")
DEFAULT_CSV_OUT = str(DEFAULT_RESULTS_DIR / "progress.csv")


def play_single_game(agent_white, agent_black, max_moves=200):
    """Chơi 1 ván, trả về (kết quả PGN-style, danh sách nước đi) để tái sử dụng
    cho cả thống kê thắng/thua lẫn lưu lại PGN xem sau."""
    board = chess.Board()
    moves = []
    move_count = 0
    while not board.is_game_over(claim_draw=True) and move_count < max_moves:
        agent = agent_white if board.turn == chess.WHITE else agent_black
        move = agent.choose_move(board)
        board.push(move)
        moves.append(move)
        move_count += 1

    if board.is_checkmate():
        result = "0-1" if board.turn == chess.WHITE else "1-0"
    else:
        result = "1/2-1/2"
    return result, moves


def play_match(agent_a, agent_b, num_games=20, max_moves=200, verbose=True,
                save_games=False, games_dir=DEFAULT_GAMES_DIR):
    """Đổi màu mỗi ván để loại bỏ lợi thế đi trước khỏi kết quả so sánh."""
    results = {"a_wins": 0, "b_wins": 0, "draws": 0}

    for game_idx in range(num_games):
        if game_idx % 2 == 0:
            white, black, a_is_white = agent_a, agent_b, True
        else:
            white, black, a_is_white = agent_b, agent_a, False

        start = time.time()
        result, moves = play_single_game(white, black, max_moves=max_moves)
        elapsed = time.time() - start

        if save_games:
            from game_record import save_pgn
            save_pgn(moves, white.name, black.name, result, out_dir=games_dir)

        if result == "1/2-1/2":
            results["draws"] += 1
            outcome = "Hòa"
        elif (result == "1-0") == a_is_white:
            results["a_wins"] += 1
            outcome = f"{agent_a.name} thắng"
        else:
            results["b_wins"] += 1
            outcome = f"{agent_b.name} thắng"

        if verbose:
            color_note = "Trắng" if a_is_white else "Đen"
            print(f"Ván {game_idx + 1}/{num_games} ({agent_a.name} cầm {color_note}): "
                  f"{outcome} ({elapsed:.1f}s)")

    win_rate_a = (results["a_wins"] + 0.5 * results["draws"]) / num_games
    results["win_rate_a"] = win_rate_a
    results["elo_diff"] = estimate_elo_diff(win_rate_a)
    return results


def estimate_elo_diff(win_rate, eps=1e-3):
    """Công thức Elo chuẩn: elo_diff = -400 * log10(1/win_rate - 1)."""
    win_rate = min(max(win_rate, eps), 1 - eps)
    return -400 * math.log10(1 / win_rate - 1)


def build_agent(spec: str, num_simulations: int):
    if spec == "random":
        return RandomAgent()
    if spec == "greedy":
        return GreedyMaterialAgent()
    if Path(spec).exists():
        return MCTSAgent(checkpoint_path=spec, num_simulations=num_simulations,
                          name=f"{Path(spec).name}(sim={num_simulations})")
    raise ValueError(f"Agent không hợp lệ: {spec} (dùng 'random', 'greedy', hoặc đường dẫn .pt)")


def main():
    parser = argparse.ArgumentParser(description="So sánh hiệu năng giữa 2 agent cờ vua")
    parser.add_argument("--agent1", required=True)
    parser.add_argument("--agent2", required=True)
    parser.add_argument("--sim1", type=int, default=50)
    parser.add_argument("--sim2", type=int, default=50)
    parser.add_argument("--games", type=int, default=20)
    parser.add_argument("--max-moves", type=int, default=200)
    parser.add_argument("--csv-out", type=str, default=DEFAULT_CSV_OUT)
    parser.add_argument("--no-csv", action="store_true", help="Không ghi CSV")
    parser.add_argument("--save-games", action="store_true", help="Lưu PGN từng ván")
    parser.add_argument("--games-dir", type=str, default=DEFAULT_GAMES_DIR)
    args = parser.parse_args()

    agent_a = build_agent(args.agent1, args.sim1)
    agent_b = build_agent(args.agent2, args.sim2)

    print(f"Đấu: {agent_a.name}  vs  {agent_b.name}  —  {args.games} ván\n")
    results = play_match(agent_a, agent_b, num_games=args.games, max_moves=args.max_moves,
                          save_games=args.save_games, games_dir=args.games_dir)

    print(f"\n=== KẾT QUẢ ===")
    print(f"{agent_a.name}: {results['a_wins']} thắng")
    print(f"{agent_b.name}: {results['b_wins']} thắng")
    print(f"Hòa: {results['draws']}")
    print(f"Tỉ lệ điểm của {agent_a.name}: {results['win_rate_a']*100:.1f}%")
    print(f"Chênh lệch Elo ước tính: {results['elo_diff']:+.0f} (dương = {agent_a.name} mạnh hơn)")
    if args.save_games:
        print(f"Đã lưu PGN từng ván vào: {args.games_dir}/")

    if not args.no_csv:
        csv_path = args.csv_out
        out_dir = os.path.dirname(csv_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        write_header = not Path(csv_path).exists()
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["agent_a", "agent_b", "games", "a_wins", "b_wins", "draws", "win_rate_a", "elo_diff"])
            writer.writerow([agent_a.name, agent_b.name, args.games, results["a_wins"],
                              results["b_wins"], results["draws"],
                              f"{results['win_rate_a']:.4f}", f"{results['elo_diff']:.1f}"])
        print(f"\nĐã ghi vào {csv_path}")


if __name__ == "__main__":
    main()
