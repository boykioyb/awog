# 0022 — Mở rộng `fs.*` IPC: read-write + search cho project workspace

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-02
- **Người quyết định:** Tech Lead (AWOG)

## Bối cảnh

Bề mặt `fs.*` hiện tại **read-only**: `fs.listDir`, `fs.readFile`, `fs.listFiles` ([apps/desktop/sidecar/src/methods/](../../apps/desktop/sidecar/src/methods/)). [Project Code Workspace](../features/project-workspace.md) cần **sửa + lưu**, **tạo/xóa/đổi tên** file & thư mục, và **find-in-files** trên toàn project. Đây là blocker chính để bỏ VSCode.

Ràng buộc AWOG (8 invariant — [.claude/rules/security.md](../../.claude/rules/security.md)):
- #2 path sanitize trước mọi I/O; #3 exec scope = workspace; #4 IPC boundary (UI không I/O trực tiếp); #8 no eval payload.
- Không thêm backend/dependency lớn khi chưa cần.

## Quyết định

1. **Thêm method mutation `fs.*`** (per-command, theo convention `git.*`/`terminal.*`), mỗi method 1 file trong `methods/`:
   - `fs.writeFile {workspaceRoot, path, content}` → `{bytesWritten}` — **atomic** (`.tmp` cùng thư mục + `rename`, mirror [projects/store.ts](../../apps/desktop/sidecar/src/projects/store.ts) và SKILL.md write).
   - `fs.createFile {workspaceRoot, path}` → `{ok}` — fail nếu đã tồn tại (`wx`).
   - `fs.createDir {workspaceRoot, path}` → `{ok}` — `mkdir -p` trong workspace.
   - `fs.rename {workspaceRoot, fromPath, toPath}` → `{ok}` — **cả hai** path qua sanitize.
   - `fs.delete {workspaceRoot, path, recursive?}` → `{ok}` — reject `path === workspaceRoot`.
2. **Thêm `fs.search`** `{workspaceRoot, query, regex?, caseSensitive?, wholeWord?, includeGlob?, excludeGlob?, maxResults?}` → `{matches: [{path, line, column, preview}], truncated}`:
   - **`git grep`** khi `workspaceRoot` là git repo (tôn trọng `.gitignore`, nhanh, đã là hard dependency của AWOG).
   - **Fallback node walk** (BFS, skip `node_modules`/`dist`/`.nuxt`/`.git`, cap file) cho non-git dir — tái dùng skip list của [fs.list-files.ts](../../apps/desktop/sidecar/src/methods/fs.list-files.ts).
   - Cap `maxResults` (default ~500) + wallclock; trả `truncated: true` khi chạm cap.
3. **Tất cả** đi qua `assertInsideWorkspace` ([git/path-sanitize.ts](../../apps/desktop/sidecar/src/git/path-sanitize.ts)) — tái dùng, **không** viết guard mới.
4. **Watcher project-wide**: mở rộng [watcher.ts](../../apps/desktop/sidecar/src/watcher.ts) (chokidar) watch `workspaceRoot`, debounce ~300ms, emit `fs:changed {workspaceRoot, path, type}`. Có **echo-loop guard** (suppress event ngay sau mutation do sidecar gây ra — mirror [git/watcher.ts](../../apps/desktop/sidecar/src/git/watcher.ts)).
5. Composable [`useFsApi`](../../apps/desktop/ui/composables/useFsApi.ts) mở rộng wrapper cho các method mới; type chia sẻ thêm vào [shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) (`FsSearchMatch`, …).

### Bất biến bảo mật (HARD — infosec review trước merge)

- **Mọi path** (kể cả `toPath` của rename, `path` của delete) qua `assertInsideWorkspace`: reject `..`, resolve absolute, `startsWith(workspaceRoot)`, chặn symlink ra ngoài.
- **`fs.delete`**: reject xóa chính `workspaceRoot`; UI bắt buộc confirm; cân nhắc move-to-trash thay hard delete (open question spec).
- **`git grep`**: spawn arg array (**không** shell string), `cwd = workspaceRoot`, validate độ dài + ký tự `query`, allowlist flag. Không nội suy query vào shell.
- **Write size cap** để tránh ghi file khổng lồ; binary content cảnh báo.
- Content `fs.writeFile` là **byte opaque** — sidecar không `eval`/parse như code (invariant #8).

## Phương án đã cân nhắc

- **Đi qua git để ghi file** (như `git.resolve-file`) — chỉ hợp cho thao tác git nội bộ, không phải general-purpose edit. Từ chối.
- **Bundle `ripgrep`** cho search — nhanh nhất, nhưng thêm **native binary** phải prebuild đa nền tảng + bundle (giống gánh nặng `node-pty` ADR 0019). Từ chối: `git grep` đã đủ nhanh và không thêm dep.
- **Một method `fs.mutate` đa năng** (action discriminator) — gộp write/create/delete/rename. Từ chối: vi phạm SRP + khó audit từng sink; per-command rõ ràng hơn (đồng bộ `git.*`).
- **Search thuần node (regex walk) luôn luôn** — đơn giản nhưng chậm trên repo lớn và không tôn trọng `.gitignore` mặc định. Dùng làm fallback, không phải đường chính.

## Hệ quả

- **Tích cực:** unlock edit/save + file ops + search trong app; tái dùng path-sanitize, atomic-write, skip-list, watcher pattern sẵn có; **0 dependency mới** (git đã có).
- **Tiêu cực / Trade-off:**
  - Bề mặt mutation + exec mới → **tăng rủi ro bảo mật**, bắt buộc infosec review + test path-traversal.
  - Watcher project-wide trên repo lớn → cần debounce + ignore tốt để tránh event storm (lý do skip `node_modules`/`dist`).
  - `git grep` vs fallback cho kết quả hơi khác nhau (gitignore) — cần ghi rõ trong UI.
- **Việc cần làm tiếp:**
  - Implement 6 method + watcher + mở rộng `useFsApi`/types.
  - Test path-traversal/symlink cho **từng** method (đặc biệt `rename.toPath`, `delete`).
  - Gọi agent `infosec` + skill `security-audit` trên diff trước merge.
  - Addendum: nới `terminal.create` nhận `projectId` (không cần `sessionId`) cho workspace mở từ project (xem open question spec).

## Tham chiếu

- [docs/features/project-workspace.md](../features/project-workspace.md) — feature spec
- [ADR 0017](./0017-git-manager-ipc-contract.md) — convention RPC per-command + `workspaceRoot`
- [ADR 0019](./0019-pty-terminal-in-sidecar.md) — pattern bảo mật exec/spawn trong sidecar
- [.claude/rules/security.md](../../.claude/rules/security.md) — 8 invariant + bảng sink nhạy cảm
