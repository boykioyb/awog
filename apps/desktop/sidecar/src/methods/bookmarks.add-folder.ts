import { z } from "zod";
import { register } from "../transport/rpc.js";
import { addBookmarkFolder } from "../browser-profiles/bookmarks.js";
import { guarded, ProfileId } from "./bookmarks.shared.js";

const Params = z.object({
  profileId: ProfileId,
  title: z.string().min(1).max(200),
});

register("bookmarks.addFolder", async (raw) => {
  const p = Params.parse(raw);
  return guarded(
    p.profileId,
    async () => (await addBookmarkFolder(p)).node,
    true,
  );
});
