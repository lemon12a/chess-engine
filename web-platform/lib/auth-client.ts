import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

// Không cần baseURL vì web và API auth cùng domain (localhost:3000)
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});

/**
 * Bảo đảm có phiên đăng nhập trước khi chơi: nếu chưa có thì vào bằng tài khoản
 * khách. Chỉ gọi khi người dùng bấm một nút cần tài khoản (chơi, tạo thách đấu...).
 * Xem ván của người khác thì không cần.
 */
export async function ensureSession() {
  const { data } = await authClient.getSession();
  if (data) return data;
  const result = await authClient.signIn.anonymous();
  if (result.error) {
    throw new Error(result.error.message ?? "Không thể vào chơi với tư cách khách.");
  }
  return result.data;
}
