import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import { BrowserProfileError } from "../browser-profiles/profiles.js";
import { setProfileProxy } from "../browser-profiles/proxy.js";
import { notifyProfilesChanged } from "../browser-profiles/scope.js";

// Biên tin cậy: chỉ hình dạng; luật nghiệp vụ (host/port/bypass/socks5+auth) ở
// browser-profiles/proxy-config.ts. Credential chỉ đi vào, KHÔNG BAO GIỜ đi ra.
const Params = z.object({
  id: z.string().regex(/^(default|[a-z0-9-]{1,32})$/),
  proxy: z
    .object({
      type: z.string(),
      host: z.string(),
      port: z.number(),
      bypass: z.string().optional(),
    })
    .nullable(),
  auth: z
    .object({ username: z.string(), password: z.string() })
    .nullable()
    .optional(),
});

register("browserProfiles.setProxy", async (raw) => {
  const { id, proxy, auth } = Params.parse(raw);
  try {
    const profile = await setProfileProxy({ id, proxy, auth });
    notifyProfilesChanged();
    return profile;
  } catch (err) {
    if (err instanceof BrowserProfileError)
      throw new RpcError(-32602, err.message);
    throw err;
  }
});
