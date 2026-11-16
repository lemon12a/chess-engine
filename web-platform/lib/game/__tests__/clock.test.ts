import { describe, expect, it } from "vitest";
import {
  applyMoveToClock,
  detectTermination,
  projectClock,
  settleClock,
  type ClockState,
} from "../clock";
import { ABANDON_MS, DISCONNECT_BUDGET_MS, FIRST_MOVE_TIMEOUT_MS } from "../constants";

const T0 = 1_000_000;

function state(over: Partial<ClockState> = {}): ClockState {
  return {
    plyCount: 2, // đồng hồ đã chạy, đến lượt Trắng
    remainingMs: { w: 60_000, b: 60_000 },
    clockAtMs: T0,
    seenMs: { w: T0, b: T0 },
    budgetMs: { w: DISCONNECT_BUDGET_MS, b: DISCONNECT_BUDGET_MS },
    ...over,
  };
}

describe("projectClock", () => {
  it("trừ thời gian trôi của bên đang đi, bên kia giữ nguyên", () => {
    const p = projectClock(state({ seenMs: { w: T0 + 10_000, b: T0 + 10_000 } }), T0 + 10_000);
    expect(p.remainingMs).toEqual({ w: 50_000, b: 60_000 });
    expect(p.ticking).toBe("w");
    expect(p.flagged).toBeNull();
  });

  it("chưa chạy trong hai nước đầu", () => {
    const p = projectClock(state({ plyCount: 1 }), T0 + 20_000);
    expect(p.remainingMs).toEqual({ w: 60_000, b: 60_000 });
    expect(p.ticking).toBeNull();
  });

  it("báo hết giờ và không cho số âm", () => {
    const s = state({ seenMs: { w: T0 + 70_000, b: T0 + 70_000 } });
    const p = projectClock(s, T0 + 70_000);
    expect(p.remainingMs.w).toBe(0);
    expect(p.flagged).toBe("w");
  });

  it("không bị âm khi giờ lệch (now < clockAt)", () => {
    const p = projectClock(state(), T0 - 5_000);
    expect(p.remainingMs.w).toBe(60_000);
  });
});

describe("AFK: đóng băng đồng hồ", () => {
  it("mất kết nối thì đồng hồ của người đang đi đứng yên từ tín hiệu cuối", () => {
    // Trắng đang đi, tín hiệu cuối lúc T0+5s, giờ là T0+35s
    const s = state({ seenMs: { w: T0 + 5_000, b: T0 + 35_000 } });
    const p = projectClock(s, T0 + 35_000);
    expect(p.remainingMs.w).toBe(55_000); // chỉ mất 5s trước khi mất tín hiệu
    expect(p.ticking).toBeNull();
  });

  it("quay lại thì đồng hồ chạy tiếp, phần mất kết nối không bị trừ", () => {
    const s = state({ seenMs: { w: T0 + 5_000, b: T0 + 35_000 } });
    const settled = settleClock(s, T0 + 35_000); // sự kiện: Trắng quay lại lúc 35s
    expect(settled.remainingMs.w).toBe(55_000);
    expect(settled.budgetMs.w).toBe(DISCONNECT_BUDGET_MS - 30_000);
    expect(settled.clockAtMs).toBe(T0 + 35_000);
    // sau đó Trắng ở lại thêm 10s
    const s2 = { ...settled, seenMs: { w: T0 + 45_000, b: T0 + 45_000 } };
    expect(projectClock(s2, T0 + 45_000).remainingMs.w).toBe(45_000);
  });

  it("người không phải lượt đi mất kết nối thì không làm ngừng đồng hồ của người kia", () => {
    const s = state({ seenMs: { w: T0 + 20_000, b: T0 } }); // Đen im lặng, Trắng đang đi
    const p = projectClock(s, T0 + 20_000);
    expect(p.remainingMs.w).toBe(40_000);
    expect(p.ticking).toBe("w");
  });

  it("hết quỹ đóng băng thì đồng hồ lại chạy dù mất kết nối", () => {
    const s = state({
      budgetMs: { w: 10_000, b: DISCONNECT_BUDGET_MS },
      seenMs: { w: T0, b: T0 + 40_000 },
    });
    const p = projectClock(s, T0 + 40_000);
    // 40s trôi, 10s được đóng băng, 30s bị trừ
    expect(p.remainingMs.w).toBe(30_000);
    expect(p.ticking).toBe("w");
  });

  it("quỹ đóng băng chặn việc ngắt kết nối nhiều lần để câu giờ", () => {
    let s = state();
    // 3 lần mất kết nối 40s, mỗi lần quay lại
    for (let i = 0; i < 3; i += 1) {
      const start = s.clockAtMs;
      const back = start + 40_000;
      s = settleClock({ ...s, seenMs: { w: start, b: back } }, back);
      s = { ...s, seenMs: { w: back, b: back } };
    }
    expect(s.budgetMs.w).toBe(0); // 90s quỹ, đã dùng hết sau lần thứ 3
    expect(s.remainingMs.w).toBe(60_000 - 30_000); // lần 3 chỉ được đóng băng 10s cuối
  });
});

