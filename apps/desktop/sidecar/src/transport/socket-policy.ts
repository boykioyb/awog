// Which JSON-RPC methods a socket client (the `awog` CLI shim and future
// external surfaces) may invoke. Default-deny: anything not listed here gets
// -32601 before it reaches dispatch (ADR 0093 — the socket is a second door
// into the engine, so its surface must be cut down deliberately, not opened
// wholesale).
//
// Prefix entries match `method.startsWith(prefix)`; bare entries are exact.
// The `events.*` pseudo-methods are transport-level (handled by socket.ts
// itself) and never reach this table.
//
// Denied on purpose (non-exhaustive): `fs.*` read/write/search (arbitrary
// filesystem inside workspace), `ssh.*`/`vpn.*`/`sources.*` (credentials +
// remote surfaces), `settings.set`, `hooks.*`, `infra.*`, `monitor.kill`,
// `cleanup.*`, every credential store write. A socket client that needs more
// should land it here explicitly — adding to this file is a security review
// point.

const ALLOWED_PREFIXES: readonly string[] = [
  // Chat + sessions (the CLI's whole surface): send, stream, permission,
  // question, cancel, list/get, upsert, spawn, steer, compact.
  'sessions.',
  // Task engine: create/list/get/watch + approve/cancel/rerun.
  'tasks.',
  // PTY bridge for `awog session attach` (ADR 0093 core surface).
  'terminal.',
  // Login + account management (auth.startOAuth/completeOAuth/addApiKey).
  'auth.',
  'accounts.',
  // Source/connection setup from the CLI (`awog source add/test/…`): config
  // writes land in ~/.awog/sources/ and secrets go to the OS keychain via
  // source.setSecret — same privilege tier the auth.* surface already grants.
  'source.',
]

const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'ping',
  'system.methods',
  'models.list',
  // Read-only project/workflow lookups the CLI needs to resolve --project and
  // `task run <workflow>` — the mutating siblings stay out, except
  // `projects.upsert` which backs `awog project add` (validated like the UI's).
  'projects.list',
  'projects.upsert',
  'workflows.list',
  'skills.list',
  'agents.list',
  'settings.get',
])

export function isSocketMethodAllowed(method: string): boolean {
  if (ALLOWED_METHODS.has(method)) return true
  return ALLOWED_PREFIXES.some((p) => method.startsWith(p))
}
