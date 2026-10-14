import { z } from "zod";
import { register } from "../transport/rpc.js";
import { resolveScopeProfile } from "../browser-profiles/scope.js";

// Main hỏi khi renderer attach trước mọi lời gọi của agent (chưa có cache).
// `scope` = engineId phiên | `task:<id>[:<node>]`; vắng/không nhận ra → mặc định.
const Params = z.object({ scope: z.string().max(200).optional() });

register("browserProfiles.resolveScope", async (raw) => {
  const { scope } = Params.parse(raw);
  return { profileId: await resolveScopeProfile(scope) };
});
