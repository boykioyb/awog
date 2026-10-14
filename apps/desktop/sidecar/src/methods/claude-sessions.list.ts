import { z } from "zod";
import { register } from "../transport/rpc.js";
import {
  LIST_MAX_DAYS,
  listClaudeSessions,
} from "../sessions/claude-import.js";

// `claudeSessions.list` — phiên Claude Desktop / Claude CLI (terminal) có thể nhập vào AWOG
// (ADR 0102). Chỉ ĐỌC `<claudeHome>/projects`; lọc bỏ phiên Agent-SDK của chính AWOG
// (`sdk-ts`) và phiên có cwd ngoài mọi project AWOG. Xem sessions/claude-import.ts.
const Params = z.object({
  days: z.number().int().min(1).max(LIST_MAX_DAYS).optional(),
});

register("claudeSessions.list", async (raw) => {
  const params = Params.parse(raw ?? {});
  return listClaudeSessions(
    params.days === undefined ? undefined : { days: params.days },
  );
});
