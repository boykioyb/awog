import { z } from "zod";
import { register } from "../transport/rpc.js";
import {
  IMPORT_MAX_IDS,
  importClaudeSessions,
} from "../sessions/claude-import.js";

// `claudeSessions.import` — tạo phiên AWOG pointer-mode trỏ vào transcript Claude Desktop/CLI
// (ADR 0102). Idempotent: id đã nhập trả về trong `skipped` với reason 'already-imported'.
// id không phải UUID bị `skipped: 'invalid-id'` (không ném) để một id hỏng không phá cả lô.
const Params = z.object({
  ids: z.array(z.string().max(64)).min(1).max(IMPORT_MAX_IDS),
});

register("claudeSessions.import", async (raw) => {
  const params = Params.parse(raw);
  return importClaudeSessions(params.ids);
});
