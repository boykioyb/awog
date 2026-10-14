import { z } from "zod";
import { register } from "../transport/rpc.js";
import { updateBookmark } from "../browser-profiles/bookmarks.js";
import { guarded, ProfileId } from "./bookmarks.shared.js";

// `folderId`: vắng = không di chuyển · null = về gốc · id = vào thư mục đó.
// `index`: vị trí trong nơi đến (hoặc trong nơi hiện tại nếu chỉ sắp xếp lại).
const Params = z.object({
  profileId: ProfileId,
  id: z.string().min(1).max(64),
  title: z.string().max(200).optional(),
  url: z.string().min(1).max(2048).optional(),
  folderId: z.string().min(1).max(64).nullable().optional(),
  index: z.number().int().min(0).max(1000).optional(),
});

register("bookmarks.update", async (raw) => {
  const p = Params.parse(raw);
  return guarded(p.profileId, async () => (await updateBookmark(p)).node, true);
});
