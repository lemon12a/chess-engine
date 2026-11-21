import { saveAiGame } from "@/lib/game/aiGames";
import { readJson, requireUser, respond } from "@/lib/game/http";

export const dynamic = "force-dynamic";

/**
 * Lưu trạng thái ván: gửi TOÀN BỘ danh sách nước đi (SAN) mỗi lần. Gọi lại nhiều
 * lần với cùng dữ liệu là an toàn. Server tự suy ra kết quả từ thế cờ.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const sessionUser = await requireUser(request);
    const { id } = await params;
    const body = await readJson(request);
    const game = await saveAiGame(sessionUser.id, id, {
      sans: body.sans,
      resigned: body.resigned,
    });
    return { game };
  });
}
