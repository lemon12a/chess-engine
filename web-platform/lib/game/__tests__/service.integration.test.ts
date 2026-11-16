import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Đồng hồ của DB được thay bằng đồng hồ giả để mô phỏng thời gian trôi.
const clock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));
vi.mock("../time", () => ({ dbNowMs: async () => clock.now }));

// DB thật (Postgres chạy trong bộ nhớ) với đúng các migration của dự án.
vi.mock("@/db/client", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const schema = await import("@/db/schema");
  const authSchema = await import("@/auth-schema");
  const client = new PGlite();
  const db = drizzle(client, { schema: { ...schema, ...authSchema } });
  await migrate(db, { migrationsFolder: "db/migrations" });
  return { db, ...schema, ...authSchema };
});

import { db, games, matchQueue, moves, ratings, user } from "@/db/client";
import {
  buildView,
  createChallenge,
  findOngoingGameId,
  getGameView,
  joinGame,
  listLiveGames,
  listOpenChallenges,
  makeMove,
  resignGame,
  respondDraw,
} from "../service";
import { joinQueue, leaveQueue, queueStatus } from "../matchmaking";
import { transferGuestData } from "../guest";
import { GameError } from "../errors";

const T0 = 1_700_000_000_000;
let counter = 0;

async function newUser(name = "Người chơi", opts: { guest?: boolean } = {}) {
  counter += 1;
  const id = `user-${counter}`;
  await db.insert(user).values({
    id,
    name: `${name} ${counter}`,
    email: `u${counter}@test.local`,
    isAnonymous: opts.guest ?? false,
  });
  return id;
}

async function setRating(userId: string, rating: number, gamesPlayed = 50) {
  await db
    .insert(ratings)
    .values({ userId, rating, gamesPlayed })
    .onConflictDoUpdate({ target: [ratings.userId, ratings.category], set: { rating, gamesPlayed } });
}

const ratingOf = async (userId: string) =>
  (await db.select().from(ratings).where(eq(ratings.userId, userId)))[0];

interface Opts { baseMs?: number; incrementMs?: number; rated?: boolean }

/** Tạo ván đang chơi: a cầm Trắng, b cầm Đen. */
async function startGame(a: string, b: string, o: Opts = {}) {
  const id = await createChallenge(a, {
    baseMs: o.baseMs ?? 60_000,
    incrementMs: o.incrementMs ?? 2_000,
    color: "w",
    rated: o.rated ?? true,
    isPublic: true,
  });
  await joinGame(b, id);
  return id;
}

async function play(gameId: string, who: string, from: string, to: string, promotion?: string) {
  const view = await getGameView(gameId, who);
  await makeMove(gameId, who, { from, to, promotion, expectedPly: view.plyCount });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "GameError", code });
}

beforeAll(() => {
  expect(GameError).toBeDefined();
});

beforeEach(async () => {
  clock.now = T0;
  await db.delete(matchQueue);
  await db.delete(moves);
  await db.delete(games);
  await db.delete(ratings);
});

describe("tạo và tham gia ván", () => {
  it("thách đấu → tham gia → ván bắt đầu, Elo mặc định 1000", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await createChallenge(a, { baseMs: 300_000, incrementMs: 0, color: "w", rated: true, isPublic: true });

    const waiting = await getGameView(id, a);
    expect(waiting.status).toBe("waiting");
    expect(waiting.viewer).toMatchObject({ side: "w", isCreator: true });
    expect((await listOpenChallenges()).map((c) => c.id)).toContain(id);

    await joinGame(b, id);
    const view = await getGameView(id, b);
    expect(view.status).toBe("ongoing");
    expect(view.viewer.side).toBe("b");
    expect(view.white?.rating).toBe(1000);
    expect(view.black?.rating).toBe(1000);
    expect((await listOpenChallenges()).map((c) => c.id)).not.toContain(id);
  });

  it("không tự chơi với chính mình, không vào hai ván cùng lúc", async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const id = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    await expectCode(joinGame(a, id), "bad_request");
    await joinGame(b, id);
    await expectCode(
      createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true }),
      "already_in_game",
    );
    const other = await createChallenge(c, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    await expectCode(joinGame(b, other), "already_in_game");
    expect(await findOngoingGameId(db, b)).toBe(id);
  });

  it("thách đấu mà chủ đã đi mất thì hết hạn", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "b", rated: true, isPublic: true });
    clock.now = T0 + 100_000;
    await expectCode(joinGame(b, id), "expired");
    expect((await getGameView(id, null)).status).toBe("aborted");
  });

  it("tạo thách đấu mới thì thách đấu cũ bị huỷ", async () => {
    const a = await newUser();
    const first = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    const second = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    expect((await getGameView(first, a)).status).toBe("aborted");
    expect((await getGameView(second, a)).status).toBe("waiting");
  });
});

