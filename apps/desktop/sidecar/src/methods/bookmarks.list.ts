import { z } from "zod";
import { register } from "../transport/rpc.js";
import { listBookmarks } from "../browser-profiles/bookmarks.js";
import { guarded, ProfileId } from "./bookmarks.shared.js";

register("bookmarks.list", async (raw) => {
  const { profileId } = z.object({ profileId: ProfileId }).parse(raw);
  return guarded(profileId, () => listBookmarks(profileId), false);
});
