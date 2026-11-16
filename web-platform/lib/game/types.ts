import type { GameResult, ResultReason } from "./rules";
import type { Side } from "./clock";

export type GameStatus = "waiting" | "ongoing" | "finished" | "aborted";

export interface PlayerInfo {
  id: string | null;
  name: string;
  isGuest: boolean;
  rating: number;
  /** Chỉ có khi ván xếp hạng đã kết thúc. */
  ratingBefore: number | null;
  ratingAfter: number | null;
}

/** Toàn bộ những gì trình duyệt cần để vẽ một ván. Server tính sẵn, client chỉ hiển thị. */
export interface GameView {
  id: string;
  status: GameStatus;
  result: GameResult | null;
  reason: ResultReason | null;
  rated: boolean;
  timeControl: { label: string; baseMs: number; incrementMs: number };
  white: PlayerInfo | null;
  black: PlayerInfo | null;
  sans: string[];
  plyCount: number;
  clocks: {
    whiteMs: number;
    blackMs: number;
    /** Bên có đồng hồ đang chạy; null nếu chưa bắt đầu, đã xong hoặc đang đóng băng. */
    ticking: Side | null;
  };
  /** Chỉ người chơi thấy. */
  presence: {
    offline: Record<Side, boolean>;
    /** Còn bao lâu nữa thì bên đó bị xử thua vì mất kết nối. */
    abandonInMs: Record<Side, number | null>;
  };
  drawOfferedBy: Side | null;
  serverNowMs: number;
  viewer: { userId: string | null; side: Side | null; isCreator: boolean };
  /** Khán giả đang xem trễ chừng này mili giây. 0 với người chơi. */
  delayMs: number;
}

export interface OpenChallenge {
  id: string;
  creator: { name: string; isGuest: boolean; rating: number };
  creatorSide: Side;
  timeControl: string;
  rated: boolean;
}

export interface LiveGameSummary {
  id: string;
  white: { name: string; isGuest: boolean; rating: number } | null;
  black: { name: string; isGuest: boolean; rating: number } | null;
  timeControl: string;
  rated: boolean;
  plyCount: number;
}

export type MatchStatus =
  | { state: "idle" }
  | { state: "searching"; waitedMs: number; windowElo: number; timeControlId: string }
  | { state: "matched"; gameId: string };

export interface MeInfo {
  user: { id: string; name: string; isGuest: boolean } | null;
  rating: number | null;
  gamesPlayed: number;
  activeGameId: string | null;
  waitingGameId: string | null;
}
