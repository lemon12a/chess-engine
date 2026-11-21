import { requireUser, respond } from "@/lib/game/http";
import { getGameView, joinGame } from "@/lib/game/service";

export const dynamic = "force-dynamic";

/** Nhận một thách đấu đang chờ. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const { id } = await params;
    await joinGame(sessionUser.id, id);
    return { game: await getGameView(id, sessionUser.id) };
  });
}
