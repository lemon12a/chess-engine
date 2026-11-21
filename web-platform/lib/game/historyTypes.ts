import type { GameResult, ResultReason } from "./rules";

// Chỉ chứa kiểu và hằng, dùng được cả ở server lẫn trình duyệt.

export type HistoryKind = "ai" | "pvp";
export type HistoryFilter = "all" | HistoryKind;
export type HistoryOutcome = "win" | "loss" | "draw" | "aborted" | "unfinished";

export interface HistoryItem {
  kind: HistoryKind;
  id: string;
  /** Kết quả theo góc nhìn của người đang xem lịch sử. */
  outcome: HistoryOutcome;
  reason: ResultReason | null;
  myColor: "w" | "b";
  opponent: { name: string; isGuest: boolean };
  /** Số nửa nước (ply). Số nước = làm tròn lên của plyCount / 2. */
  plyCount: number;
  /** ISO. Với ván chưa kết thúc là lần lưu gần nhất. */
  endedAt: string;
  /** Chỉ ván giữa người với người. */
  timeControl: string | null;
  rated: boolean | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  /** Chỉ ván với AI. */
  levelLabel: string | null;
}

export interface HistoryPage {
  items: HistoryItem[];
  hasMore: boolean;
  /** Khách có lịch sử nhưng sẽ mất nếu không đăng ký. */
  isGuest: boolean;
}

export interface ReplayData {
  kind: HistoryKind;
  id: string;
  status: "ongoing" | "finished" | "aborted";
  result: GameResult | null;
  reason: ResultReason | null;
  sans: string[];
  pgn: string;
  white: { name: string; isGuest: boolean };
  black: { name: string; isGuest: boolean };
  /** Null nếu người xem không phải người chơi (xem ván công khai của người khác). */
  myColor: "w" | "b" | null;
  playedAt: string;
  timeControl: string | null;
  rated: boolean | null;
  levelLabel: string | null;
  ratings: {
    white: { before: number; after: number } | null;
    black: { before: number; after: number } | null;
  };
}

export const HISTORY_PAGE_SIZE = 20;
