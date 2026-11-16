import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { db } from "@/db/client";
import { transferGuestData } from "@/lib/game/guest";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    // Khách vãng lai: mỗi khách là một tài khoản thật (isAnonymous = true) nên
    // chơi, chat, có Elo 1000 như mọi người. Khi họ đăng ký/đăng nhập, dữ liệu
    // được chuyển sang tài khoản thật rồi tài khoản khách mới bị xoá.
    anonymous({
      generateName: () => `Khách ${Math.floor(1000 + Math.random() * 9000)}`,
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await transferGuestData(anonymousUser.user.id, newUser.user.id);
      },
    }),
  ],
});
