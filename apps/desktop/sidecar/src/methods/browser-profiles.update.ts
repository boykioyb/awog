import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import {
  BrowserProfileError,
  updateProfile,
} from "../browser-profiles/profiles.js";
import { notifyProfilesChanged } from "../browser-profiles/scope.js";

const Params = z.object({
  id: z.string().regex(/^(default|[a-z0-9-]{1,32})$/),
  name: z.string().min(1).max(60).optional(),
  color: z.string().min(1).max(40).optional(),
});

register("browserProfiles.update", async (raw) => {
  const { id, name, color } = Params.parse(raw);
  try {
    const profile = await updateProfile({
      id,
      ...(name !== undefined ? { name } : {}),
      ...(color !== undefined ? { color } : {}),
    });
    notifyProfilesChanged();
    return profile;
  } catch (err) {
    if (err instanceof BrowserProfileError)
      throw new RpcError(-32602, err.message);
    throw err;
  }
});
