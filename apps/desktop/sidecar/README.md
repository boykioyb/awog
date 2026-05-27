# `@awog/sidecar`

Node.js sidecar for the AWOG desktop app. Owns: provider API calls, OAuth
credentials, session JSONL storage, project metadata. Speaks JSON-RPC 2.0 over
stdio NDJSON (ADR 0008) with the Tauri shell.

## Architecture

- `src/transport/` — stdio reader + JSON-RPC dispatch.
- `src/methods/` — RPC method registrations (one file per method).
- `src/auth/`, `src/credentials/` — OAuth PKCE flow + token cache. Tokens live
  in `~/.awog/credentials.json` (mode 0600), never under `~/.claude/`.
- `src/sessions/` — JSONL event-sourced session store + chat runner.
- `src/projects/` — `~/.awog/projects/<id>.json` metadata store.
- `src/providers/anthropic/` — model allowlist + claude.ai profile/usage probe.

Chat goes through `@anthropic-ai/claude-agent-sdk`: `runStream` builds a
`query({ prompt, options })`, iterates `SDKMessage` events, and forwards text
deltas to the UI via `session.chunk` notifications. The SDK spawns its bundled
Claude CLI as a child process; we pass a fresh OAuth access token via the
`CLAUDE_CODE_OAUTH_TOKEN` env var on each call (refresh handled by our
`credentials/token-manager.ts`).

## Build

```bash
pnpm -F @awog/sidecar build
```

Output under `dist/`:

```
dist/
  awog-sidecar-<triple>     # POSIX launcher (`.cmd` on Windows)
  lib/                      # tsc output
  node_modules/             # production deps (incl. SDK + bundled Claude CLI)
```

The build script mirrors the same three artifacts into
`apps/desktop/src-tauri/binaries/` so `tauri dev` picks them up via
`externalBin`. The launcher is a thin shell script that execs
`node lib/src/index.js`; this replaces the previous single-file ncc bundle
(no longer feasible because the SDK ships a platform-specific child binary).

## Manual smoke test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | \
  node dist/lib/src/index.js
# → {"jsonrpc":"2.0","id":1,"result":{"pong":true,"version":"0.0.1","ts":...}}
```

## OAuth

Our PKCE flow is preserved (`auth.startOAuth` / `auth.completeOAuth`) so the UI
keeps its paste-code dialog. Tokens go to `~/.awog/credentials.json`. We do
**not** write to the SDK's `<CLAUDE_CONFIG_DIR>/.credentials.json`; instead we
refresh on demand and inject the access token via env per `query()` call.
