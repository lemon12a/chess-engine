import { GameError } from "@/lib/game/errors";
import { readJson, requireUser, respond, str } from "@/lib/game/http";
import { joinQueue, leaveQueue, queueStatus } from "@/lib/game/matchmaking";

export const dynamic = "force-dynamic";

/** Hỏi trạng thái hàng chờ; mỗi lượt hỏi cũng thử ghép trận. */
export async function GET(request: Request) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    return queueStatus(sessionUser.id);
  });
}

/** Vào hàng chờ. */
export async function POST(request: Request) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const timeControlId = str((await readJson(request)).timeControlId);
    if (!timeControlId) throw new GameError("bad_request", "Thiếu thể thức.");
    await joinQueue(sessionUser.id, timeControlId);
    return queueStatus(sessionUser.id);
  });
}

/** Rời hàng chờ. */
export async function DELETE(request: Request) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    await leaveQueue(sessionUser.id);
    return { ok: true };
  });
}
