import { z } from "zod";
import { register } from "../transport/rpc.js";
import { loadSession } from "../sessions/store.js";
import type { SessionStep } from "../types/shared.js";

// Fetch one step's full `detail` object on demand — the wire twin of
// `sessions.get`'s `lite` projection, which stubs oversized details down to
// `{kind, deferred: true}` so the transcript list stays small. The desktop
// calls this when the user expands a deferred step row; it returns the FULL
// SessionStepDetail (diff / file / terminal / list / text shape intact).
const Params = z.object({
  sessionId: z.string().min(1),
  // `messageId` = the persisted message id (UI's `eid` anchor, ADR 0074),
  // `stepId` = the step's id. Subagent steps share the SAME flat arrays
  // (they nest by `parentId`, not a children array), so a deferred child
  // detail is found by the plain lookup below — no recursion.
  messageId: z.string().min(1),
  stepId: z.string().min(1),
});

register("sessions.stepDetail", async (raw) => {
  const { sessionId, messageId, stepId } = Params.parse(raw);
  const session = await loadSession(sessionId);
  if (!session) return { detail: null };
  const msg = session.messages.find((m) => m.id === messageId);
  if (!msg) return { detail: null };
  // `parts` holds the same step objects (the ordered twin of `steps`); a
  // deferred stub can appear in either depending on which one the live turn
  // populated, so check both.
  const step =
    (msg.steps ?? []).find((s) => s.id === stepId) ??
    (msg.parts ?? []).find(
      (p): p is SessionStep => p.kind !== "text" && p.id === stepId,
    );
  // `target` travels too when it was deferred (>512B preview on the wire) —
  // a terminal step's full heredoc command lives there, not in detail.
  return { detail: step?.detail ?? null, target: step?.target ?? null };
});
