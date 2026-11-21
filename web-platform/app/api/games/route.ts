import { GameError } from "@/lib/game/errors";
import { readJson, requireUser, respond, str } from "@/lib/game/http";
import { createChallenge, listOpenChallenges } from "@/lib/game/service";
import { getTimeControl } from "@/lib/game/timeControls";

export const dynamic = "force-dynamic";

/** Danh sách thách đấu đang mở (công khai, không cần đăng nhập). */
export async function GET() {
  return respond(async () => ({ challenges: await listOpenChallenges() }));
}

/** Tạo thách đấu. Trả về { id }. */
export async function POST(request: Request) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const body = await readJson(request);

    const timeControl = getTimeControl(str(body.timeControlId));
    if (!timeControl) throw new GameError("bad_request", "Thể thức không hợp lệ.");

    const color = body.color ?? "random";
    if (color !== "w" && color !== "b" && color !== "random") {
      throw new GameError("bad_request", "Màu quân không hợp lệ.");
    }

    const id = await createChallenge(sessionUser.id, {
      baseMs: timeControl.baseMs,
      incrementMs: timeControl.incrementMs,
      color,
      rated: typeof body.rated === "boolean" ? body.rated : true,
      isPublic: typeof body.isPublic === "boolean" ? body.isPublic : true,
    });
    return { id };
  });
}
