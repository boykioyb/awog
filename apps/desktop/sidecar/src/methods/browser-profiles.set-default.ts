import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import { BrowserProfileError } from "../browser-profiles/profiles.js";
import { changeDefaultProfile } from "../browser-profiles/scope.js";

const Params = z.object({
  id: z.string().regex(/^(default|[a-z0-9-]{1,32})$/),
});

register("browserProfiles.setDefault", async (raw) => {
  const { id } = Params.parse(raw);
  try {
    return await changeDefaultProfile(id);
  } catch (err) {
    if (err instanceof BrowserProfileError)
      throw new RpcError(-32602, err.message);
    throw err;
  }
});
