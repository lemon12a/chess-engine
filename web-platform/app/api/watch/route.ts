import { respond } from "@/lib/game/http";
import { listLiveGames } from "@/lib/game/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond(async () => ({ games: await listLiveGames() }));
}
