import { GameError } from "@/lib/game/errors";
import { readJson, requireUser, respond, str } from "@/lib/game/http";
import { getGameView, makeMove } from "@/lib/game/service";

export const dynamic = "force-dynamic";

const SQUARE_RE = /^[a-h][1-8]$/;
const PROMOTIONS = new Set(["q", "r", "b", "n"]);

/** Đi một nước. `expectedPly` là số nửa nước client đang thấy, để chặn đi nhầm lượt/trùng lặp. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const { id } = await params;
    const body = await readJson(request);

    const from = str(body.from);
    const to = str(body.to);
    const promotion = str(body.promotion);
    const expectedPly = body.expectedPly;
    if (
      !from ||
      !to ||
      !SQUARE_RE.test(from) ||
      !SQUARE_RE.test(to) ||
      (promotion !== undefined && !PROMOTIONS.has(promotion)) ||
      typeof expectedPly !== "number" ||
      !Number.isInteger(expectedPly) ||
      expectedPly < 0
    ) {
      throw new GameError("bad_request", "Nước đi không hợp lệ.");
    }

    await makeMove(id, sessionUser.id, { from, to, promotion, expectedPly });
    return { game: await getGameView(id, sessionUser.id) };
  });
}
