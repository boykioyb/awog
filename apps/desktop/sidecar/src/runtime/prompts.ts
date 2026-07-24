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

Never report the result of an action you did not actually perform this turn. If you delegate to a subagent, read or edit a file, run a command, or commit, you MUST emit the corresponding tool call in this same turn and wait for its result — do not write the subagent's findings or the command's output from memory, expectation, or a pattern set by earlier turns. Saying you "will" or "did" do something is not doing it: emit the tool call.

When you cannot verify something the user needs, tell them what is blocking you and ask for it (paste the content, fix the connection) instead of producing a plausible but unfounded answer. A correct "I could not verify this" is always better than a confident wrong answer — fabrication leads to wrong assessments and wrong code.
</verification>`

// Tool-use discipline (ADR 0029 follow-up). Claude Code's resistance to the
// "narrate instead of act" confabulation comes largely from its system-prompt
// scaffolding — which AWOG shed when it moved off @anthropic-ai/claude-agent-sdk
// to the lighter Pi runtime (under OAuth Pi prepends only the Claude Code
// IDENTITY, not the behavioural body). This restores the tool-use half of that
// scaffolding across every provider. Appended wherever VERIFY_PROMPT is, except
// plan mode (PLAN_MODE_PROMPT governs that read-only path). Pairs with
// VERIFY_PROMPT (don't fabricate results) and the runtime confabulation guard.
export const TOOL_DISCIPLINE_PROMPT = `<tool-use>
You act through tools — you are not a narrator. When a step needs a tool (read or edit a file, run a command, search, fetch, or delegate to a subagent via the Task tool), call the tool and work from its real result. Never describe, plan, or announce an action in prose as a substitute for performing it.

If you tell the user you are going to do something, do it in the SAME turn by emitting the tool call — do not end your turn having only said you "will" do it or that you already "did" it. Announcing an action and then stopping is the most common way work is left undone: saying it is not doing it.

Carry the task through to a real conclusion and confirm the outcome with a tool before you report it done. Stop only when the work is genuinely finished, you are blocked and need the user, or the user owes you a decision. The permission mode already gates anything risky, so take the obvious next step instead of narrating it.
</tool-use>`

// TodoWrite usage nudge. AWOG registers TodoWrite as a tool but the model won't
// use it proactively without instruction (unlike Claude Code, which is heavily
// prompted to). Appended whenever the tool is available so multi-step work shows
// a live checklist to the user. Kept short — it should not crowd the agent's
// own prompt for trivial requests.
export const TODO_USAGE_PROMPT = `<todo-list>
For any request that takes more than a couple of steps, use the \`TodoWrite\` tool to plan and track your work: lay out a checklist up front, keep exactly one item \`in_progress\` while you work it, and mark items \`completed\` the moment they are done. The list is shown live to the user as your progress — keep it current. Skip it only for trivial single-step requests.

Before you end your turn, reconcile the checklist with what you actually did: mark every item you have genuinely finished as \`completed\`, and do not leave an already-finished item stuck at \`in_progress\`. NEVER mark an item \`completed\` that you did not actually finish — if you stop with work still remaining, leave those items \`pending\` or \`in_progress\` and say what is left. When you pause to wait for the user (a question or an approval gate), leave that item \`in_progress\` until you resume, then mark it \`completed\` once you continue.
</todo-list>`

// Background-exec nudge (ADR 0066, sessions only). Models trained on Claude Code
// assume Bash can run in the background and that they'll be "notified when it's
// done" — but until this feature that was a confabulation (AWOG's Bash was a
// one-shot with a hard 600s cap), so a build kicked off "in the background" just
// left the turn dead. Now the primitive is REAL: this tells the model to use it
// for long commands and to actually poll/await rather than assume. Appended only
// when backgroundExec is wired (chat sessions, not plan mode).
export const BACKGROUND_EXEC_PROMPT = `<background-commands>
For a command that runs longer than a couple of minutes (builds, full test runs, dev servers, long installs), call \`Bash\` with \`run_in_background: true\`. It returns a \`shellId\` immediately and the command keeps running detached — it is NOT subject to the normal command timeout, and it does not block you.

To check on a background command, call \`BashOutput\` with its \`shell_id\`: you get its accumulated output and whether it is still running or has exited (with the exit code). Poll it rather than guessing. When a background command finishes, the session is notified so you can continue — but never claim a background command succeeded or report its results until you have actually read them via \`BashOutput\` and seen it exit. Do not fabricate an exit code or output you have not observed.

Use a foreground \`Bash\` (the default) for short commands — background exec is only for genuinely long-running work.
</background-commands>`

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
