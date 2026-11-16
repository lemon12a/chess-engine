/** Tên hiển thị. Khách có tên do plugin sinh ("Khách 4821"); đây chỉ là phòng hờ. */
export function displayName(u: {
  id: string;
  name: string;
  isAnonymous: boolean | null;
}): string {
  if (!u.isAnonymous) return u.name;
  if (u.name && u.name !== "Anonymous") return u.name;
  return `Khách ${u.id.slice(-4)}`;
}
