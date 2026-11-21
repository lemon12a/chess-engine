import { createAiGame } from "@/lib/game/aiGames";
import { readJson, requireUser, respond } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/** Tạo bản ghi cho một ván mới với AI. Trả về { id }. */
export async function POST(request: Request) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const body = await readJson(request);
    const id = await createAiGame(sessionUser.id, {
      humanColor: body.humanColor,
      levelId: body.levelId,
    });
    return { id };
  });
}