describe("đi quân", () => {
  it("chiếu bí: ván kết thúc, Elo cập nhật đúng, có PGN", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black);
    clock.now = T0 + 1000;
    await play(id, white, "f2", "f3");
    await play(id, black, "e7", "e5");
    await play(id, white, "g2", "g4");
    await play(id, black, "d8", "h4");

    const view = await getGameView(id, white);
    expect(view.status).toBe("finished");
    expect(view.result).toBe("black");
    expect(view.reason).toBe("checkmate");
    expect(view.black?.ratingAfter).toBe(1020);
    expect(view.white?.ratingAfter).toBe(980);
    expect((await ratingOf(black)).rating).toBe(1020);
    expect((await ratingOf(white)).rating).toBe(980);
    expect((await ratingOf(black)).wins).toBe(1);
    expect((await ratingOf(white)).losses).toBe(1);
    const [row] = await db.select().from(games).where(eq(games.id, id));
    expect(row.pgn).toContain("0-1");
    expect(row.pgn).toContain("Qh4#");
  });

  it("từ chối nước đi sai: phi pháp, sai lượt, lệch phiên bản, người ngoài", async () => {
    const white = await newUser();
    const black = await newUser();
    const stranger = await newUser();
    const id = await startGame(white, black);
    await expectCode(makeMove(id, black, { from: "e7", to: "e5", expectedPly: 0 }), "not_your_turn");
    await expectCode(makeMove(id, white, { from: "e2", to: "e5", expectedPly: 0 }), "illegal_move");
    await expectCode(makeMove(id, white, { from: "e2", to: "e4", expectedPly: 5 }), "out_of_sync");
    await expectCode(makeMove(id, stranger, { from: "e2", to: "e4", expectedPly: 0 }), "forbidden");
    await play(id, white, "e2", "e4");
    expect((await getGameView(id, white)).sans).toEqual(["e4"]);
  });

  it("phong cấp bắt buộc chọn quân, và quân được chọn xuất hiện trong nước đi", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black);
    const line: [string, string, string][] = [
      ["w", "a2", "a4"], ["b", "b7", "b5"], ["w", "a4", "b5"], ["b", "a7", "a6"],
      ["w", "b5", "a6"], ["b", "g8", "f6"], ["w", "a6", "a7"], ["b", "h7", "h6"],
    ];
    for (const [side, from, to] of line) await play(id, side === "w" ? white : black, from, to);
    // thiếu quân phong cấp thì bị từ chối
    await expectCode(makeMove(id, white, { from: "a7", to: "b8", expectedPly: 8 }), "illegal_move");
    // quân không hợp lệ cũng bị từ chối
    await expectCode(makeMove(id, white, { from: "a7", to: "b8", promotion: "k", expectedPly: 8 }), "illegal_move");
    await makeMove(id, white, { from: "a7", to: "b8", promotion: "n", expectedPly: 8 });
    expect((await getGameView(id, white)).sans.at(-1)).toBe("axb8=N");
  });
});

