// Tool-name constants for the two AWOG servers whose implementation modules
// sit inside the sessions import graph: `awogsessions` (session messaging) and
// `awogteam` (board + channel + member). Bridged.ts derives its tables from
// these names, and sessions/* reaches bridged via step-mapper — so these
// constants MUST live in a leaf module or bridged pulls the tools' heavy
// deps (session-manager, store, spawn…) back into the sessions graph and
// corrupts ESM init order (observed: run-root test crashing inside bridged).
//
// The implementation modules (session-tools/board-tools/channel-tools/
// member-tools) re-export these so existing import sites keep working.

export const SESSION_MESSAGING_MCP_SERVER = "awogsessions";
export const SESSION_MESSAGING_TOOL_NAMES = [
  "list_sessions",
  "send_session_message",
  "create_session",
  "team_status",
] as const;

export const TEAM_MCP_SERVER = "awogteam";
export const BOARD_TOOL_NAMES = [
  "team_item_list",
  "team_item_get",
  "team_item_create",
  "team_item_update",
  "team_item_comment",
] as const;
export const CHANNEL_TOOL_NAMES = [
  "team_say",
  "team_note",
  "channel_read",
] as const;
export const MEMBER_TOOL_NAMES = ["member_diff"] as const;
export const TEAM_TOOL_NAMES = [
  ...BOARD_TOOL_NAMES,
  ...CHANNEL_TOOL_NAMES,
  ...MEMBER_TOOL_NAMES,
] as const;
