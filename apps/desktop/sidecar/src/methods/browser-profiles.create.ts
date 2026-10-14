import { z } from "zod";
import { register, RpcError } from "../transport/rpc.js";
import {
  BrowserProfileError,
  createProfile,
} from "../browser-profiles/profiles.js";
import { notifyProfilesChanged } from "../browser-profiles/scope.js";

const Params = z.object({
  name: z.string().min(1).max(60),
  color: z.string().min(1).max(40).optional(),
});

register("browserProfiles.create", async (raw) => {
  const { name, color } = Params.parse(raw);
  try {
    const profile = await createProfile({
      name,
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
