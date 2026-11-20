import { sql } from "drizzle-orm";
import type { db } from "@/db/client";

type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Giờ hiện tại của DB (mili giây). Dùng clock_timestamp() chứ không phải now(),
 * vì now() đứng yên ở lúc bắt đầu giao dịch: nếu giao dịch phải chờ khoá dòng thì
 * now() sẽ cũ hơn thời điểm của giao dịch trước và đồng hồ bị trừ âm.
 */
export async function dbNowMs(exec: Pick<Db, "execute">): Promise<number> {
  const result = await exec.execute(
    sql`select (extract(epoch from clock_timestamp()) * 1000)::float8 as now`,
  );
  // postgres-js trả về mảng dòng, một số driver khác trả về { rows }.
  const rows = (Array.isArray(result)
    ? result
    : (result as unknown as { rows: unknown[] }).rows) as { now: number | string }[];
  return Math.floor(Number(rows[0].now));
}
