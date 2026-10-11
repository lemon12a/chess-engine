"""Vẽ đầy đủ đường cong huấn luyện từ checkpoints/training_metrics.csv +
checkpoints/iteration_metrics.csv (2 file này do train.py tự ghi trong lúc chạy).

Chạy: python plot_training_curves.py
"""
import argparse
import csv
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def read_csv(path):
    if not os.path.isfile(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", default="checkpoints")
    parser.add_argument("--out", default="training_curves.png")
    args = parser.parse_args()

    step_rows = read_csv(os.path.join(args.checkpoint_dir, "training_metrics.csv"))
    iter_rows = read_csv(os.path.join(args.checkpoint_dir, "iteration_metrics.csv"))
    if not step_rows:
        print("Chưa có training_metrics.csv — cần chạy train.py bản đã log_row trước (train.py mới).")
        return

    steps = list(range(1, len(step_rows) + 1))
    total_loss = [float(r["total_loss"]) for r in step_rows]
    value_loss = [float(r["value_loss"]) for r in step_rows]
    policy_loss = [float(r["policy_loss"]) for r in step_rows]
    buffer_size = [int(r["buffer_size"]) for r in step_rows]

    fig, axes = plt.subplots(2, 2, figsize=(13, 9))

    axes[0, 0].plot(steps, total_loss, label="Total", color="black")
    axes[0, 0].plot(steps, value_loss, label="Value", color="tab:red")
    axes[0, 0].plot(steps, policy_loss, label="Policy", color="tab:blue")
    axes[0, 0].set_xlabel("Bước gradient")
    axes[0, 0].set_ylabel("Loss")
    axes[0, 0].set_title("Loss theo bước huấn luyện")
    axes[0, 0].legend()
    axes[0, 0].grid(alpha=0.3)

    axes[0, 1].plot(steps, buffer_size, color="tab:green")
    axes[0, 1].set_xlabel("Bước gradient")
    axes[0, 1].set_ylabel("Replay buffer")
    axes[0, 1].set_title("Replay buffer theo thời gian")
    axes[0, 1].grid(alpha=0.3)

    if iter_rows:
        iters = [int(r["iteration"]) for r in iter_rows]
        avg_len = [float(r["avg_game_length"]) for r in iter_rows]
        axes[1, 0].plot(iters, avg_len, marker="o", color="tab:orange")
        axes[1, 0].set_xlabel("Iteration")
        axes[1, 0].set_ylabel("Độ dài ván self-play TB")
        axes[1, 0].set_title("Độ dài ván self-play")
        axes[1, 0].grid(alpha=0.3)

        valid = [(int(r["iteration"]), float(r["eval_win_rate"]) * 100)
                 for r in iter_rows if r.get("eval_win_rate")]
        if valid:
            vi, vw = zip(*valid)
            axes[1, 1].plot(vi, vw, marker="o", color="tab:purple")
            axes[1, 1].axhline(50, color="gray", linestyle="--", linewidth=0.8)
            axes[1, 1].set_xlabel("Iteration")
            axes[1, 1].set_ylabel("Win rate candidate vs best (%)")
            axes[1, 1].set_title("Kết quả đấu loại (gating)")
            axes[1, 1].set_ylim(0, 100)
            axes[1, 1].grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(args.out, dpi=150)
    print(f"Đã lưu: {args.out}")


if __name__ == "__main__":
    main()
