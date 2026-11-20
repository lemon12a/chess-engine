import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { GameError } from "./errors";

export async function getSessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function requireUser(request: Request) {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) {
    throw new GameError(
      "unauthorized",
      "Bạn cần vào chơi với tư cách khách hoặc đăng nhập.",
      401,
    );
  }
  return sessionUser;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Bọc mọi route: lỗi nghiệp vụ → JSON {error:{code,message}}, lỗi lạ → 500. */
export async function respond<T>(handler: () => Promise<T>): Promise<Response> {
  try {
    return NextResponse.json(await handler());
  } catch (error) {
    if (error instanceof GameError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, ...error.data } },
        { status: error.status },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: { code: "internal", message: "Có lỗi xảy ra, vui lòng thử lại." } },
      { status: 500 },
    );
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
