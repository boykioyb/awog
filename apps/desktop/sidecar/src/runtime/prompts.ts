// Shared system-prompt nudges appended to the agent's own systemPrompt.

// TodoWrite usage nudge. AWOG registers TodoWrite as a tool but the model won't
// use it proactively without instruction (unlike Claude Code, which is heavily
// prompted to). Appended whenever the tool is available so multi-step work shows
// a live checklist to the user. Kept short — it should not crowd the agent's
// own prompt for trivial requests.
export const TODO_USAGE_PROMPT = `<todo-list>
For any request that takes more than a couple of steps, use the \`TodoWrite\` tool to plan and track your work: lay out a checklist up front, keep exactly one item \`in_progress\` while you work it, and mark items \`completed\` the moment they are done. The list is shown live to the user as your progress — keep it current. Skip it only for trivial single-step requests.
</todo-list>`
