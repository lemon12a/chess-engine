import { createAuthClient } from "better-auth/react";

// Không cần baseURL vì web và API auth cùng domain (localhost:3000)
export const authClient = createAuthClient();