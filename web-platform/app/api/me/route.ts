import { getSessionUser, respond } from "@/lib/game/http";
import { getMe } from "@/lib/game/service";
import type { MeInfo } from "@/lib/game/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return respond(async (): Promise<MeInfo> => {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      return { user: null, rating: null, gamesPlayed: 0, activeGameId: null, waitingGameId: null };
    }
    return getMe(sessionUser.id);
  });
}
