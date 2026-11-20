import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { buildPgn, canDeliverMate, normalizeOutcome, positionOutcome, replay, timeoutOutcome } from "../rules";
import { formatClock, formatTimeControl, getTimeControl } from "../timeControls";

const fen = (f: string) => new Chess(f);

describe("positionOutcome", () => {
  it("chiếu bí (Fool's mate): Đen thắng", () => {
    const c = replay(["f3", "e5", "g4", "Qh4#"]);
    expect(positionOutcome(c)).toEqual({ result: "black", reason: "checkmate" });
  });
  it("pat", () => {
    expect(positionOutcome(fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"))).toEqual({ result: "draw", reason: "stalemate" });
  });
  it("không đủ quân", () => {
    expect(positionOutcome(fen("8/8/4k3/8/8/3K4/8/8 w - - 0 1"))).toEqual({ result: "draw", reason: "insufficient" });
  });
  it("lặp thế 3 lần", () => {
    const c = replay(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);
    expect(positionOutcome(c)).toEqual({ result: "draw", reason: "repetition" });
  });
  it("ván đang diễn ra thì null", () => {
    expect(positionOutcome(new Chess())).toBeNull();
  });
});

describe("hết giờ", () => {
  it("đối thủ còn đủ quân: thắng", () => {
    expect(timeoutOutcome(new Chess(), "w")).toEqual({ result: "black", reason: "timeout" });
  });
  it("đối thủ chỉ còn vua + 1 mã: hòa", () => {
    const c = fen("4k3/8/8/8/8/8/4P3/4KN2 b - - 0 1"); // Trắng còn tốt nên mate được
    expect(canDeliverMate(c, "w")).toBe(true);
    const lone = fen("4k3/8/8/8/8/8/8/4KN2 w - - 0 1");
    expect(canDeliverMate(lone, "w")).toBe(false);
    expect(timeoutOutcome(lone, "b")).toEqual({ result: "draw", reason: "insufficient" });
  });
  it("hai mã trở lên vẫn coi là còn khả năng", () => {
    expect(canDeliverMate(fen("4k3/8/8/8/8/8/8/3NKN2 w - - 0 1"), "w")).toBe(true);
  });
});

describe("normalizeOutcome", () => {
  it("thua/xin thua sớm bị huỷ, không tính Elo", () => {
    expect(normalizeOutcome({ result: "white", reason: "resign" }, 2)).toEqual({ result: "aborted", reason: "aborted" });
    expect(normalizeOutcome({ result: "draw", reason: "agreement" }, 3)).toEqual({ result: "aborted", reason: "aborted" });
  });
  it("đủ số nước thì giữ nguyên", () => {
    const o = { result: "white", reason: "resign" } as const;
    expect(normalizeOutcome(o, 4)).toEqual(o);
  });
  it("chiếu bí luôn giữ nguyên dù sớm", () => {
    const o = { result: "black", reason: "checkmate" } as const;
    expect(normalizeOutcome(o, 4)).toEqual(o);
    expect(normalizeOutcome(o, 2)).toEqual(o);
  });
});

describe("tiện ích", () => {
  it("định dạng đồng hồ", () => {
    expect(formatClock(300_000)).toBe("5:00");
    expect(formatClock(65_400)).toBe("1:06");
    expect(formatClock(9_450)).toBe("9.4");
    expect(formatClock(-5)).toBe("0.0");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("định dạng và tra cứu thể thức", () => {
    expect(formatTimeControl(300_000, 3_000)).toBe("5+3");
    expect(getTimeControl("5+3")?.baseMs).toBe(300_000);
    expect(getTimeControl("99+9")).toBeUndefined();
  });
  it("dựng PGN", () => {
    const pgn = buildPgn(["e4", "e5"], { White: "A", Black: "B", Result: "*" });
    expect(pgn).toContain('[White "A"]');
    expect(pgn).toContain("1. e4 e5");
  });
});
