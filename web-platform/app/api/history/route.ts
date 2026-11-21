import { getSessionUser, respond } from "@/lib/game/http";
import { listHistory } from "@/lib/game/history";
import type { HistoryFilter, HistoryPage } from "@/lib/game/historyTypes";

export const dynamic = "force-dynamic";

const FILTERS = new Set<HistoryFilter>(["all", "ai", "pvp"]);

/** Lịch sử ván đấu của người đang đăng nhập (kể cả khách): ?type=all|ai|pvp&offset=0 */
export async function GET(request: Request) {
  return respond(async (): Promise<HistoryPage> => {
    const sessionUser = await getSessionUser(request);
    if (!sessionUser) return { items: [], hasMore: false, isGuest: false };

    const params = new URL(request.url).searchParams;
    const type = params.get("type") as HistoryFilter | null;
    const offset = Number.parseInt(params.get("offset") ?? "0", 10);
    const page = await listHistory(sessionUser.id, {
      filter: type && FILTERS.has(type) ? type : "all",
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return { ...page, isGuest: Boolean(sessionUser.isAnonymous) };
  });
}
