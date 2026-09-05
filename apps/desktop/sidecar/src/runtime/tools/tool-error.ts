// Failure signalling for built-in tools.
//
// Pi's `AgentToolResult` has NO isError field (see pi-agent-core types): the only
// thing that sets `tool_execution_end.isError` is the tool THROWING. But several
// tools deliberately return a failure as a normal result instead of throwing, so
// the model reads the message and recovers rather than the turn aborting — a
// subagent that died, a fetch that timed out, an MCP call the server rejected.
//
// The consequence was that every one of those rendered as a green "done" step.
// The user saw a successful-looking row and only learned something went wrong if
// the model happened to mention it in prose (which is how a month of failing
// TodoWrite calls went unnoticed). A tool that failed must LOOK failed.
//
// The convention already existed in two places — mcp-tools.ts and source-tools.ts
// both put `isError` in `details` — it just was not read anywhere. This module
// makes it the explicit contract: set `isError: true` in a tool's `details` when
// the result you are returning represents a failure, and the event adapter
// renders an error step for it.

// Read the flag off an arbitrary tool result's `details` side channel.
export function detailsSignalError(details: unknown): boolean {
  if (typeof details !== 'object' || details === null) return false
  return (details as { isError?: unknown }).isError === true
}
