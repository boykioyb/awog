// AWOG commit co-author attribution — the single source of truth for the trailer
// text and the Pi-runtime system-prompt instruction. Kept here (not in a runtime
// file) so the git auto-commit path and BOTH LLM runtimes (Claude SDK + Pi) import
// one literal instead of the hand-synced copies they used to keep.
//
// Honors the UI Git setting `commitCoAuthor` (default on). The two runtimes apply
// it differently:
//   • Claude SDK (claude_code preset) — the preset injects Claude's own
//     "Generated with Claude Code" + `Co-Authored-By: Claude` regardless of AWOG's
//     setting, so the runtime OVERRIDES it via the SDK's native `attribution`
//     option (on → this trailer, off → '' which hides attribution).
//   • Pi — no built-in attribution, so co-author is opt-in via the system-prompt
//     instruction below, appended only when the setting is on.
export const CO_AUTHOR_TRAILER = 'Co-Authored-By: AWOG <noreply@awog.local>'

// Pi-runtime system-prompt block. Mirrors the UI-side GIT_COAUTHOR_PROMPT
// (ui-next/utils/system-prompt.ts) but lives sidecar-side so the runtime, not the
// UI, decides when to inject it (per the plumbed `commitCoAuthor` flag).
export const CO_AUTHOR_INSTRUCTION = `## Git Conventions

When making git commits, include AWOG as a co-author trailer:

\`\`\`
${CO_AUTHOR_TRAILER}
\`\`\``
