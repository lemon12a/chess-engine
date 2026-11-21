import type { ResultReason } from "./rules";
import type { HistoryOutcome } from "./historyTypes";

export const OUTCOME_LABEL: Record<HistoryOutcome, string> = {
  win: "Thắng",
  loss: "Thua",
  draw: "Hòa",
  aborted: "Đã hủy",
  unfinished: "Chưa xong",
};

export const OUTCOME_COLOR: Record<HistoryOutcome, string> = {
  win: "green",
  loss: "red",
  draw: "gray",
  aborted: "gray",
  unfinished: "yellow",
};

export const REASON_LABEL: Record<ResultReason, string> = {
  checkmate: "Chiếu bí",
  resign: "Xin thua",
  timeout: "Hết giờ",
  abandon: "Mất kết nối",
  agreement: "Hai bên đồng ý hòa",
  stalemate: "Hòa do hết nước đi (pat)",
  repetition: "Hòa do lặp thế cờ",
  insufficient: "Hòa do không đủ quân",
  fifty_move: "Hòa theo luật 50 nước",
  aborted: "Ván bị hủy",
  aborted_no_move: "Hủy vì có người chưa đi nước đầu",
  aborted_both_gone: "Hủy vì cả hai mất kết nối",
};

/** Số nước (một nước = một lượt của cả hai bên) từ số nửa nước. */
export const moveCount = (plyCount: number) => Math.ceil(plyCount / 2);

export function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");
