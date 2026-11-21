import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Đồng hồ của DB được thay bằng đồng hồ giả để mô phỏng thời gian trôi.
const clock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));
vi.mock("../time", () => ({ dbNowMs: async () => clock.now }));

vi.mock("@/db/client", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const schema = await import("@/db/schema");
  const authSchema = await import("@/auth-schema");
  const db = drizzle(new PGlite(), { schema: { ...schema, ...authSchema } });
  await migrate(db, { migrationsFolder: "db/migrations" });
  return { db, ...schema, ...authSchema };
});

import { db, games, user } from "@/db/client";
import { createAiGame, saveAiGame } from "../aiGames";
import { getReplay, listHistory } from "../history";
import { createChallenge, getGameView, joinGame, makeMove } from "../service";

let counter = 0;
async function newUser(name = "Người chơi") {
  counter += 1;
  const id = `hist-user-${counter}`;
  await db.insert(user).values({
    id,
    name: `${name} ${counter}`,
    email: `h${counter}@test.local`,
    isAnonymous: false,
  });
  return id;
}

async function play(gameId: string, who: string, from: string, to: string) {
  const view = await getGameView(gameId, who);
  await makeMove(gameId, who, { from, to, expectedPly: view.plyCount });
}

/** a (Trắng) thua b (Đen) bằng nước chiếu bí kinh điển sau 4 nửa nước. */
async function playFoolsMate(a: string, b: string, isPublic = true) {
  const id = await createChallenge(a, {
    baseMs: 60_000,
    incrementMs: 0,
    color: "w",
    rated: true,
    isPublic,
  });
  await joinGame(b, id);
  await play(id, a, "f2", "f3");
  await play(id, b, "e7", "e5");
  await play(id, a, "g2", "g4");
  await play(id, b, "d8", "h4");
  return id;
}

describe("lịch sử ván đấu", () => {
  it("gộp ván giữa người và ván với AI của một người, mới nhất lên đầu", async () => {
    const me = await newUser("Tôi");
    const rival = await newUser("Đối thủ");

    const pvpId = await playFoolsMate(me, rival);
    clock.now += 1000;
    await new Promise((resolve) => setTimeout(resolve, 20)); // updatedAt của ván AI mới hơn
    const aiId = await createAiGame(me, { humanColor: "w", levelId: "3" });
    await saveAiGame(me, aiId, { sans: ["e4", "e5"] });

    const { items, hasMore } = await listHistory(me);
    expect(hasMore).toBe(false);
    expect(items.map((item) => item.id)).toEqual([aiId, pvpId]);

    const ai = items[0];
    expect(ai).toMatchObject({
      kind: "ai",
      outcome: "unfinished",
      levelLabel: "Khó",
      opponent: { name: "ChessNet AI" },
      myColor: "w",
    });

    const pvp = items[1];
    expect(pvp).toMatchObject({
      kind: "pvp",
      outcome: "loss",
      reason: "checkmate",
      timeControl: "1+0",
      rated: true,
      myColor: "w",
    });
    expect(pvp.opponent.name).toContain("Đối thủ");
    expect(pvp.ratingBefore).toBe(1000);
    expect(pvp.ratingAfter).toBeLessThan(1000);

    // đối thủ nhìn cùng ván đó thì là thắng
    const theirs = (await listHistory(rival)).items;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ id: pvpId, outcome: "win", myColor: "b" });
  });

  it("lọc theo loại và phân trang", async () => {
    const me = await newUser();
    const rival = await newUser();
    await playFoolsMate(me, rival);
    for (let i = 0; i < 2; i += 1) {
      const id = await createAiGame(me, { humanColor: "b", levelId: "1" });
      await saveAiGame(me, id, { sans: ["d4"] });
    }

    expect((await listHistory(me, { filter: "ai" })).items.every((i) => i.kind === "ai")).toBe(true);
    expect((await listHistory(me, { filter: "pvp" })).items).toHaveLength(1);

    const first = await listHistory(me, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await listHistory(me, { limit: 2, offset: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it("không đưa vào lịch sử thách đấu chưa ai nhận hoặc ván AI chưa đi nước nào", async () => {
    const me = await newUser();
    await createChallenge(me, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    const empty = await createAiGame(me, { humanColor: "w", levelId: "2" });
    await saveAiGame(me, empty, { sans: [] });
    expect((await listHistory(me)).items).toHaveLength(0);
  });

  it("xem lại ván giữa người: người chơi xem được, người ngoài chỉ sau độ trễ khán giả", async () => {
    const a = await newUser();
    const b = await newUser();
    const stranger = await newUser();
    const id = await playFoolsMate(a, b);

    const mine = await getReplay("pvp", id, a);
    expect(mine).toMatchObject({
      kind: "pvp",
      status: "finished",
      result: "black",
      reason: "checkmate",
      myColor: "w",
      sans: ["f3", "e5", "g4", "Qh4#"],
    });
    expect(mine?.pgn).toContain("0-1");
    expect(mine?.ratings.white?.before).toBe(1000);

    expect(await getReplay("pvp", id, stranger)).toBeNull(); // ván vừa xong, còn trong độ trễ
    clock.now += 11_000;
    expect(await getReplay("pvp", id, stranger)).toMatchObject({ myColor: null });
    expect(await getReplay("pvp", id, null)).toMatchObject({ myColor: null });
  });

  it("ván riêng tư chỉ người chơi xem lại được; ván chưa xong thì không ai xem được", async () => {
    const a = await newUser();
    const b = await newUser();
    const stranger = await newUser();
    const privateId = await playFoolsMate(a, b, false);
    clock.now += 60_000;
    expect(await getReplay("pvp", privateId, b)).not.toBeNull();
    expect(await getReplay("pvp", privateId, stranger)).toBeNull();

    const c = await newUser();
    const d = await newUser();
    const ongoing = await createChallenge(c, { baseMs: 60_000, incrementMs: 0, color: "w", rated: true, isPublic: true });
    await joinGame(d, ongoing);
    await play(ongoing, c, "e2", "e4");
    expect(await getReplay("pvp", ongoing, c)).toBeNull();
    await db.update(games).set({ isPublic: true }).where(eq(games.id, ongoing));
    expect(await getReplay("pvp", ongoing, stranger)).toBeNull();
  });

  it("xem lại ván với AI: chỉ chủ ván; id sai trả về null", async () => {
    const me = await newUser();
    const other = await newUser();
    const id = await createAiGame(me, { humanColor: "b", levelId: "4" });
    await saveAiGame(me, id, { sans: ["e4", "e5", "Nf3"] });

    const replay = await getReplay("ai", id, me);
    expect(replay).toMatchObject({
      kind: "ai",
      status: "ongoing",
      myColor: "b",
      levelLabel: "Rất khó",
      sans: ["e4", "e5", "Nf3"],
    });
    expect(replay?.white.name).toBe("ChessNet AI");
    expect(replay?.black.name).toContain("Người chơi");
    expect(await getReplay("ai", id, other)).toBeNull();
    expect(await getReplay("ai", id, null)).toBeNull();
    expect(await getReplay("ai", "khong-phai-uuid", me)).toBeNull();
  });
});
