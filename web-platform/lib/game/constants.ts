// Mọi con số điều chỉnh luật chơi nằm ở đây. Đổi một chỗ, cả hệ thống đổi theo.

export const DEFAULT_RATING = 1000;
/** Hiện chỉ có một nhóm Elo. Sau này tách theo thể thức bằng cách đổi hàm ratingCategoryFor. */
export const RATING_CATEGORY = "standard";

/** Đồng hồ chỉ bắt đầu chạy khi mỗi bên đã đi nước đầu tiên (ply 0 và 1 chưa tính giờ). */
export const CLOCK_START_PLY = 2;
/** Ván kết thúc khi chưa đủ số nước này (không phải chiếu bí) thì bị huỷ, không tính Elo. */
export const MIN_PLIES_FOR_RESULT = 4;
/** Thời gian tối đa để đi nước đầu tiên (đồng hồ chưa chạy). Quá hạn thì huỷ ván. */
export const FIRST_MOVE_TIMEOUT_MS = 30_000;

// ---- AFK / mất kết nối ----
/** Không có tín hiệu quá chừng này thì coi là mất kết nối và đóng băng đồng hồ. */
export const PRESENCE_TIMEOUT_MS = 15_000;
/** Không có tín hiệu quá chừng này (tính từ tín hiệu cuối) thì đối thủ thắng. */
export const ABANDON_MS = 60_000;
/** Tổng thời gian đồng hồ được đóng băng cho mỗi người trong một ván (chống câu giờ). */
export const DISCONNECT_BUDGET_MS = 90_000;
/** Ghi tín hiệu sống tối đa mỗi chừng này, không ghi mỗi lượt poll. */
export const HEARTBEAT_WRITE_MS = 4_000;

// ---- Thách đấu / hàng chờ ----
/** Thách đấu mà chủ không còn tín hiệu quá chừng này thì tự huỷ. */
export const WAITING_EXPIRE_MS = 90_000;
/** Thách đấu chỉ hiện trên sảnh khi chủ còn tín hiệu trong chừng này. */
export const LOBBY_FRESH_MS = 15_000;
/** Mục trong hàng chờ không poll quá chừng này thì coi là đã rời. */
export const QUEUE_STALE_MS = 10_000;
/** Phạm vi Elo khi ghép trận: mở rộng dần theo thời gian chờ. */
export const MATCH_WINDOW = { base: 150, step: 75, intervalMs: 5_000, max: 800 };

/** Độ trễ mặc định khi khán giả xem ván (người chơi không bị trễ). */
export const DEFAULT_SPECTATOR_DELAY_MS = 10_000;
