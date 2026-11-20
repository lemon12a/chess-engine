import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");

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

import { db, games, ratings, user } from "@/db/client";
import { auth } from "@/lib/auth";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as gamesGet, POST as gamesPost } from "@/app/api/games/route";
import { GET as gameGet } from "@/app/api/games/[id]/route";
import { POST as joinPost } from "@/app/api/games/[id]/join/route";
import { POST as movePost } from "@/app/api/games/[id]/move/route";
import { GET as matchGet, POST as matchPost } from "@/app/api/matchmaking/route";
import { GET as watchGet } from "@/app/api/watch/route";

const ORIGIN = "http://localhost:3000";

/** Gom Set-Cookie của phản hồi thành một header Cookie. */
function cookieFrom(response: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split("; ").filter(Boolean)) {
    const [k, ...v] = part.split("=");
    jar.set(k, v.join("="));
  }
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [k, ...v] = pair.split("=");
    jar.set(k, v.join("="));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function signInAsGuest(): Promise<string> {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

const call = (cookie: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response) => response.json();

beforeAll(() => {
  expect(auth).toBeDefined();
});

describe("khách vào chơi qua HTTP thật", () => {
  it("khách có tên 'Khách NNNN', cờ isAnonymous, Elo 1000", async () => {
    const cookie = await signInAsGuest();
    const me = await json(await meRoute(call(cookie, "/api/me")));
    expect(me.user.isGuest).toBe(true);
    expect(me.user.name).toMatch(/^Khách \d{4}$/);
    expect(me.rating).toBe(1000);
    const [row] = await db.select().from(user).where(eq(user.id, me.user.id));
    expect(row.isAnonymous).toBe(true);
  });

  it("chưa có phiên: /api/me trả về user null; tạo ván bị từ chối 401", async () => {
    const me = await json(await meRoute(call("", "/api/me")));
    expect(me.user).toBeNull();
    const response = await gamesPost(call("", "/api/games", { method: "POST", body: { timeControlId: "5+0" } }));
    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe("unauthorized");
  });

  it("hai khách: thách đấu → nhận → chơi tới chiếu bí → Elo cập nhật", async () => {
    const white = await signInAsGuest();
    const black = await signInAsGuest();

    const created = await json(
      await gamesPost(call(white, "/api/games", { method: "POST", body: { timeControlId: "5+0", color: "w", rated: true, isPublic: true } })),
    );
    expect(created.id).toBeTruthy();

    const open = await json(await gamesGet());
    expect(open.challenges.map((c: { id: string }) => c.id)).toContain(created.id);

    // người chưa đăng nhập xem được ván nhưng không vào chơi được
    const peek = await json(await gameGet(call("", `/api/games/${created.id}`), ctx(created.id)));
    expect(peek.game.status).toBe("waiting");
    expect(peek.game.viewer.side).toBeNull();
    const denied = await joinPost(call("", `/api/games/${created.id}/join`, { method: "POST" }), ctx(created.id));
    expect(denied.status).toBe(401);

    const joined = await json(await joinPost(call(black, `/api/games/${created.id}/join`, { method: "POST" }), ctx(created.id)));
    expect(joined.game.status).toBe("ongoing");
    expect(joined.game.viewer.side).toBe("b");

    const play = async (cookie: string, from: string, to: string, ply: number, promotion?: string) => {
      const response = await movePost(
        call(cookie, `/api/games/${created.id}/move`, { method: "POST", body: { from, to, promotion, expectedPly: ply } }),
        ctx(created.id),
      );
      return { status: response.status, body: await json(response) };
    };

    // đầu vào xấu bị chặn ở lớp HTTP
    expect((await play(white, "z9", "e4", 0)).status).toBe(400);
    expect((await play(black, "e7", "e5", 0)).status).toBe(409); // chưa đến lượt

    expect((await play(white, "f2", "f3", 0)).status).toBe(200);
    expect((await play(black, "e7", "e5", 1)).status).toBe(200);
    expect((await play(white, "g2", "g4", 2)).status).toBe(200);
    const last = await play(black, "d8", "h4", 3);
    expect(last.status).toBe(200);
    expect(last.body.game).toMatchObject({ status: "finished", result: "black", reason: "checkmate" });
    expect(last.body.game.black.ratingAfter).toBe(1020);

    const meBlack = await json(await meRoute(call(black, "/api/me")));
    expect(meBlack.rating).toBe(1020);
    expect(meBlack.gamesPlayed).toBe(1);
  });

  it("ghép trận qua HTTP: hai khách cùng thể thức vào cùng một ván", async () => {
    const a = await signInAsGuest();
    const b = await signInAsGuest();
    const first = await json(await matchPost(call(a, "/api/matchmaking", { method: "POST", body: { timeControlId: "3+2" } })));
    expect(first.state).toBe("searching");
    const second = await json(await matchPost(call(b, "/api/matchmaking", { method: "POST", body: { timeControlId: "3+2" } })));
    expect(second.state).toBe("matched");
    const fromA = await json(await matchGet(call(a, "/api/matchmaking")));
    expect(fromA).toEqual(second);

    const live = await json(await watchGet());
    expect(live.games.map((g: { id: string }) => g.id)).toContain(second.gameId);
  });
});

describe("khách đăng ký tài khoản: giữ Elo", () => {
  it("đăng ký mới → Elo và ván của khách chuyển sang tài khoản mới, tài khoản khách bị xoá", async () => {
    const guestCookie = await signInAsGuest();
    const opponentCookie = await signInAsGuest();
    const guestId = (await json(await meRoute(call(guestCookie, "/api/me")))).user.id;

    // khách thắng một ván xếp hạng
    const created = await json(
      await gamesPost(call(opponentCookie, "/api/games", { method: "POST", body: { timeControlId: "5+0", color: "w", rated: true, isPublic: false } })),
    );
    await joinPost(call(guestCookie, `/api/games/${created.id}/join`, { method: "POST" }), ctx(created.id));
    const step = async (cookie: string, from: string, to: string, ply: number) =>
      movePost(call(cookie, `/api/games/${created.id}/move`, { method: "POST", body: { from, to, expectedPly: ply } }), ctx(created.id));
    await step(opponentCookie, "f2", "f3", 0);
    await step(guestCookie, "e7", "e5", 1);
    await step(opponentCookie, "g2", "g4", 2);
    await step(guestCookie, "d8", "h4", 3);
    const before = await json(await meRoute(call(guestCookie, "/api/me")));
    expect(before.rating).toBe(1020);

    // đăng ký bằng chính phiên của khách
    const signUp = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { cookie: guestCookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ name: "Người Thật", email: "real@test.local", password: "matkhau-du-dai-123" }),
      }),
    );
    expect(signUp.status).toBe(200);
    const realCookie = cookieFrom(signUp, guestCookie);

    const after = await json(await meRoute(call(realCookie, "/api/me")));
    expect(after.user.isGuest).toBe(false);
    expect(after.user.name).toBe("Người Thật");
    expect(after.user.id).not.toBe(guestId);
    expect(after.rating).toBe(1020);
    expect(after.gamesPlayed).toBe(1);

    expect(await db.select().from(user).where(eq(user.id, guestId))).toHaveLength(0);
    const [game] = await db.select().from(games).where(eq(games.id, created.id));
    expect(game.blackPlayerId).toBe(after.user.id);
    expect((await db.select().from(ratings).where(eq(ratings.userId, after.user.id)))[0].rating).toBe(1020);
  });
});
