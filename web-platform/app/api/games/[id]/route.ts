import { getSessionUser, respond } from "@/lib/game/http";
import { getGameView } from "@/lib/game/service";

export const dynamic = "force-dynamic";

/**
 * Xem một ván. Không cần đăng nhập (khán giả vẫn xem được); nếu có phiên thì
 * người chơi nhận đầy đủ thông tin, khán giả nhận bản có độ trễ.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const { id } = await params;
    const sessionUser = await getSessionUser(request);
    return { game: await getGameView(id, sessionUser?.id ?? null) };
  });
}