describe("đồng hồ", () => {
  it("hai nước đầu chưa tính giờ; sau đó trừ giờ suy nghĩ và cộng thời gian thưởng", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs: 60_000, incrementMs: 2_000 });
    clock.now = T0 + 20_000; // nghĩ 20s cho nước đầu: không bị tính
    await play(id, white, "e2", "e4");
    clock.now = T0 + 25_000;
    await play(id, black, "e7", "e5");
    let view = await getGameView(id, white);
    expect(view.clocks).toMatchObject({ whiteMs: 60_000, blackMs: 60_000, ticking: "w" });

    clock.now = T0 + 30_000; // Trắng nghĩ 5s
    await play(id, white, "g1", "f3");
    view = await getGameView(id, white);
    expect(view.clocks.whiteMs).toBe(60_000 - 5_000 + 2_000);
    expect(view.clocks.ticking).toBe("b");

    clock.now = T0 + 33_000; // Đen nghĩ 3s
    await play(id, black, "b8", "c6");
    view = await getGameView(id, white);
    expect(view.clocks.blackMs).toBe(60_000 - 3_000 + 2_000); // Đen chỉ nghĩ 3s kể từ lúc Trắng đi
  });

  it("hết giờ: đối thủ thắng, tính Elo; người bên kia poll là đủ để kích hoạt", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs: 60_000, incrementMs: 0 });
    await play(id, white, "e2", "e4");
    await play(id, black, "e7", "e5");
    await play(id, white, "g1", "f3");
    await play(id, black, "b8", "c6"); // 4 nước: đủ điều kiện tính Elo
    // Trắng vẫn ở lại (poll đều) nhưng không đi
    for (let t = 10_000; t <= 60_000; t += 10_000) {
      clock.now = T0 + t;
      await getGameView(id, white);
      await getGameView(id, black);
    }
    clock.now = T0 + 61_000;
    const view = await getGameView(id, black);
    expect(view.status).toBe("finished");
    expect(view.reason).toBe("timeout");
    expect(view.result).toBe("black");
    expect(view.clocks.whiteMs).toBe(0);
    expect((await ratingOf(black)).rating).toBe(1020);
  });

  it("hết giờ khi mới đi ít nước thì huỷ ván, không tính Elo", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs: 60_000, incrementMs: 0 });
    await play(id, white, "e2", "e4");
    await play(id, black, "e7", "e5"); // mới 2 nước
    for (let t = 10_000; t <= 60_000; t += 10_000) {
      clock.now = T0 + t;
      await getGameView(id, white);
      await getGameView(id, black);
    }
    clock.now = T0 + 61_000;
    const view = await getGameView(id, black);
    expect(view.status).toBe("aborted");
    expect(await ratingOf(black)).toBeUndefined();
  });

  it("không ai đi nước đầu trong hạn thì huỷ ván", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black);
    clock.now = T0 + 20_000;
    await getGameView(id, white);
    await getGameView(id, black);
    clock.now = T0 + 31_000;
    const view = await getGameView(id, black);
    expect(view.status).toBe("aborted");
    expect(view.reason).toBe("aborted_no_move");
  });

  it("thao tác lên ván đã quá hạn: ván kết thúc, báo game_over", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs: 60_000, incrementMs: 0 });
    await play(id, white, "e2", "e4");
    await play(id, black, "e7", "e5");
    await play(id, white, "g1", "f3");
    await play(id, black, "b8", "c6");
    clock.now = T0 + 100_000; // Trắng lẽ ra hết giờ từ lâu và cả hai đã im lặng
    await expectCode(makeMove(id, white, { from: "f1", to: "c4", expectedPly: 4 }), "game_over");
    expect((await getGameView(id, white)).status).toBe("aborted"); // cả hai cùng mất kết nối
  });
});

describe("AFK / mất kết nối", () => {
  async function fourPlies(baseMs = 60_000) {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs, incrementMs: 2_000 });
    clock.now = T0 + 1_000; await play(id, white, "e2", "e4");
    clock.now = T0 + 2_000; await play(id, black, "e7", "e5");
    clock.now = T0 + 7_000; await play(id, white, "g1", "f3"); // +2s thưởng: 57s
    clock.now = T0 + 10_000; await play(id, black, "b8", "c6");
    return { white, black, id };
  }

  it("người đang đi mất kết nối: đồng hồ đứng yên, đối thủ thấy cảnh báo; 60s sau thì thua", async () => {
    const { white, black, id } = await fourPlies();
    clock.now = T0 + 40_000; // Trắng im lặng 33s, Đen vẫn poll
    let view = await getGameView(id, black);
    expect(view.status).toBe("ongoing");
    expect(view.presence.offline.w).toBe(true);
    expect(view.clocks.ticking).toBeNull();
    expect(view.clocks.whiteMs).toBe(57_000); // đứng yên, không bị trừ 30s

    clock.now = T0 + 50_000;
    view = await getGameView(id, black);
    expect(view.clocks.whiteMs).toBe(57_000);
    expect(view.presence.abandonInMs.w).toBeGreaterThan(0);

    clock.now = T0 + 68_000; // Trắng im lặng 61s tính từ nước đi cuối (T0+7s)
    view = await getGameView(id, black);
    expect(view.status).toBe("finished");
    expect(view.reason).toBe("abandon");
    expect(view.result).toBe("black");
    expect((await ratingOf(black)).rating).toBe(1020);
    void white;
  });

  it("quay lại kịp thì đồng hồ chạy tiếp, phần mất kết nối không bị trừ", async () => {
    const { white, black, id } = await fourPlies();
    clock.now = T0 + 40_000;
    await getGameView(id, black);
    clock.now = T0 + 45_000; // Trắng quay lại
    const view = await getGameView(id, white);
    expect(view.status).toBe("ongoing");
    expect(view.presence.offline.w).toBe(false);
    expect(view.clocks.ticking).toBe("w");
    expect(view.clocks.whiteMs).toBeGreaterThanOrEqual(57_000 - 5_000 - 100);
    expect(view.clocks.whiteMs).toBeLessThanOrEqual(57_000);
    void black;
  });

  it("cả hai cùng mất kết nối thì huỷ ván, không ai mất Elo", async () => {
    const { white, black, id } = await fourPlies();
    clock.now = T0 + 200_000;
    await getGameView(id, null); // khán giả poll cũng đủ kích hoạt việc xử lý
    const [row] = await db.select().from(games).where(eq(games.id, id));
    expect(row.status).toBe("aborted");
    expect(row.reason).toBe("aborted_both_gone");
    expect(await ratingOf(white)).toBeUndefined();
    expect(await ratingOf(black)).toBeUndefined();
    // khán giả chỉ thấy kết quả sau khi hết độ trễ
    expect((await getGameView(id, null)).status).toBe("ongoing");
    clock.now = T0 + 211_000;
    expect((await getGameView(id, null)).status).toBe("aborted");
  });
});

