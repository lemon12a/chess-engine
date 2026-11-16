import {
  ABANDON_MS,
  CLOCK_START_PLY,
  FIRST_MOVE_TIMEOUT_MS,
  PRESENCE_TIMEOUT_MS,
} from "./constants";

export type Side = "w" | "b";

export const otherSide = (side: Side): Side => (side === "w" ? "b" : "w");

/** Bên đang đến lượt, suy ra từ số nước đã đi (không cần lưu riêng). */
export const activeSide = (plyCount: number): Side =>
  plyCount % 2 === 0 ? "w" : "b";

export const clockStarted = (plyCount: number): boolean =>
  plyCount >= CLOCK_START_PLY;

/**
 * Toàn bộ trạng thái cần để tính đồng hồ. Đây là hàm thuần: không đụng DB,
 * không đọc giờ hiện tại. `now` luôn được truyền vào (giờ của DB).
 *
 * Quy ước: remainingMs là thời gian còn lại TẠI clockAtMs. Thời gian đã trôi từ
 * clockAtMs đến `now` chưa bị trừ, mà được tính khi cần ("project").
 */
export interface ClockState {
  plyCount: number;
  remainingMs: Record<Side, number>;
  clockAtMs: number;
  /** Lần cuối nhận được tín hiệu sống của từng bên. */
  seenMs: Record<Side, number>;
  /** Quỹ đóng băng đồng hồ còn lại của từng bên. */
  budgetMs: Record<Side, number>;
}

export const silentFor = (state: ClockState, side: Side, now: number): number =>
  Math.max(0, now - state.seenMs[side]);

export const isOffline = (state: ClockState, side: Side, now: number): boolean =>
  silentFor(state, side, now) > PRESENCE_TIMEOUT_MS;

/**
 * Phần thời gian (trong khoảng clockAtMs..now) mà đồng hồ của `side` được đóng
 * băng vì họ mất kết nối. Tính từ tín hiệu cuối cùng (không phải từ lúc phát hiện),
 * nhưng không vượt quá quỹ đóng băng còn lại.
 */
function frozenOverlapMs(state: ClockState, side: Side, now: number): number {
  if (!isOffline(state, side, now)) return 0;
  const since = Math.max(state.clockAtMs, state.seenMs[side]);
  return Math.min(Math.max(0, now - since), state.budgetMs[side]);
}

export interface ClockProjection {
  remainingMs: Record<Side, number>;
  /** Bên có đồng hồ đang chạy, hoặc null nếu chưa bắt đầu / đang đóng băng. */
  ticking: Side | null;
  /** Bên đã hết giờ (nếu có). */
  flagged: Side | null;
}

/** Thời gian còn lại của hai bên tại thời điểm `now`. Không thay đổi `state`. */
export function projectClock(state: ClockState, now: number): ClockProjection {
  const active = activeSide(state.plyCount);
  const remaining = { ...state.remainingMs };
  let ticking: Side | null = null;
  let flagged: Side | null = null;

  if (clockStarted(state.plyCount)) {
    const elapsed = Math.max(0, now - state.clockAtMs);
    const frozen = frozenOverlapMs(state, active, now);
    remaining[active] = state.remainingMs[active] - (elapsed - frozen);
    const frozenNow =
      isOffline(state, active, now) && state.budgetMs[active] - frozen > 0;
    ticking = frozenNow ? null : active;
    if (remaining[active] <= 0) flagged = active;
  }

  return {
    remainingMs: {
      w: Math.max(0, remaining.w),
      b: Math.max(0, remaining.b),
    },
    ticking,
    flagged,
  };
}

/**
 * "Chốt" đồng hồ tại `now`: trừ thời gian đã trôi (có tính đóng băng) vào số dư
 * rồi dời clockAtMs lên `now`. Gọi mỗi khi có sự kiện ghi vào DB.
 * Trước khi đồng hồ bắt đầu thì không đổi gì (clockAtMs còn dùng cho hạn nước đầu).
 */
export function settleClock(state: ClockState, now: number): ClockState {
  if (!clockStarted(state.plyCount)) return state;
  const active = activeSide(state.plyCount);
  const elapsed = Math.max(0, now - state.clockAtMs);
  const frozen = frozenOverlapMs(state, active, now);
  return {
    ...state,
    clockAtMs: now,
    remainingMs: {
      ...state.remainingMs,
      [active]: state.remainingMs[active] - (elapsed - frozen),
    },
    budgetMs: {
      ...state.budgetMs,
      [active]: state.budgetMs[active] - frozen,
    },
  };
}

/** Áp dụng một nước đi của `mover`: chốt đồng hồ, cộng thời gian thưởng, tăng số nước. */
export function applyMoveToClock(
  state: ClockState,
  mover: Side,
  now: number,
  incrementMs: number,
): ClockState {
  const settled = settleClock(state, now);
  const remainingMs = { ...settled.remainingMs };
  // Nước đi trước khi đồng hồ bắt đầu thì không có thời gian thưởng.
  if (clockStarted(state.plyCount)) remainingMs[mover] += incrementMs;
  return {
    ...settled,
    remainingMs,
    clockAtMs: now,
    plyCount: state.plyCount + 1,
  };
}

export type Termination =
  | { kind: "abandon"; loser: Side }
  | { kind: "timeout"; loser: Side }
  | { kind: "no_first_move" }
  | { kind: "both_gone" };

/** Ván có phải kết thúc ngay bây giờ vì hết giờ / bỏ cuộc / không ai đi không? */
export function detectTermination(
  state: ClockState,
  now: number,
): Termination | null {
  const goneW = silentFor(state, "w", now) > ABANDON_MS;
  const goneB = silentFor(state, "b", now) > ABANDON_MS;
  if (goneW && goneB) return { kind: "both_gone" };
  if (goneW) return { kind: "abandon", loser: "w" };
  if (goneB) return { kind: "abandon", loser: "b" };

  if (!clockStarted(state.plyCount)) {
    if (now - state.clockAtMs > FIRST_MOVE_TIMEOUT_MS) {
      return { kind: "no_first_move" };
    }
    return null;
  }

  const { flagged } = projectClock(state, now);
  if (flagged) return { kind: "timeout", loser: flagged };
  return null;
}
