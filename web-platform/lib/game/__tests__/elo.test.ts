import { describe, expect, it } from "vitest";
import { computeElo, expectedScore, kFactor, previewDeltas } from "../elo";

describe("elo", () => {
  it("điểm kỳ vọng cân bằng khi bằng rating", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 2);
  });

  it("người mới có K lớn hơn", () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(29)).toBe(40);
    expect(kFactor(30)).toBe(20);
  });

  it("hai người mới bằng rating: thắng +20, thua -20", () => {
    const r = computeElo({ rating: 1000, gamesPlayed: 0 }, { rating: 1000, gamesPlayed: 0 }, 1);
    expect(r).toMatchObject({ whiteDelta: 20, blackDelta: -20, whiteAfter: 1020, blackAfter: 980 });
  });

  it("hòa giữa hai người bằng rating không đổi điểm", () => {
    const r = computeElo({ rating: 1200, gamesPlayed: 50 }, { rating: 1200, gamesPlayed: 50 }, 0.5);
    expect(r.whiteDelta).toBe(0);
    expect(r.blackDelta).toBe(0);
  });

  it("thắng người mạnh hơn được nhiều điểm hơn thắng người yếu hơn", () => {
    const upset = computeElo({ rating: 1000, gamesPlayed: 50 }, { rating: 1400, gamesPlayed: 50 }, 1);
    const expected = computeElo({ rating: 1400, gamesPlayed: 50 }, { rating: 1000, gamesPlayed: 50 }, 1);
    expect(upset.whiteDelta).toBeGreaterThan(expected.whiteDelta);
  });

  it("Đen thắng: Đen được cộng, Trắng bị trừ", () => {
    const r = computeElo({ rating: 1000, gamesPlayed: 0 }, { rating: 1000, gamesPlayed: 0 }, 0);
    expect(r.blackDelta).toBe(20);
    expect(r.whiteDelta).toBe(-20);
  });

  it("rating không xuống dưới sàn", () => {
    const r = computeElo({ rating: 100, gamesPlayed: 0 }, { rating: 1000, gamesPlayed: 0 }, 0);
    expect(r.whiteAfter).toBe(100);
  });

  it("xem trước điểm thắng/hòa/thua", () => {
    const p = previewDeltas({ rating: 1000, gamesPlayed: 0 }, { rating: 1000, gamesPlayed: 0 });
    expect(p).toEqual({ win: 20, draw: 0, loss: -20 });
  });
});