describe("xin thua / hòa / giao hữu", () => {
  it("xin thua sớm thì huỷ ván, không tính Elo; xin thua muộn thì tính", async () => {
    const a = await newUser();
    const b = await newUser();
    const early = await startGame(a, b);
    await play(early, a, "e2", "e4");
    await resignGame(early, b);
    expect((await getGameView(early, a)).status).toBe("aborted");
    expect(await ratingOf(a)).toBeUndefined();

    const c = await newUser();
    const d = await newUser();
    const late = await startGame(c, d);
    for (const [who, f, t] of [[c, "e2", "e4"], [d, "e7", "e5"], [c, "g1", "f3"], [d, "b8", "c6"]] as const) {
      await play(late, who, f, t);
    }
    await resignGame(late, d);
    const view = await getGameView(late, c);
    expect(view).toMatchObject({ status: "finished", result: "white", reason: "resign" });
    expect((await ratingOf(c)).rating).toBe(1020);
  });

  it("huỷ thách đấu đang chờ", async () => {
    const a = await newUser();
    const id = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    await resignGame(id, a);
    expect((await getGameView(id, a)).status).toBe("aborted");
  });

  it("xin hòa → chấp nhận: hòa, hai người bằng Elo không đổi điểm", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await startGame(a, b);
    for (const [who, f, t] of [[a, "e2", "e4"], [b, "e7", "e5"], [a, "g1", "f3"], [b, "b8", "c6"]] as const) {
      await play(id, who, f, t);
    }
    await respondDraw(id, a, "offer");
    expect((await getGameView(id, b)).drawOfferedBy).toBe("w");
    expect((await getGameView(id, a)).drawOfferedBy).toBe("w");
    await expectCode(respondDraw(id, a, "accept"), "invalid_state"); // không tự chấp nhận lời của mình
    await respondDraw(id, b, "accept");
    const view = await getGameView(id, a);
    expect(view).toMatchObject({ status: "finished", result: "draw", reason: "agreement" });
    expect((await ratingOf(a)).rating).toBe(1000);
    expect((await ratingOf(a)).draws).toBe(1);
  });

  it("đi quân tức là từ chối lời xin hòa", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await startGame(a, b);
    await play(id, a, "e2", "e4");
    await respondDraw(id, a, "offer");
    await play(id, b, "e7", "e5");
    expect((await getGameView(id, a)).drawOfferedBy).toBeNull();
  });

  it("ván giao hữu không đổi Elo dù có người thắng", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { rated: false });
    await play(id, white, "f2", "f3");
    await play(id, black, "e7", "e5");
    await play(id, white, "g2", "g4");
    await play(id, black, "d8", "h4");
    const view = await getGameView(id, white);
    expect(view.status).toBe("finished");
    expect(view.rated).toBe(false);
    expect(view.black?.ratingAfter).toBeNull();
    expect(await ratingOf(black)).toBeUndefined();
  });

  it("chênh lệch Elo: thắng người mạnh hơn được nhiều điểm hơn", async () => {
    const strong = await newUser();
    const weak = await newUser();
    await setRating(strong, 1400);
    await setRating(weak, 1000);
    const id = await startGame(strong, weak); // strong cầm Trắng
    await play(id, strong, "f2", "f3");
    await play(id, weak, "e7", "e5");
    await play(id, strong, "g2", "g4");
    await play(id, weak, "d8", "h4"); // weak thắng
    expect((await ratingOf(weak)).rating).toBeGreaterThan(1000 + 15);
    expect((await ratingOf(strong)).rating).toBeLessThan(1400 - 15);
    // tổng điểm thay đổi của hai người cân bằng khi cùng hệ số K
    const gain = (await ratingOf(weak)).rating - 1000;
    const loss = 1400 - (await ratingOf(strong)).rating;
    expect(Math.abs(gain - loss)).toBeLessThanOrEqual(1);
  });
});

