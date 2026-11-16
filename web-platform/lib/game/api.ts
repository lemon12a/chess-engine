import type {
  GameView,
  LiveGameSummary,
  MatchStatus,
  MeInfo,
  OpenChallenge,
} from "./types";

// Code chạy trong trình duyệt: chỉ import kiểu, không import gì của server.

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("network", "Mất kết nối mạng.", 0);
  }
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null;
  if (!response.ok) {
    const failure = body?.error;
    throw new ApiError(
      failure?.code ?? "unknown",
      failure?.message ?? "Có lỗi xảy ra, vui lòng thử lại.",
      response.status,
      failure as Record<string, unknown> | undefined,
    );
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const gameApi = {
  view: async (id: string, signal?: AbortSignal) =>
    (await request<{ game: GameView }>(`/api/games/${id}`, { signal })).game,
  create: async (body: {
    timeControlId: string;
    color: "w" | "b" | "random";
    rated: boolean;
    isPublic: boolean;
  }) => (await post<{ id: string }>("/api/games", body)).id,
  join: async (id: string) => (await post<{ game: GameView }>(`/api/games/${id}/join`)).game,
  move: async (
    id: string,
    body: { from: string; to: string; promotion?: string; expectedPly: number },
  ) => (await post<{ game: GameView }>(`/api/games/${id}/move`, body)).game,
  resign: async (id: string) =>
    (await post<{ game: GameView }>(`/api/games/${id}/resign`)).game,
  draw: async (id: string, action: "offer" | "accept" | "decline") =>
    (await post<{ game: GameView }>(`/api/games/${id}/draw`, { action })).game,
  openChallenges: async () =>
    (await request<{ challenges: OpenChallenge[] }>("/api/games")).challenges,
  live: async (signal?: AbortSignal) =>
    (await request<{ games: LiveGameSummary[] }>("/api/watch", { signal })).games,
  me: () => request<MeInfo>("/api/me"),
};

export const matchApi = {
  join: (timeControlId: string) => post<MatchStatus>("/api/matchmaking", { timeControlId }),
  status: () => request<MatchStatus>("/api/matchmaking"),
  leave: () => request<{ ok: true }>("/api/matchmaking", { method: "DELETE" }),
};
