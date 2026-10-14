// Profile trình duyệt nhúng ↔ partition Electron. Module thuần (không import
// `electron`) để test bằng `node --test`.
//
// Id do sidecar cấp (`default` hoặc `p-<8 hex>`), nhưng đi qua IPC/host-request nên
// main vẫn là biên tin cậy: id lọt vào tên partition VÀ đường dẫn thư mục
// `Partitions/<tên>` (staging import, boot apply) ⇒ chỉ nhận `[a-z0-9-]{1,32}`,
// không có `/`, `.`, hay chữ hoa để khỏi trượt khỏi thư mục Partitions.

export const DEFAULT_PROFILE_ID = "default";

const PROFILE_ID_RE = /^[a-z0-9-]{1,32}$/;

export function isValidProfileId(id: unknown): id is string {
  return typeof id === "string" && PROFILE_ID_RE.test(id);
}

// `default` giữ partition cũ để login + dữ liệu import sẵn có không mất.
export function partitionForProfile(id: string): string {
  if (!isValidProfileId(id))
    throw new Error(`invalid browser profile id: ${String(id)}`);
  return id === DEFAULT_PROFILE_ID
    ? "persist:awog-browser"
    : `persist:awog-browser-${id}`;
}