describe("khán giả và độ trễ", () => {
  it("khán giả thấy ván trễ; kết quả chỉ hiện sau khi hết độ trễ", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black);
    clock.now = T0 + 1_000; await play(id, white, "f2", "f3");
    clock.now = T0 + 2_000; await play(id, black, "e7", "e5");
    clock.now = T0 + 3_000; await play(id, white, "g2", "g4");
    clock.now = T0 + 4_000; await play(id, black, "d8", "h4");

    clock.now = T0 + 5_000;
    let spectator = await getGameView(id, null);
    expect(spectator.sans).toEqual([]);
    expect(spectator.status).toBe("ongoing");
    expect(spectator.result).toBeNull();
    expect(spectator.delayMs).toBe(10_000);
    const player = await getGameView(id, white);
    expect(player.status).toBe("finished"); // người chơi không bị trễ
    expect(player.delayMs).toBe(0);

    clock.now = T0 + 12_500;
    spectator = await getGameView(id, null);
    expect(spectator.sans).toEqual(["f3", "e5"]);
    expect(spectator.status).toBe("ongoing");

    clock.now = T0 + 15_000;
    spectator = await getGameView(id, null);
    expect(spectator.sans).toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(spectator.status).toBe("finished");
    expect(spectator.result).toBe("black");
  });

  it("khán giả không thấy lời xin hòa hay trạng thái mất kết nối", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await startGame(a, b);
    await play(id, a, "e2", "e4");
    await respondDraw(id, a, "offer");
    clock.now = T0 + 20_000;
    const view = await getGameView(id, null);
    expect(view.drawOfferedBy).toBeNull();
    expect(view.presence.offline).toEqual({ w: false, b: false });
  });

  it("đồng hồ của khán giả chạy theo thời điểm đã trễ", async () => {
    const white = await newUser();
    const black = await newUser();
    const id = await startGame(white, black, { baseMs: 60_000, incrementMs: 0 });
    clock.now = T0 + 1_000; await play(id, white, "e2", "e4");
    clock.now = T0 + 2_000; await play(id, black, "e7", "e5");
    clock.now = T0 + 30_000; // khán giả thấy thế cờ tại T0+20s: Trắng đã nghĩ 18s
    await getGameView(id, white);
    await getGameView(id, black);
    const view = await getGameView(id, null);
    expect(view.sans).toEqual(["e4", "e5"]);
    expect(view.clocks.ticking).toBe("w");
    expect(view.clocks.whiteMs).toBe(60_000 - 18_000);
  });

  it("danh sách xem trực tiếp có ván đang chơi, không có ván link riêng", async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const d = await newUser();
    const pub = await startGame(a, b);
    const priv = await createChallenge(c, { baseMs: 60_000, incrementMs: 0, color: "w", rated: false, isPublic: false });
    await joinGame(d, priv);
    const ids = (await listLiveGames()).map((g) => g.id);
    expect(ids).toContain(pub);
    expect(ids).not.toContain(priv);
    expect((await getGameView(priv, null)).status).toBe("ongoing"); // vào bằng link vẫn xem được
  });
});

describe("buildView (hàm thuần)", () => {
  it("không lộ thông tin người chơi cho khán giả", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await startGame(a, b);
    const [row] = await db.select().from(games).where(eq(games.id, id));
    const view = buildView(row, [], {}, null, T0);
    expect(view.viewer).toEqual({ userId: null, side: null, isCreator: false });
    expect(view.white?.name).toBe("Khách đã rời");
  });
});

