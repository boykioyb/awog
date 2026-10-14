import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import { BrowserProfileError } from "../browser-profiles/profiles.js";
import { removeProfile } from "../browser-profiles/scope.js";

const Params = z.object({
  id: z.string().regex(/^(default|[a-z0-9-]{1,32})$/),
});

// Xoá profile (không phải `default`): gỡ tham chiếu ở phiên/project, đẩy lại
// scope→profile, rồi nhờ main xoá partition (`browser.wipeProfile`).
register("browserProfiles.delete", async (raw) => {
  const { id } = Params.parse(raw);
  try {
    return await removeProfile(id);
  } catch (err) {
    if (err instanceof BrowserProfileError)
      throw new RpcError(-32602, err.message);
    throw err;
  }
});