describe("applyMoveToClock", () => {
  it("cộng thời gian thưởng sau khi trừ giờ suy nghĩ", () => {
    const s = state({ seenMs: { w: T0 + 8_000, b: T0 + 8_000 } });
    const after = applyMoveToClock(s, "w", T0 + 8_000, 3_000);
    expect(after.remainingMs.w).toBe(60_000 - 8_000 + 3_000);
    expect(after.plyCount).toBe(3);
    expect(after.clockAtMs).toBe(T0 + 8_000);
  });

  it("hai nước đầu: không trừ giờ, không cộng thưởng, nhưng đặt mốc cho bên kia", () => {
    const s = state({ plyCount: 0 });
    const after = applyMoveToClock(s, "w", T0 + 12_000, 3_000);
    expect(after.remainingMs).toEqual({ w: 60_000, b: 60_000 });
    expect(after.plyCount).toBe(1);
    expect(after.clockAtMs).toBe(T0 + 12_000);
  });
});

describe("detectTermination", () => {
  it("không có gì khi ván bình thường", () => {
    expect(detectTermination(state({ seenMs: { w: T0 + 3_000, b: T0 + 3_000 } }), T0 + 3_000)).toBeNull();
  });

  it("hết giờ", () => {
    const s = state({ seenMs: { w: T0 + 61_000, b: T0 + 61_000 } });
    expect(detectTermination(s, T0 + 61_000)).toEqual({ kind: "timeout", loser: "w" });
  });

  it("một bên im lặng quá hạn thì thua (bỏ cuộc)", () => {
    const now = T0 + ABANDON_MS + 1;
    const s = state({ seenMs: { w: T0, b: now } });
    expect(detectTermination(s, now)).toEqual({ kind: "abandon", loser: "w" });
  });

  it("im lặng quá hạn nhưng chưa tới hạn thì chưa kết thúc", () => {
    const now = T0 + ABANDON_MS - 1;
    const s = state({ seenMs: { w: T0, b: now }, remainingMs: { w: 600_000, b: 600_000 } });
    expect(detectTermination(s, now)).toBeNull();
  });

  it("cả hai cùng mất kết nối thì huỷ ván", () => {
    expect(detectTermination(state(), T0 + ABANDON_MS + 1)).toEqual({ kind: "both_gone" });
  });

  it("không ai đi nước đầu trong hạn thì huỷ", () => {
    const now = T0 + FIRST_MOVE_TIMEOUT_MS + 1;
    const s = state({ plyCount: 0, seenMs: { w: now, b: now } });
    expect(detectTermination(s, now)).toEqual({ kind: "no_first_move" });
  });
});
