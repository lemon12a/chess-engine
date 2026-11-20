import { DEFAULT_RATING } from "./constants";

/** Xác suất (điểm kỳ vọng) người có rating `a` thắng người có rating `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/** Người mới biến động mạnh hơn cho nhanh về đúng trình độ. */
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < 30 ? 40 : 20;
}

const MIN_RATING = 100;

export interface EloPlayer {
  rating: number;
  gamesPlayed: number;
}

export interface EloOutcome {
  whiteAfter: number;
  blackAfter: number;
  whiteDelta: number;
  blackDelta: number;
}

/** whiteScore: 1 = Trắng thắng, 0.5 = hòa, 0 = Đen thắng. Cả hai tính theo rating TRƯỚC ván. */
export function computeElo(
  white: EloPlayer,
  black: EloPlayer,
  whiteScore: 0 | 0.5 | 1,
): EloOutcome {
  const whiteExpected = expectedScore(white.rating, black.rating);
  const blackExpected = 1 - whiteExpected;
  const whiteDelta = Math.round(kFactor(white.gamesPlayed) * (whiteScore - whiteExpected));
  const blackDelta = Math.round(
    kFactor(black.gamesPlayed) * (1 - whiteScore - blackExpected),
  );
  return {
    whiteAfter: Math.max(MIN_RATING, white.rating + whiteDelta),
    blackAfter: Math.max(MIN_RATING, black.rating + blackDelta),
    whiteDelta,
    blackDelta,
  };
}

/** Điểm được/mất nếu thắng, hòa, thua. Dùng cho hộp thoại mời chơi xếp hạng. */
export function previewDeltas(me: EloPlayer, opponent: EloPlayer) {
  const asWhite = (score: 0 | 0.5 | 1) =>
    computeElo(me, opponent, score).whiteDelta;
  return { win: asWhite(1), draw: asWhite(0.5), loss: asWhite(0) };
}

export { DEFAULT_RATING };
