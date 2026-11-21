import { requireUser, respond } from "@/lib/game/http";
import { getGameView, resignGame } from "@/lib/game/service";

export const dynamic = "force-dynamic";

/** Xin thua (hoặc hủy thách đấu nếu chưa có đối thủ). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const { id } = await params;
    await resignGame(id, sessionUser.id);
    return { game: await getGameView(id, sessionUser.id) };
  });
}
