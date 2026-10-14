import { z } from "zod";
import { register } from "../transport/rpc.js";
import { importPins } from "../browser-profiles/bookmarks.js";
import { emit } from "../transport/stdio.js";
import { guarded } from "./bookmarks.shared.js";

// Nhập 1 lần các pin cũ của renderer vào profile Mặc định. Idempotent theo URL.
// Trả `{ added }`; chỉ phát `bookmarks.changed` khi thật sự thêm.
const Params = z.object({
  profileId: z.literal("default"),
  pins: z
    .array(z.object({ url: z.string().max(2048), title: z.string().max(1000) }))
    .max(100),
});

register("bookmarks.importPins", async (raw) => {
  const p = Params.parse(raw);
  const { added } = await guarded(p.profileId, () => importPins(p), false);
  if (added > 0) emit("bookmarks.changed", { profileId: p.profileId });
  return { added };
});
