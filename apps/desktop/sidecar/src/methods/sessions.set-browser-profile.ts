import { z } from "zod";
import { emit } from "../transport/stdio.js";
import { register, RpcError } from "../transport/rpc.js";
import { setSessionBrowserProfile } from "../sessions/store.js";
import { profileExists } from "../browser-profiles/profiles.js";
import { pushScopeProfile } from "../browser-profiles/scope.js";

// Đặt/gỡ override profile trình duyệt cấp phiên. `null` xoá hẳn key (kế thừa lại
// project → mặc định). Đẩy scope→profile sang main NGAY để main đóng/mở lại tab.
const Params = z.object({
  sessionId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  profileId: z
    .string()
    .regex(/^(default|[a-z0-9-]{1,32})$/)
    .nullable(),
});

register("sessions.setBrowserProfile", async (raw) => {
  const { sessionId, profileId } = Params.parse(raw);
  if (profileId !== null && !(await profileExists(profileId))) {
    throw new RpcError(-32602, `Browser profile not found: ${profileId}`);
  }
  const found = await setSessionBrowserProfile(sessionId, profileId);
  if (!found) throw new RpcError(-32004, "Session not found");
  // Hội tụ mọi cửa sổ/popout (cùng khuôn `session.llm-override`).
  emit("session.browser-profile", { sessionId, browserProfileId: profileId });
  await pushScopeProfile(sessionId);
  return { ok: true };
});
