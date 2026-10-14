import { z } from "zod";
import { RpcError } from "../transport/rpc.js";
import { emit } from "../transport/stdio.js";
import { BrowserProfileError } from "../browser-profiles/profiles.js";

export const ProfileId = z.string().regex(/^(default|[a-z0-9-]{1,32})$/);

// Lỗi nghiệp vụ của store → -32602; sau khi ghi thì phát `bookmarks.changed`.
export async function guarded<T>(
  profileId: string,
  fn: () => Promise<T>,
  notify: boolean,
): Promise<T> {
  try {
    const res = await fn();
    if (notify) emit("bookmarks.changed", { profileId });
    return res;
  } catch (err) {
    if (err instanceof BrowserProfileError)
      throw new RpcError(-32602, err.message);
    throw err;
  }
}
