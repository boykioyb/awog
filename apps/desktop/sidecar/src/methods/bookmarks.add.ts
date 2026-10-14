import { z } from "zod";
import { register } from "../transport/rpc.js";
import { addBookmark } from "../browser-profiles/bookmarks.js";
import { guarded, ProfileId } from "./bookmarks.shared.js";

// Trả bookmark vừa tạo.
const Params = z.object({
  profileId: ProfileId,
  url: z.string().min(1).max(2048),
  title: z.string().max(200),
  folderId: z.string().min(1).max(64).optional(),
});

register("bookmarks.add", async (raw) => {
  const p = Params.parse(raw);
  return guarded(p.profileId, async () => (await addBookmark(p)).node, true);
});
