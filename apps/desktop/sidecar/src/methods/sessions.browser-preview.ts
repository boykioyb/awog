import { z } from "zod";
import { register } from "../transport/rpc.js";
import { readBrowserPreview } from "../sessions/browser-previews.js";

// Thẻ xem trước trang của `browser_tool` (docs/features/browser-preview-card.md):
// UI gọi RPC này khi một step navigate/tab_new hiện ra, để lấy ảnh thu nhỏ (data URL,
// bị cap ở browser-previews.ts) + title/url mà handler đã lưu dưới thư mục của session.
// `{ preview: null }` = chưa lưu gì cho step này; UI vẫn dựng thẻ từ input của step.
const Params = z.object({
  sessionId: z.string().min(1).max(128),
  stepId: z.string().min(1).max(256),
});

register("sessions.browserPreview", async (raw) => {
  const { sessionId, stepId } = Params.parse(raw);
  return { preview: await readBrowserPreview(sessionId, stepId) };
});