describe("ghép trận", () => {
  it("hai người cùng thể thức được ghép vào một ván tính điểm", async () => {
    const a = await newUser();
    const b = await newUser();
    await joinQueue(a, "5+0");
    expect((await queueStatus(a)).state).toBe("searching");
    await joinQueue(b, "5+0");
    const sb = await queueStatus(b);
    expect(sb.state).toBe("matched");
    const sa = await queueStatus(a); // người kia không cần tự ghép, chỉ nhận kết quả
    expect(sa).toEqual(sb);
    const gameId = sb.state === "matched" ? sb.gameId : "";
    const view = await getGameView(gameId, a);
    expect(view.rated).toBe(true);
    expect(view.status).toBe("ongoing");
    expect(view.timeControl.label).toBe("5+0");
    expect([view.white?.id, view.black?.id].sort()).toEqual([a, b].sort());
    expect(await db.select().from(matchQueue)).toHaveLength(0);
    // đang trong ván thì không vào hàng chờ được nữa
    await expectCode(joinQueue(a, "5+0"), "already_in_game");
  });

  it("khác thể thức thì không ghép", async () => {
    const a = await newUser();
    const b = await newUser();
    await joinQueue(a, "5+0");
    await joinQueue(b, "3+2");
    expect((await queueStatus(b)).state).toBe("searching");
    expect((await queueStatus(a)).state).toBe("searching");
  });

  it("chênh lệch Elo lớn: chờ lâu thì phạm vi mở rộng mới ghép được", async () => {
    const strong = await newUser();
    const weak = await newUser();
    await setRating(strong, 1600);
    await setRating(weak, 1000);
    await joinQueue(strong, "10+0");
    await joinQueue(weak, "10+0");
    let status = await queueStatus(weak);
    expect(status.state).toBe("searching");
    let matchedAt = -1;
    for (let t = 5_000; t <= 60_000; t += 5_000) {
      clock.now = T0 + t;
      await queueStatus(strong);
      status = await queueStatus(weak);
      if (status.state === "matched") { matchedAt = t; break; }
    }
    expect(matchedAt).toBeGreaterThanOrEqual(30_000); // cần phạm vi >= 600
    expect(matchedAt).toBeLessThan(60_000);
  });

  it("mục chờ lâu không poll bị coi là đã rời", async () => {
    const a = await newUser();
    const b = await newUser();
    await joinQueue(a, "5+0");
    clock.now = T0 + 20_000;
    await joinQueue(b, "5+0");
    expect((await queueStatus(b)).state).toBe("searching");
  });

  it("rời hàng chờ", async () => {
    const a = await newUser();
    await joinQueue(a, "5+0");
    await leaveQueue(a);
    expect((await queueStatus(a)).state).toBe("idle");
  });

  it("thể thức không có trong danh sách bị từ chối", async () => {
    const a = await newUser();
    await expectCode(joinQueue(a, "1+0"), "bad_request");
  });

  it("vào hàng chờ thì thách đấu đang chờ bị huỷ", async () => {
    const a = await newUser();
    const id = await createChallenge(a, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    await joinQueue(a, "5+0");
    expect((await getGameView(id, a)).status).toBe("aborted");
  });
});

describe("khách đăng ký tài khoản", () => {
  it("tài khoản mới: nhận Elo và các ván của khách", async () => {
    const guest = await newUser("Khách", { guest: true });
    const opponent = await newUser();
    await setRating(guest, 1137, 12);
    const id = await startGame(guest, opponent);
    const fresh = await newUser("Mới");
    await transferGuestData(guest, fresh);
    expect((await ratingOf(fresh)).rating).toBe(1137);
    const [row] = await db.select().from(games).where(eq(games.id, id));
    expect(row.whitePlayerId).toBe(fresh);
    // better-auth xoá tài khoản khách sau đó
    await db.delete(user).where(eq(user.id, guest));
    expect((await db.select().from(ratings).where(eq(ratings.userId, guest)))).toHaveLength(0);
  });

  it("đăng nhập vào tài khoản đã có lịch sử: bỏ dữ liệu khách, ván cũ vẫn còn", async () => {
    const guest = await newUser("Khách", { guest: true });
    const opponent = await newUser();
    const veteran = await newUser("Cũ");
    await setRating(guest, 1500, 40);
    await setRating(veteran, 900, 40);
    const id = await startGame(guest, opponent);
    await transferGuestData(guest, veteran);
    expect((await ratingOf(veteran)).rating).toBe(900); // không bị trộn
    await db.delete(user).where(eq(user.id, guest));
    const [row] = await db.select().from(games).where(eq(games.id, id));
    expect(row).toBeDefined();
    expect(row.whitePlayerId).toBeNull(); // khoá ngoại SET NULL, không chặn việc xoá
  });
});
