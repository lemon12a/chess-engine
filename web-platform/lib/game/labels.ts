import type { Side } from "./clock";
import type { GameView, PlayerInfo } from "./types";

export interface ResultDescription {
  title: string;
  color: "green" | "red" | "gray" | "yellow";
  text: string;
  /** Dòng Elo (chỉ ván xếp hạng đã tính điểm). */
  elo: string | null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

function eloLine(view: GameView): string | null {
  const line = (player: PlayerInfo | null) =>
    player && player.ratingBefore !== null && player.ratingAfter !== null
      ? `${player.ratingBefore} → ${player.ratingAfter} (${signed(player.ratingAfter - player.ratingBefore)})`
      : null;
  const side = view.viewer.side;
  if (side) return line(side === "w" ? view.white : view.black);
  const white = line(view.white);
  const black = line(view.black);
  if (!white || !black) return null;
  return `${view.white?.name}: ${white} · ${view.black?.name}: ${black}`;
}

/** Mô tả kết quả ván cho người đang xem. Trả về null nếu ván chưa kết thúc. */
export function describeResult(view: GameView): ResultDescription | null {
  if (view.status !== "finished" && view.status !== "aborted") return null;

  const me = view.viewer.side;
  const nameOf = (side: Side) =>
    me === side ? "Bạn" : ((side === "w" ? view.white : view.black)?.name ?? "Đối thủ");
  const startedWithBoth = Boolean(view.white && view.black);

  if (view.status === "aborted") {
    const text =
      view.reason === "aborted_no_move"
        ? "Ván bị hủy vì có người chưa đi nước đầu tiên."
        : view.reason === "aborted_both_gone"
          ? "Ván bị hủy vì cả hai cùng mất kết nối."
          : startedWithBoth
            ? "Ván bị hủy vì kết thúc quá sớm, không tính Elo."
            : "Thách đấu đã được hủy.";
    return { title: "Ván đã hủy", color: "gray", text, elo: null };
  }

  const winner: Side | null =
    view.result === "white" ? "w" : view.result === "black" ? "b" : null;
  const loser: Side | null = winner ? (winner === "w" ? "b" : "w") : null;

  let title: string;
  let color: ResultDescription["color"];
  if (!winner) {
    title = "Hòa";
    color = "gray";
  } else if (me) {
    title = winner === me ? "Bạn thắng!" : "Bạn thua";
    color = winner === me ? "green" : "red";
  } else {
    title = `${nameOf(winner)} thắng`;
    color = "gray";
  }

  const lost = loser ? nameOf(loser) : "";
  const text =
    view.reason === "checkmate"
      ? "Chiếu bí."
      : view.reason === "resign"
        ? `${lost} đã xin thua.`
        : view.reason === "timeout"
          ? `${lost} đã hết giờ.`
          : view.reason === "abandon"
            ? `${lost} mất kết nối quá lâu.`
            : view.reason === "agreement"
              ? "Hai bên đồng ý hòa."
              : view.reason === "stalemate"
                ? "Hòa do hết nước đi hợp lệ (pat)."
                : view.reason === "repetition"
                  ? "Hòa do lặp lại thế cờ 3 lần."
                  : view.reason === "fifty_move"
                    ? "Hòa theo luật 50 nước."
                    : view.reason === "insufficient"
                      ? "Hòa do không đủ quân để chiếu bí."
                      : "";
  return { title, color, text, elo: eloLine(view) };
}
