// Shared SECURITY CONTROLS for session message ids and bookmarks (ADR 0074).
//
// These constants are deliberately in ONE place: they are a control, not incidental
// duplication. The same rule is enforced on three paths that must agree —
//   • methods/sessions.send-message.ts — `userMessageId` minted by the UI (L1),
//   • methods/sessions.update-bookmarks.ts — bookmark `id` from the UI (L1),
//   • sessions/session-manager.ts — bookmark re-validation on the load path (L2).
// Loosening one is loosening all of them: a bookmark id resolves to a message id, and
// a message id reaches a PATH sink (sessions/jsonl.ts externalizes attachments through
// sanitizeChild(`${message.id}-${att.id}`), which only rejects '/', '\' and '..').
// Widening the charset in a single file would quietly grow that sink with no test
// failing, while the load path would start DISCARDING ids the RPC had just accepted.

// Charset/length every id AWOG mints already fits (msg_u_<hex>, m-<b36>-<b36>,
// fm-<i>-<seq>, compact-<b36>). Rejects traversal, separators, whitespace and
// overlong ids. No `g` flag on purpose — a shared RegExp with /g carries lastIndex
// between .test() calls and would reject every other id.
export const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// Upper bound on bookmarks per session. Enforced at the RPC boundary AND on the load
// path, so a hand-edited header cannot hydrate an unbounded list that then gets
// re-serialized on every persist.
export const MAX_BOOKMARKS = 30

// ISO-8601 timestamps are ~24-33 chars; 40 leaves headroom without letting the header
// line grow on a hostile payload.
export const MAX_BOOKMARK_AT_LEN = 40
