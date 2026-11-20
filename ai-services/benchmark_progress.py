"""
benchmark_progress.py — đấu mọi checkpoint trong checkpoints/ với baseline cố định,
vẽ biểu đồ Elo/tỉ lệ thắng theo iteration huấn luyện.

Chạy:
    python benchmark_progress.py --baseline random --games-per-checkpoint 10
"""
import argparse
import glob
import os
import re
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from agents import RandomAgent, GreedyMaterialAgent, MCTSAgent
from arena import play_match

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CHECKPOINT_DIR = str(SCRIPT_DIR.parent / "results" / "checkpoints")
DEFAULT_OUT = str(SCRIPT_DIR.parent / "results" / "training_progress.png")


def list_checkpoints(checkpoint_dir):
    files = glob.glob(os.path.join(checkpoint_dir, "checkpoint_*.pt"))
    def extract_iter(path):
        m = re.search(r"checkpoint_(\d+)\.pt", path)
        return int(m.group(1)) if m else -1
    return sorted(files, key=extract_iter)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--baseline", choices=["random", "greedy"], default="random")
    parser.add_argument("--games-per-checkpoint", type=int, default=10)
    parser.add_argument("--simulations", type=int, default=30)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    checkpoints = list_checkpoints(args.checkpoint_dir)
    if not checkpoints:
        print(f"Không tìm thấy checkpoint nào trong {args.checkpoint_dir}/")
        return

    baseline = RandomAgent() if args.baseline == "random" else GreedyMaterialAgent()
    iterations, elo_diffs, win_rates = [], [], []

    for ckpt_path in checkpoints:
        iter_num = int(re.search(r"checkpoint_(\d+)\.pt", ckpt_path).group(1))
        agent = MCTSAgent(checkpoint_path=ckpt_path, num_simulations=args.simulations)

        print(f"\n--- Checkpoint iteration {iter_num} vs {baseline.name} ---")
        results = play_match(agent, baseline, num_games=args.games_per_checkpoint, verbose=False)
        print(f"Win rate: {results['win_rate_a']*100:.1f}% | Elo diff: {results['elo_diff']:+.0f}")

        iterations.append(iter_num)
        elo_diffs.append(results["elo_diff"])
        win_rates.append(results["win_rate_a"] * 100)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    ax1.plot(iterations, elo_diffs, marker="o")
    ax1.axhline(0, color="gray", linestyle="--", linewidth=0.8)
    ax1.set_xlabel("Iteration huấn luyện")
    ax1.set_ylabel(f"Chênh lệch Elo so với {baseline.name}")
    ax1.set_title("Tiến bộ Elo qua các vòng huấn luyện")
    ax1.grid(alpha=0.3)

    ax2.plot(iterations, win_rates, marker="o", color="green")
    ax2.axhline(50, color="gray", linestyle="--", linewidth=0.8)
    ax2.set_xlabel("Iteration huấn luyện")
    ax2.set_ylabel(f"Tỉ lệ điểm so với {baseline.name} (%)")
    ax2.set_title("Tỉ lệ thắng qua các vòng huấn luyện")
    ax2.set_ylim(0, 100)
    ax2.grid(alpha=0.3)

    plt.tight_layout()
    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    plt.savefig(args.out, dpi=150)
    print(f"\nĐã lưu biểu đồ: {args.out}")


if __name__ == "__main__":
    main()
