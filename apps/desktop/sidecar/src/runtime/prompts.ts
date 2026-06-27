// Shared system-prompt nudges appended to the agent's own systemPrompt.

// Verification / anti-fabrication directive. Appended UNCONDITIONALLY to every
// agent turn (chat, tasks, subagents) — the one behaviour we never want to be
// optional. Motivated by an observed failure: a session attached a GitHub MCP
// server, the server silently failed to load, and the model invented an entire
// PR review (acceptance criteria, constants, function names, "CI green") rather
// than reporting that it couldn't fetch anything. Fabrication produces wrong
// assessments and wrong code, so we make the rule explicit and standing.
export const VERIFY_PROMPT = `<verification>
Ground every factual claim in something you actually observed this turn — a file you read, a command you ran, a tool result you received. Do not present guesses or inferences as established fact; if you must infer, say so explicitly.

If a tool call fails, returns nothing, or a needed source is unavailable, state that plainly and stop — never invent or reconstruct what it "would have" returned. For any review, assessment, or analysis, rely ONLY on the actual code, diffs, or output you have read this turn: do not fabricate acceptance criteria, constants, function names, file paths, line numbers, or test/CI results you have not seen.

When you cannot verify something the user needs, tell them what is blocking you and ask for it (paste the content, fix the connection) instead of producing a plausible but unfounded answer. A correct "I could not verify this" is always better than a confident wrong answer — fabrication leads to wrong assessments and wrong code.
</verification>`

// TodoWrite usage nudge. AWOG registers TodoWrite as a tool but the model won't
// use it proactively without instruction (unlike Claude Code, which is heavily
// prompted to). Appended whenever the tool is available so multi-step work shows
// a live checklist to the user. Kept short — it should not crowd the agent's
// own prompt for trivial requests.
export const TODO_USAGE_PROMPT = `<todo-list>
For any request that takes more than a couple of steps, use the \`TodoWrite\` tool to plan and track your work: lay out a checklist up front, keep exactly one item \`in_progress\` while you work it, and mark items \`completed\` the moment they are done. The list is shown live to the user as your progress — keep it current. Skip it only for trivial single-step requests.

Before you end your turn, reconcile the checklist with what you actually did: mark every item you have genuinely finished as \`completed\`, and do not leave an already-finished item stuck at \`in_progress\`. NEVER mark an item \`completed\` that you did not actually finish — if you stop with work still remaining, leave those items \`pending\` or \`in_progress\` and say what is left. When you pause to wait for the user (a question or an approval gate), leave that item \`in_progress\` until you resume, then mark it \`completed\` once you continue.
</todo-list>`

// File-reference nudge (sessions only). The chat UI turns file paths written in
// inline code into clickable links that open a preview, but it can only resolve a
// path it can anchor to the workspace root. Models tend to write the bare basename
// (`notify.ts`) or a path relative to whatever dir they cd'd into in the terminal,
// neither of which resolves. So we tell the model the absolute workspace root and
// ask for full absolute paths. Returns undefined when there is no workspace root
// (no project bound → nothing to link to). The UI shortens these for display, so
// the verbose absolute path is not a readability cost.
export function fileRefPrompt(cwd?: string): string | undefined {
  if (!cwd) return undefined
  return `<file-references>
When you mention a workspace file in your reply, write its FULL ABSOLUTE path inside inline code (backticks) — for example \`${cwd}/src/example.ts\` — never just the bare file name. The user's UI turns these paths into clickable links that open a file preview, and a bare name like \`example.ts\` or a path relative to a subdirectory you cd'd into cannot be resolved. Always anchor the path at the workspace root \`${cwd}\`.
</file-references>`
}
