import { eq, or } from "drizzle-orm";
import { db, games, matchQueue, ratings } from "@/db/client";

/**
 * Gọi khi khách đăng ký/đăng nhập (better-auth chuẩn bị xoá tài khoản khách).
 *
 * - Đăng ký tài khoản MỚI: chuyển Elo và các ván của khách sang tài khoản mới.
 * - Đăng nhập vào tài khoản ĐÃ CÓ lịch sử: bỏ dữ liệu khách (không gộp), để không
 *   trộn Elo của hai danh tính. Các ván cũ của khách vẫn còn nhưng mất tên người chơi
 *   (khoá ngoại ON DELETE SET NULL).
 */
export async function transferGuestData(fromId: string, toId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(matchQueue).where(eq(matchQueue.userId, fromId));

    const [hasGames] = await tx
      .select({ id: games.id })
      .from(games)
      .where(or(eq(games.whitePlayerId, toId), eq(games.blackPlayerId, toId)))
      .limit(1);
    const existing = await tx.select().from(ratings).where(eq(ratings.userId, toId));
    const isFreshAccount =
      !hasGames && existing.every((row) => row.gamesPlayed === 0);
    if (!isFreshAccount) return;

    await tx.delete(ratings).where(eq(ratings.userId, toId));
    await tx.update(ratings).set({ userId: toId }).where(eq(ratings.userId, fromId));
    await tx.update(games).set({ whitePlayerId: toId }).where(eq(games.whitePlayerId, fromId));
    await tx.update(games).set({ blackPlayerId: toId }).where(eq(games.blackPlayerId, fromId));
  });
}
