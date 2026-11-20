export type GameErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "not_your_turn"
  | "illegal_move"
  | "game_over"
  | "out_of_sync"
  | "invalid_state"
  | "already_in_game"
  | "expired";

export class GameError extends Error {
  constructor(
    public code: GameErrorCode,
    message: string,
    public status: number = 400,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GameError";
  }
}
