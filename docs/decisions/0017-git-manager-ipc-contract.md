# 0017 — Git Manager IPC Contract

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-29
- **Người quyết định:** Tech Lead

## Bối cảnh

[Feature spec `git-manager.md`](../features/git-manager.md) (1294 dòng) đã chốt 21 RPC method, 45 acceptance criteria và 40 test scenario, nhưng để lại **12 open question** (OQ-1 → OQ-12) ở section [Open questions cho Tech Lead](../features/git-manager.md#open-questions-cho-tech-lead). Trước khi `project-manager` decompose task và `developer` triển khai sidecar, Tech Lead phải chốt cả 12 câu hỏi này thành một contract bất biến.

UI prototype đã có sẵn (15 component + mock store) ở [`apps/desktop/ui/`](../../apps/desktop/ui/). Sidecar còn trống — chỉ có [`methods/projects.inspect.ts`](../../apps/desktop/sidecar/src/methods/projects.inspect.ts) làm pattern tham chiếu. Toàn bộ contract phải tuân thủ:

- [ADR 0002](./0002-git-as-version-control.md) — Git là cơ chế versioning duy nhất.
- [ADR 0008](./0008-stdio-ipc-for-sidecar.md) — UI ↔ sidecar qua stdio JSON-RPC 2.0; không port public.
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — 8 invariant, đặc biệt #2 (path sanitize), #3 (git cwd = workspaceRoot), #4 (IPC boundary), #8 (no eval).

Bản ADR này **không** lặp lại nội dung spec (method shape, AC, test) — chỉ chốt 12 quyết định mở và quy ước cross-cutting (error envelope, naming, validate flow, spawn invariant).

## Quyết định

### Decision summary (1 dòng / OQ)

| OQ | Vấn đề | Quyết định | Rationale |
|----|--------|------------|-----------|
| OQ-1 | Granularity IPC | **Per-command, 22 method `git.*`** (21 method spec + `git.check-installed` bootstrap) | Typed, zod validate riêng từng method; subcommand whitelisting tự nhiên qua tên method; chặn cmd injection cấu trúc. |
| OQ-2 | Streaming protocol | **JSON-RPC notification** trên channel `sidecar-event` hiện có, shape `{ type: 'git:<op>:<phase>', payload }` | Reuse `transport/stdio.send` + `useSidecar().onEvent`; không tạo channel mới. |
| OQ-3 | Auto-commit `artifacts-only` | **Defer v2.** v1 chỉ scope `workspace` (`git add -A`) | KISS; kết hợp `autoStashDirtyBeforeTask` để cô lập change agent. |
| OQ-4 | Cancellation semantics | **SIGTERM → wait 2s → SIGKILL**; sau cancel tự gọi `git.status` re-sync | Match AC-45; tránh zombie process khi `git push` không nhận TERM. |
| OQ-5 | External git ops detection | **Có.** Chokidar watch `.git/HEAD` + `.git/index` + `.git/refs/`; debounce 200ms; emit `git:status:changed { reason: 'external' }` | UX coherent khi user lẫn AWOG cùng đụng repo từ terminal khác. |
| OQ-6 | Encoding non-UTF-8 | **UTF-8 mặc định.** Detect BOM + try-decode; non-UTF-8 → warning "Encoding không support, mở external editor" | Cover > 95% case; không over-engineer iconv chain. |
| OQ-7 | Mutex per workspace | **In-memory `Map<workspaceRoot, Promise queue>`** trong sidecar; timeout 5s → `BUSY`; internal engine call có flag `reentrant: true` bypass queue; `.git/index.lock` là defense in depth | UX feedback rõ ràng + defense in depth. |
| OQ-8 | Bundle Git binary | **Không bundle.** Bootstrap `git.check-installed` kiểm `git --version >= 2.20`; UI render banner full-page nếu missing/cũ | Giảm size Tauri bundle; leverage system git. |
| OQ-9 | `gitnexus` integration | **Out of scope.** gitnexus là context provider semantic, Git Manager chỉ thao tác `.git/` | Tách biệt hoàn toàn. |
| OQ-10 | Theme token conflict resolver | **Thêm `diffOurs` / `diffTheirs`** vào [`utils/themes.ts`](../../apps/desktop/ui/utils/themes.ts) và [`useTheme.ts`](../../apps/desktop/ui/composables/useTheme.ts). Dark: `rgba(96,165,250,0.18)` / `rgba(192,132,252,0.18)`. Light: `rgba(59,130,246,0.10)` / `rgba(168,85,247,0.10)` | Conflict resolver cần visual distinction ours (blue) vs theirs (purple). |
| OQ-11 | Commit message editor | **Plain `<textarea>` v1** (`resize-y min-h-[8rem]` theo [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md)); Monaco defer v2 | KISS — Monaco bootstrap chỉ để commit message là over-kill. |
| OQ-12 | Force push | **Không expose v1.** User dùng CLI nếu cần | DANGEROUS, ngoài MVP; rủi ro mất commit người khác. |

### Chi tiết quyết định

#### OQ-1 — Per-command IPC

22 method `git.<verb>` tương ứng 1-1 với spec [Sidecar IPC contract](../features/git-manager.md#sidecar-ipc-contract):

- **Read (7):** `git.status`, `git.log`, `git.diff`, `git.branchList`, `git.stashList`, `git.remoteList`, `git.readConflictFile`.
- **Mutate sync (16):** `git.stageFile`, `git.unstageFile`, `git.stageHunk`, `git.discardFile`, `git.commit`, `git.branchCreate`, `git.branchCheckout`, `git.branchDelete`, `git.stashSave`, `git.stashPop`, `git.stashDrop`, `git.resolveFile`, `git.mergeAbort`, `git.completeMerge`, `git.checkoutFileAtCommit`, `git.init`.
- **Mutate async (4):** `git.fetch`, `git.pull`, `git.push`, `git.cancel`.
- **Bootstrap (1):** `git.checkInstalled` — return `{ installed: boolean; version?: string; satisfies: boolean }` với ngưỡng `>= 2.20.0`.

Bác bỏ phương án `git.exec { subcommand, args }`: cho dù allowlist subcommand, payload arg vẫn cần parse case-by-case; mất type safety; tăng bề mặt cmd injection.

#### OQ-2 — Streaming protocol qua `sidecar-event`

Tái dùng channel event đã có (cùng pattern `session:*` event). Shape chuẩn hoá:

```ts
type GitProgressEvent =
  | { type: 'git:fetch:progress'; payload: { phase: 'connecting' | 'receiving' | 'resolving'; pct: number | null } }
  | { type: 'git:pull:progress';  payload: { phase: string; pct: number | null } }
  | { type: 'git:push:progress';  payload: { phase: string; pct: number | null } }
  | { type: 'git:status:changed'; payload: { reason: 'commit' | 'stage' | 'unstage' | 'pull' | 'merge' | 'stash' | 'checkout' | 'external' } }
  | { type: 'git:auto-fetch:done'; payload: { updated: number } }
```

UI subscribe qua `useSidecar().onEvent((evt) => …)`. Phương thức request/response vẫn dùng JSON-RPC `id` như mọi RPC khác — chỉ stream **progress** mới đi qua notification.

#### OQ-3 — Auto-commit scope chỉ `workspace`

Method `git.commit` không có flag scope; auto-commit từ engine luôn `git add -A` rồi `git commit -m '[<phaseId>] <agent>: <summary>'`. Tránh build pathspec dynamic theo phase output ở v1 (cần knowledge artifact metadata cross-cutting). Defer khi có nhu cầu thực sự + spec rõ.

#### OQ-4 — Cancel: TERM → 2s → KILL

```ts
async function cancelOp(child: ChildProcess): Promise<void> {
  child.kill('SIGTERM')
  const killed = await waitExit(child, 2000)
  if (!killed) child.kill('SIGKILL')
  emit('git:status:changed', { reason: 'external' })  // safe re-sync
  await refreshStatusInternal()
}
```

Áp dụng cho 3 op streaming. Sau cancel **luôn** gọi `git.status` để re-sync (state có thể partial nếu push đã đẩy được phần).

#### OQ-5 — External detection qua chokidar

Sidecar khởi tạo watcher tại `<workspaceRoot>/.git`:

- Path watch: `.git/HEAD`, `.git/index`, `.git/refs/heads/**`, `.git/refs/remotes/**`, `.git/MERGE_HEAD`, `.git/REBASE_HEAD`.
- Debounce: 200ms (chokidar `awaitWriteFinish`).
- Emit `git:status:changed { reason: 'external' }`.
- Tự ignore khi sidecar vừa spawn `git` xong (window 500ms) — tránh echo loop.

Tốn ít resource (<10 file watch); cải thiện UX khi user dùng CLI song song.

#### OQ-6 — Encoding UTF-8 only

Trong `git.readConflictFile` và `git.resolveFile`:

1. Đọc file dạng `Buffer`.
2. Detect BOM: UTF-16 LE/BE, UTF-8 BOM → strip.
3. Try `buffer.toString('utf8')`; nếu chứa `�` replacement → reject `ENCODING_UNSUPPORTED`.
4. UI show warning + nút "Mở external editor" (no inline edit).

Không ship iconv-lite v1; nếu user feedback cần Shift_JIS/UTF-16 → v2.

#### OQ-7 — Mutex in-memory per workspace

```ts
class GitMutex {
  private queues = new Map<string, Promise<unknown>>()
  async run<T>(root: string, fn: () => Promise<T>, opts?: { reentrant?: boolean; timeoutMs?: number }): Promise<T> {
    // ...timeout 5s default → throw RpcError('BUSY')
  }
}
```

- Một `Map<workspaceRoot, Promise>`, mỗi RPC `git.*` (trừ read-only nhanh và `git.cancel`) phải `await mutex.run(root, op)`.
- Internal call từ engine (auto-commit per phase) pass `{ reentrant: true }` để không deadlock khi engine đã giữ một op (vd. trace event trigger ngay sau phase end).
- Timeout 5s → trả error envelope `{ code: 'BUSY', message: 'Workspace đang busy, thử lại sau' }`.
- `.git/index.lock` của Git là defense in depth — nếu mutex thoát qua bug, Git vẫn từ chối thao tác đồng thời.

Read-only fast (`git.status`, `git.log` paginate, `git.diff`) **không** vào queue để UI snappy, nhưng vẫn lock-aware (nếu Git từ chối vì `.lock` → trả `BUSY`).

#### OQ-8 — System git, không bundle

`git.checkInstalled` chạy `execFile('git', ['--version'])`, parse `git version X.Y.Z`. Yêu cầu `>= 2.20.0` (đủ để có `git restore`, `git switch`, `--porcelain=v2`).

UI flow:
- App boot → call `git.checkInstalled`.
- `installed=false` → banner full-page với link cài đặt theo OS.
- `satisfies=false` → banner warning "Cập nhật Git tới ≥ 2.20".

#### OQ-9 — gitnexus tách biệt

Ghi nhận trong spec; không action item ở ADR này.

#### OQ-10 — Theme token mới

Thêm vào [`utils/themes.ts`](../../apps/desktop/ui/utils/themes.ts) cho **mọi** theme variant:

```ts
diffOurs:   { dark: 'rgba(96,165,250,0.18)',  light: 'rgba(59,130,246,0.10)' }
diffTheirs: { dark: 'rgba(192,132,252,0.18)', light: 'rgba(168,85,247,0.10)' }
```

Và expose trong `useTheme()`:

```ts
const t = useTheme()
t.diffOurs    // background block ours
t.diffTheirs  // background block theirs
```

20+ theme variant phải có hai token này — không hardcode hex trong component.

#### OQ-11 — Plain textarea cho commit message

`CommitMessageInput.vue` dùng `<textarea class="resize-y min-h-[8rem] ...">`. Hỗ trợ multi-line (Enter newline, Cmd+Enter submit). Không Monaco; không syntax highlight git-trailer ở v1.

#### OQ-12 — Force push không expose

Method `git.push` không nhận `force` / `forceWithLease` argument. Nếu user thực sự cần → hướng dẫn dùng CLI trong docs.

## Phương án đã cân nhắc

- **OQ-1 alt:** `git.exec({ subcommand, args })` — bỏ vì cmd injection surface lớn, không tận dụng zod schema riêng từng method.
- **OQ-2 alt:** Channel event riêng `sidecar-event-git` — bỏ vì duplicate transport plumbing không cần thiết.
- **OQ-5 alt:** Polling `git.status` mỗi 3s — bỏ vì waste CPU và độ trễ cảm nhận xấu hơn.
- **OQ-7 alt:** Dựa hoàn toàn vào `.git/index.lock` — bỏ vì error message từ Git khó parse thành UX rõ ràng (BUSY vs other failure).
- **OQ-8 alt:** Bundle `dugite` / portable git — bỏ vì ~50 MB bloat, license complications.

## Hệ quả

### Developer (sidecar wiring)

- **File pattern:** mỗi method một file `apps/desktop/sidecar/src/methods/git.<verb>.ts` (kebab-case verb). Pattern theo [`projects.inspect.ts`](../../apps/desktop/sidecar/src/methods/projects.inspect.ts): import `register` + `RpcError` từ `../transport/rpc.js`, đăng ký schema zod, validate, gọi runner.
- **Runner module:** tạo `apps/desktop/sidecar/src/git/runner.ts` — wrapper quanh `execFile('git', argArray, { cwd, env: filtered })`, expose `runGit(args, opts) → { stdout, stderr, code }` và `spawnGitStream(args, onProgress)` cho 3 op streaming.
- **Error map enum (full):**
  ```ts
  type GitErrorCode =
    | 'OK'                     // không bao giờ throw — chỉ trong success envelope
    | 'BUSY'                   // mutex timeout / .git/index.lock
    | 'DIRTY_TREE'             // checkout/pull cần clean tree
    | 'NOT_FAST_FORWARD'       // push/pull diverge
    | 'MERGE_CONFLICT'         // pull/merge conflict
    | 'AUTH_FAILED'            // SSH key / HTTPS token
    | 'NETWORK_ERROR'          // remote unreachable
    | 'WORKSPACE_NOT_FOUND'    // workspace folder mất
    | 'REMOTE_NOT_FOUND'       // origin không config
    | 'UNMERGED'               // delete branch chưa merge
    | 'FILE_LOCKED'            // Windows file lock
    | 'GIT_NOT_FOUND'          // binary missing
    | 'INVALID_PATH'           // path traversal / out of workspace
    | 'INVALID_REF'            // ref name không hợp lệ
    | 'ENCODING_UNSUPPORTED'   // OQ-6
    | 'CANCELLED'              // user cancel
    | 'UNKNOWN'                // catch-all (luôn kèm stderrSanitized)
  ```
- **Validate flow per method:**
  1. Parse args qua zod.
  2. Resolve path (nếu có): `path.resolve(workspaceRoot, input)` → check `startsWith(workspaceRoot)` → reject `INVALID_PATH`.
  3. Validate ref/branch name regex: `^[^\s~^:?*\[\\]+$` và không bắt đầu `-`.
  4. Acquire mutex (trừ read-only fast).
  5. `execFile('git', argArray, { cwd: workspaceRoot, env: filterEnv() })`.
  6. Map stderr/exit code → `GitErrorCode`.
  7. Sanitize stderr (strip path tuyệt đối, token, OAuth URL) trước khi đặt vào `stderrSanitized`.
- **Streaming methods** (`fetch/pull/push`): dùng `--progress` flag, parse stderr line-by-line, emit `git:<op>:progress` event qua transport event channel.
- **Theme update:** developer cập nhật [`utils/themes.ts`](../../apps/desktop/ui/utils/themes.ts) + [`useTheme.ts`](../../apps/desktop/ui/composables/useTheme.ts) thêm `diffOurs`/`diffTheirs` cho mọi theme variant.

### QA

- Toàn bộ **40 test scenario (TS-1 → TS-40)** trong spec áp dụng. Đặc biệt:
  - **TS-32 (cancel push):** verify SIGTERM → 2s timeout → SIGKILL; sau cancel `git.status` phải re-sync.
  - **TS-33 (path traversal):** mọi method nhận `path` phải reject `../../etc/passwd` với code `INVALID_PATH`.
  - **TS-34 (cmd injection):** branch name `"a; rm -rf /"` reject với `INVALID_REF`; arg array bảo đảm Git treat as 1 token.
  - **TS-35 (concurrent commit):** user commit khi engine auto-commit chạy → 1 nhận `BUSY`, UI retry 5s.
  - **TS-28 (no git binary):** `git.checkInstalled` trả `installed=false` → banner full-page.
- **Cancel timing AC:** observable `cancel` → `child.kill('SIGTERM')` ≤ 100ms; full process exit ≤ 2.1s ngay cả khi cần SIGKILL.
- **External detection AC:** chạy `git commit` từ terminal khác → UI emit `git:status:changed` ≤ 500ms (200ms debounce + 100ms chokidar latency + buffer).
- Khuyến nghị bộ test suite phụ kiểm `filterEnv()` không leak `ANTHROPIC_API_KEY` qua subprocess env.

### Tương lai v2 (defer)

- **`artifacts-only` auto-commit scope** (OQ-3) — cần xác định pathspec build theo artifact metadata.
- **3-way conflict resolver** — v1 chỉ 2-way.
- **Monaco commit editor** với syntax highlight conventional-commit / trailer (OQ-11).
- **Force push / force-with-lease** (OQ-12) — chỉ khi có user flow rõ ràng + double-confirm UI.
- **Search history** (filter author / path / message).
- **iconv multi-encoding** cho conflict resolver (OQ-6).
- **Bundle dugite/portable git** nếu user feedback cho thấy onboarding cài Git là blocker thực tế (OQ-8).

### Update tài liệu

- Append entry ADR 0017 vào [`docs/decisions/README.md`](./README.md).
- Cập nhật bảng stack trong [`CLAUDE.md`](../../CLAUDE.md) note "Git Manager spec'd, IPC contract chốt ở ADR 0017".

## Notes / Conventions

### Error envelope shape (chuẩn cho mọi `git.*` method)

```ts
// Success: trả thẳng output theo schema từng method (không bọc).
// Failure: throw RpcError với:
interface GitErrorPayload {
  code: GitErrorCode                  // enum bắt buộc, xem Developer section
  message: string                     // tiếng Việt, hiển thị UI
  data?: Record<string, unknown>      // tùy method, vd. { files: string[] } cho MERGE_CONFLICT
  stderrSanitized?: string            // optional, đã strip secrets/path
}
```

JSON-RPC mapping: `RpcError(code: -32001, message: <message>, data: { gitCode: <GitErrorCode>, ...data, stderrSanitized })`. UI có helper `unwrapGitError(rpcError) → GitErrorPayload`.

### Naming convention

- **Method:** `git.<verb>` — verb camelCase trong method name (`git.stageFile`, `git.branchCheckout`).
- **File:** `apps/desktop/sidecar/src/methods/git.<verb>.ts` — verb kebab-case (`git.stage-file.ts`, `git.branch-checkout.ts`). File name theo [.claude/rules/typescript.md](../../.claude/rules/typescript.md) (`kebab-case.ts`).
- **Event:** `git:<op>:<phase>` — colon-separated, lowercase (`git:push:progress`, `git:status:changed`). Tách biệt với method namespace bằng dấu `:` thay vì `.`.

### Path validate flow (bắt buộc mọi method nhận `path`)

```ts
function validatePath(input: string, workspaceRoot: string): string {
  if (input.includes('..')) throw new RpcError(-32602, 'INVALID_PATH', { gitCode: 'INVALID_PATH' })
  const abs = path.resolve(workspaceRoot, input)
  if (!abs.startsWith(workspaceRoot + path.sep) && abs !== workspaceRoot) {
    throw new RpcError(-32602, 'INVALID_PATH', { gitCode: 'INVALID_PATH' })
  }
  // Symlink check: realpath không được escape workspaceRoot.
  const real = fs.realpathSync.native(abs)  // throws nếu không tồn tại; OK với checkoutFileAtCommit cần handle
  if (!real.startsWith(workspaceRoot + path.sep) && real !== workspaceRoot) {
    throw new RpcError(-32602, 'INVALID_PATH', { gitCode: 'INVALID_PATH' })
  }
  return abs
}
```

Theo invariant #2 [`.claude/rules/security.md`](../../.claude/rules/security.md).

### Spawn invariant

**Mọi** spawn Git phải tuân:

```ts
execFile('git', argArray, {
  cwd: workspaceRoot,                  // invariant #3
  env: filterEnv(process.env),         // whitelist
  windowsHide: true,
  maxBuffer: 50 * 1024 * 1024,         // 50 MB cho diff lớn
})

function filterEnv(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ALLOW = ['PATH', 'HOME', 'SSH_AUTH_SOCK', 'LANG', 'LC_ALL', 'SystemRoot', 'USERPROFILE']
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW) if (src[k] !== undefined) out[k] = src[k]
  return out
}
```

Cấm:
- `exec()` / shell string interpolation.
- `git -C <path>` với path từ payload UI (cwd luôn là `workspaceRoot`).
- Pass `ANTHROPIC_API_KEY`, OAuth token, hoặc bất kỳ secret xuống env subprocess.

### Stderr sanitize

Trước khi đặt vào `stderrSanitized`:

1. Strip token pattern: `(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})` → `<token>`.
2. Strip absolute paths chứa `os.homedir()` → thay `~`.
3. Strip URL có embedded creds: `https://user:token@host` → `https://host`.
4. Limit 4 KB; truncate có suffix `… [truncated]`.

## Tham chiếu

- [Feature spec — Git Manager](../features/git-manager.md) (1294 dòng)
- [ADR 0002 — Git as version control](./0002-git-as-version-control.md)
- [ADR 0008 — Stdio IPC for sidecar](./0008-stdio-ipc-for-sidecar.md)
- [`.claude/rules/security.md`](../../.claude/rules/security.md) — 8 invariant
- [`.claude/rules/nuxt-vue.md`](../../.claude/rules/nuxt-vue.md) — `resize-y min-h-[8rem]` cho textarea content dài
- [`.claude/rules/typescript.md`](../../.claude/rules/typescript.md) — naming convention
- [`apps/desktop/sidecar/src/methods/projects.inspect.ts`](../../apps/desktop/sidecar/src/methods/projects.inspect.ts) — pattern tham chiếu
- [Anh chị em ADR 0014 (MCP runtime)](./0014-mcp-servers-stdio-runtime.md) — pattern execFile + env whitelist
