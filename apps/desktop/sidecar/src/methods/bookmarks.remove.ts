import { z } from "zod";
import { register } from "../transport/rpc.js";
import { removeBookmark } from "../browser-profiles/bookmarks.js";
import { guarded, ProfileId } from "./bookmarks.shared.js";

// Xoá thư mục = xoá cả bookmark bên trong.
const Params = z.object({
  profileId: ProfileId,
  id: z.string().min(1).max(64),
});

register("bookmarks.remove", async (raw) => {
  const p = Params.parse(raw);
  return guarded(
    p.profileId,
    async () => {
      await removeBookmark(p);
      return { ok: true };
    },
    true,
  );
});
