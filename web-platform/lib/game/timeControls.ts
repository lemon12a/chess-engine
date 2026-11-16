import { RATING_CATEGORY } from "./constants";

export interface TimeControl {
  id: string; // "5+3" = 5 phút, cộng 3 giây mỗi nước
  label: string;
  kind: string;
  baseMs: number;
  incrementMs: number;
}

export function formatTimeControl(baseMs: number, incrementMs: number): string {
  const base =
    baseMs % 60_000 === 0 ? `${baseMs / 60_000}` : `${(baseMs / 1000).toFixed(0)}s`;
  return `${base}+${Math.round(incrementMs / 1000)}`;
}

// Cách phân loại giống nhiều trang cờ: ước lượng ván dài bao nhiêu giây.
export function kindOf(baseMs: number, incrementMs: number): string {
  const estimate = baseMs / 1000 + 40 * (incrementMs / 1000);
  if (estimate < 180) return "Bullet";
  if (estimate < 480) return "Blitz";
  if (estimate < 1500) return "Rapid";
  return "Cổ điển";
}

function preset(minutes: number, incrementSec: number): TimeControl {
  const baseMs = minutes * 60_000;
  const incrementMs = incrementSec * 1000;
  return {
    id: `${minutes}+${incrementSec}`,
    label: formatTimeControl(baseMs, incrementMs),
    kind: kindOf(baseMs, incrementMs),
    baseMs,
    incrementMs,
  };
}

// Thể thức chưa chốt: muốn thêm/bớt thì sửa đúng danh sách này.
export const TIME_CONTROLS: readonly TimeControl[] = [
  preset(3, 0),
  preset(3, 2),
  preset(5, 0),
  preset(5, 3),
  preset(10, 0),
  preset(15, 10),
];

export const DEFAULT_TIME_CONTROL_ID = "5+0";

export function getTimeControl(id?: string | null): TimeControl | undefined {
  return TIME_CONTROLS.find((tc) => tc.id === id);
}

/** Hiện tất cả thể thức dùng chung một nhóm Elo. Tách nhóm ở đây khi cần. */
export function ratingCategoryFor(): string {
  return RATING_CATEGORY;
}

/** 4:05, 12:30, 1:02:03. Dưới 10 giây hiện phần mười: 9.4 */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return (Math.floor(safe / 100) / 10).toFixed(1);
  const totalSeconds = Math.ceil(safe / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
