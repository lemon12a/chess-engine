import { GameError } from "@/lib/game/errors";
import { readJson, requireUser, respond } from "@/lib/game/http";
import { getGameView, respondDraw, type DrawAction } from "@/lib/game/service";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<DrawAction>(["offer", "accept", "decline"]);

/** Xin hòa / chấp nhận / từ chối. Body: { action: "offer" | "accept" | "decline" } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const { id } = await params;
    const { action } = await readJson(request);
    if (typeof action !== "string" || !ACTIONS.has(action as DrawAction)) {
      throw new GameError("bad_request", "Thao tác xin hòa không hợp lệ.");
    }
    await respondDraw(id, sessionUser.id, action as DrawAction);
    return { game: await getGameView(id, sessionUser.id) };
  });
}
