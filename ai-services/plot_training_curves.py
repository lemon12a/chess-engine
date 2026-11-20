"""Vẽ đường cong huấn luyện (loss, buffer, độ dài ván, gating) cho 1 lần chạy cụ thể,
đọc từ ../results/training_<N>/training_metrics.csv + iteration_metrics.csv.

Chạy: python plot_training_curves.py              # tự lấy lần chạy mới nhất
      python plot_training_curves.py --run 2       # chỉ định lần chạy số 2
"""
import argparse
import csv
import os
import re
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_RESULTS_DIR = str(SCRIPT_DIR.parent / "results")


def read_csv(path):
    if not os.path.isfile(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def get_latest_run(results_dir):
    pattern = re.compile(r"training_(\d+)$")
    existing = []
    if os.path.isdir(results_dir):
        for name in os.listdir(results_dir):
            m = pattern.match(name)
            if m and os.path.isdir(os.path.join(results_dir, name)):
                existing.append(int(m.group(1)))
    return max(existing) if existing else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--results-dir", default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--run", type=int, default=None, help="Lần chạy muốn vẽ (mặc định: mới nhất)")
    args = parser.parse_args()

    run = args.run or get_latest_run(args.results_dir)
    if run is None:
        print(f"Không tìm thấy thư mục training_<N> nào trong {args.results_dir}")
        return

    run_dir = os.path.join(args.results_dir, f"training_{run}")
    step_rows = read_csv(os.path.join(run_dir, "training_metrics.csv"))
    iter_rows = read_csv(os.path.join(run_dir, "iteration_metrics.csv"))
    if not step_rows:
        print(f"Chưa có training_metrics.csv trong {run_dir} — train.py đã chạy xong ít nhất "
              f"1 epoch cho lần chạy này chưa?")
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
    axes[0, 0].set_title(f"Loss — lần chạy {run}")
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
    out_path = os.path.join(run_dir, "training_curves.png")
    plt.savefig(out_path, dpi=150)
    print(f"Đã lưu: {out_path}")


if __name__ == "__main__":
    main()
