import { describe, expect, it, vi } from "vitest";

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

import { auth } from "@/lib/auth";
import { POST as createPost } from "@/app/api/ai-games/route";
import { PUT as savePut } from "@/app/api/ai-games/[id]/route";

const ORIGIN = "http://localhost:3000";

async function signInAsGuest(): Promise<string> {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
}

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("API lưu ván với AI", () => {
  it("chưa có phiên thì bị từ chối 401", async () => {
    const response = await createPost(
      call("", "POST", "/api/ai-games", { humanColor: "w", levelId: "2" }),
    );
    expect(response.status).toBe(401);
  });

  it("khách tạo ván, lưu từng bước và nhận kết quả chiếu bí", async () => {
    const cookie = await signInAsGuest();
    const created = await (
      await createPost(call(cookie, "POST", "/api/ai-games", { humanColor: "b", levelId: "2" }))
    ).json();
    expect(created.id).toBeTruthy();

    const step1 = await (
      await savePut(call(cookie, "PUT", `/api/ai-games/${created.id}`, { sans: ["f3", "e5"] }), ctx(created.id))
    ).json();
    expect(step1.game).toMatchObject({ status: "ongoing", plyCount: 2 });

    const step2 = await (
      await savePut(
        call(cookie, "PUT", `/api/ai-games/${created.id}`, { sans: ["f3", "e5", "g4", "Qh4#"] }),
        ctx(created.id),
      )
    ).json();
    expect(step2.game).toMatchObject({ status: "finished", result: "black", reason: "checkmate" });
  });

  it("khách khác không lưu được vào ván này (404), dữ liệu sai bị 400", async () => {
    const owner = await signInAsGuest();
    const stranger = await signInAsGuest();
    const { id } = await (
      await createPost(call(owner, "POST", "/api/ai-games", { humanColor: "w", levelId: "1" }))
    ).json();
    const denied = await savePut(call(stranger, "PUT", `/api/ai-games/${id}`, { sans: ["e4"] }), ctx(id));
    expect(denied.status).toBe(404);
    const bad = await savePut(call(owner, "PUT", `/api/ai-games/${id}`, { sans: ["e4", "e4"] }), ctx(id));
    expect(bad.status).toBe(400);
  });
});
