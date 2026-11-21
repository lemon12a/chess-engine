import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// DB thật (Postgres chạy trong bộ nhớ) với đúng các migration của dự án.
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

import { aiGames, db, user } from "@/db/client";
import { createAiGame, saveAiGame } from "../aiGames";
import { transferGuestData } from "../guest";
import { GameError } from "../errors";

let counter = 0;
async function newUser(guest = false) {
  counter += 1;
  const id = `ai-user-${counter}`;
  await db.insert(user).values({
    id,
    name: `Người chơi ${counter}`,
    email: `ai${counter}@test.local`,
    isAnonymous: guest,
  });
  return id;
}

const FOOLS_MATE = ["f3", "e5", "g4", "Qh4#"]; // Đen chiếu bí sau 4 nước
const rowOf = async (id: string) =>
  (await db.select().from(aiGames).where(eq(aiGames.id, id)))[0];

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(GameError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("lịch sử ván với AI", () => {
  let me: string;
  beforeAll(async () => {
    me = await newUser();
  });

  it("từ chối màu quân hoặc mức độ không hợp lệ", async () => {
    await expectError(createAiGame(me, { humanColor: "x", levelId: "2" }), "bad_request");
    await expectError(createAiGame(me, { humanColor: "w", levelId: "99" }), "bad_request");
  });

  it("lưu dần từng nước, ván còn tiếp thì vẫn là ongoing", async () => {
    const id = await createAiGame(me, { humanColor: "w", levelId: "2" });
    const saved = await saveAiGame(me, id, { sans: ["e4", "e5", "Nf3"] });
    expect(saved).toMatchObject({ status: "ongoing", result: null, plyCount: 3 });
    const row = await rowOf(id);
    expect(row.sans).toEqual(["e4", "e5", "Nf3"]);
    expect(row.pgn).toContain("1. e4 e5 2. Nf3");
    expect(row.pgn).toContain('[Result "*"]');
  });

  it("hoàn tác: lưu danh sách ngắn hơn thì ván lùi lại đúng", async () => {
    const id = await createAiGame(me, { humanColor: "w", levelId: "1" });
    await saveAiGame(me, id, { sans: ["e4", "e5", "Nf3", "Nc6"] });
    await saveAiGame(me, id, { sans: ["e4", "e5"] });
    expect((await rowOf(id)).plyCount).toBe(2);
    await saveAiGame(me, id, { sans: [] });
    expect((await rowOf(id)).sans).toEqual([]);
  });

  it("tự suy ra kết quả khi chiếu bí và chốt ván", async () => {
    const id = await createAiGame(me, { humanColor: "b", levelId: "3" });
    const saved = await saveAiGame(me, id, { sans: FOOLS_MATE });
    expect(saved).toMatchObject({ status: "finished", result: "black", reason: "checkmate" });
    const row = await rowOf(id);
    expect(row.finishedAt).not.toBeNull();
    expect(row.pgn).toContain('[Result "0-1"]');
    expect(row.pgn).toContain("ChessNet AI (Khó)");
  });

  it("xin thua: người cầm Trắng xin thua thì Đen thắng", async () => {
    const id = await createAiGame(me, { humanColor: "w", levelId: "2" });
    const saved = await saveAiGame(me, id, { sans: ["e4", "e5"], resigned: true });
    expect(saved).toMatchObject({ status: "finished", result: "black", reason: "resign" });
  });

  it("ván đã kết thúc thì không sửa được, nhưng lưu lại y hệt thì không lỗi", async () => {
    const id = await createAiGame(me, { humanColor: "w", levelId: "2" });
    await saveAiGame(me, id, { sans: FOOLS_MATE });
    await expect(saveAiGame(me, id, { sans: FOOLS_MATE })).resolves.toMatchObject({
      status: "finished",
    });
    await expectError(saveAiGame(me, id, { sans: ["f3", "e5"] }), "invalid_state");
    expect((await rowOf(id)).plyCount).toBe(4);
  });

  it("từ chối nước đi phi pháp hoặc dữ liệu sai kiểu, ván cũ giữ nguyên", async () => {
    const id = await createAiGame(me, { humanColor: "w", levelId: "2" });
    await saveAiGame(me, id, { sans: ["e4"] });
    await expectError(saveAiGame(me, id, { sans: ["e4", "e4"] }), "bad_request");
    await expectError(saveAiGame(me, id, { sans: "e4" }), "bad_request");
    await expectError(saveAiGame(me, id, { sans: [1, 2] }), "bad_request");
    expect((await rowOf(id)).sans).toEqual(["e4"]);
  });

  it("người khác không lưu được vào ván của mình", async () => {
    const other = await newUser();
    const id = await createAiGame(me, { humanColor: "w", levelId: "2" });
    await expectError(saveAiGame(other, id, { sans: ["e4"] }), "not_found");
    await expectError(saveAiGame(me, "khong-phai-uuid", { sans: [] }), "not_found");
  });

  it("khách đăng ký thì lịch sử ván với AI chuyển sang tài khoản mới", async () => {
    const guest = await newUser(true);
    const member = await newUser();
    const id = await createAiGame(guest, { humanColor: "w", levelId: "2" });
    await saveAiGame(guest, id, { sans: ["e4", "e5"] });
    await transferGuestData(guest, member);
    expect((await rowOf(id)).userId).toBe(member);
  });

  it("khách đăng nhập vào tài khoản đã có lịch sử vẫn giữ lại ván với AI", async () => {
    const guest = await newUser(true);
    const member = await newUser();
    const memberGame = await createAiGame(member, { humanColor: "b", levelId: "1" });
    const guestGame = await createAiGame(guest, { humanColor: "w", levelId: "2" });
    await transferGuestData(guest, member);
    expect((await rowOf(guestGame)).userId).toBe(member);
    expect((await rowOf(memberGame)).userId).toBe(member);
  });
});
