# Feature Spec: Session "Copy path" / "Open in Finder" trỏ đúng session dir

> Loại: **Bug fix (S)** — Phương án A đã được PO duyệt.
> Skill: [elicit-requirements](../../.claude/skills/elicit-requirements/SKILL.md)
> Brief: PO Feature Brief (bug context menu session dùng path project thay vì path session).

## Bối cảnh

Context menu **của một session** (chuột phải vào 1 row trong danh sách sessions ở UI-next) có 2 action:

- **Copy path** — copy đường dẫn ra clipboard.
- **Open in Finder** — mở/reveal trong file manager của OS.

Cả 2 hiện dùng **path của PROJECT** chứ không phải path của session thật:

- `apps/desktop/ui-next/components/session/SessionList.vue:504-517`:
  ```ts
  const ctxPath = computed(() => ctx.value ? projectPath(ctx.value.session.project) : null)
  function ctxCopyPath() { if (ctxPath.value) void navigator.clipboard.writeText(ctxPath.value) }
  function ctxOpenFinder() { if (path && sc.available) sc.openPath(path, '.').catch(...) }
  ```

Session thật lưu ở `~/.awog/sessions/<engineId>/` (`session.jsonl` + `attachments/`) — xem
`apps/desktop/sidecar/src/sessions/jsonl.ts:41-61` (`sessionsDir()` / `sessionDir(id)` / `sessionFilePath(id)`).
**`<id>` on-disk = `engineId`** (slug `ses-…`), KHÔNG phải numeric client id trong UI.

> Lưu ý phạm vi: menu **cấp project** trong `SessionTabBar.vue` (`pOpenFinder`) đang dùng `projectPath` — **đúng ý đồ** (mở folder project), KHÔNG sửa. Chỉ menu **cấp session** (SessionList) mới là bug.

## Persona chịu tác động

- **Người dùng cuối** (dev đang dùng AWOG desktop) — right-click session để lấy đường dẫn / mở thư mục session thật (ví dụ để inspect `session.jsonl`, attachments, hoặc backup thủ công).

## User flows

### Flow 1 — Copy path
1. User right-click một session trong danh sách → context menu.
2. User chọn **Copy path**.
3. Clipboard chứa đường dẫn tuyệt đối tới **thư mục session** `~/.awog/sessions/<engineId>/`.

### Flow 2 — Open in Finder
1. User right-click một session → context menu.
2. User chọn **Open in Finder**.
3. File manager của OS mở và **reveal (highlight)** đúng thư mục session `~/.awog/sessions/<engineId>/`.

## Quyết định open question (đã chốt)

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| Trỏ **thư mục** `~/.awog/sessions/<id>/` hay **file** `session.jsonl`? | **Thư mục** (khuyến nghị PO). | Copy path → dán được vào terminal `cd`; reveal folder cho thấy cả `attachments/`. `showItemInFolder(dir)` highlight folder trong parent — trực quan hơn nhấp nháy 1 file. Nếu sau này cần "Copy path to session.jsonl" thì thêm action riêng (out-of-scope). |
| Verify session dir tồn tại trước khi reveal? | **Có** — fail-fast: nếu dir chưa tồn tại (session chưa persist), disable/ẩn action hoặc no-op + toast cảnh báo. | Reveal folder không tồn tại → file manager mở nhầm parent hoặc lỗi im lặng (violation Least Astonishment). Session mới chưa gửi tin nhắn thì chưa có folder. |

## Acceptance Criteria

### AC1 — Copy path trỏ đúng session dir
- **Given** một session đã persist (có `engineId`, folder `~/.awog/sessions/<engineId>/` tồn tại)
- **When** user chọn **Copy path** trong context menu của session đó
- **Then** clipboard chứa đúng đường dẫn tuyệt đối của thư mục session `<home>/.awog/sessions/<engineId>/`, **không** phải path project.

### AC2 — Open in Finder reveal đúng session dir
- **Given** một session đã persist và đang chạy trong Electron (shell khả dụng)
- **When** user chọn **Open in Finder**
- **Then** file manager OS reveal đúng thư mục `~/.awog/sessions/<engineId>/`, **không** phải folder project.

### AC3 — Không hồi quy binding project
- **Given** menu **cấp project** (SessionTabBar `pOpenFinder`) và các action project khác
- **When** thực hiện các action đó
- **Then** vẫn dùng path project như cũ (không đổi hành vi).

### AC4 — Reveal chỉ cho session dir hợp lệ (allowlist)
- **Given** renderer gọi reveal với một `engineId`
- **When** main process xử lý
- **Then** main **tự derive** path từ `engineId` (`join(homedir(), '.awog', 'sessions', <engineId>)`), validate `engineId` khớp charset an toàn + `startsWith(sessionsDir + sep)`; **không bao giờ** nhận path tuyệt đối tùy ý từ renderer (giữ invariant #2 + #4).

### AC5 — Session chưa persist → không mở path rác
- **Given** một session mới chưa gửi tin nhắn (`engineId == null` hoặc folder chưa tồn tại)
- **When** user mở context menu
- **Then** 2 action **Copy path / Open in Finder** bị **disable** (hoặc no-op + toast "Session chưa được lưu"); tuyệt đối không copy/reveal path rỗng hay parent dir.

## Edge cases

| Edge case | Hành vi mong đợi |
|---|---|
| **Session dir không tồn tại** (mới tạo, chưa persist) | Action disabled / no-op + toast. Không reveal parent. (AC5) |
| **`engineId == null`** (session unsaved) | Coi như "chưa persist" — disable action. |
| **`session.project == null`** (session unscoped, không thuộc project nào) | **Không ảnh hưởng** — path session độc lập với project. Copy/reveal vẫn hoạt động bình thường. Đây chính là bug: path session KHÔNG được phụ thuộc project. |
| **Browser-dev (không có Electron shell, `sc.available == false`)** | **Copy path**: vẫn copy được string (dùng `navigator.clipboard`, không cần shell) — chấp nhận copy path lý thuyết. **Open in Finder**: disable/ẩn (không có shell để reveal). |
| **`engineId` chứa ký tự lạ / traversal** (`../`, `/`, `\`) | Main reject qua regex allowlist + `startsWith` check → throw, không reveal. Defence in depth trùng `sanitizeChild` phía sidecar. |
| **Clipboard API bị chặn / lỗi** | Catch, no-op (best-effort như code hiện tại). Không crash. |
| **Multi-session / concurrent** | Không có shared mutable state; mỗi action đọc `ctx.value` tại thời điểm click. Không conflict. |

## Security constraints (bắt buộc)

- **Invariant #2 (Path sanitize):** renderer chỉ truyền **`engineId`** (một slug), **không truyền path**. Main process derive `join(homedir(), '.awog', 'sessions', engineId)`, validate:
  1. `engineId` khớp charset allowlist (chỉ `[a-z0-9-]` + có thể `_`; **cấm** `/`, `\`, `.`) — mirror `SOURCE_SLUG_RE` hiện có.
  2. `target.startsWith(sessionsDir + sep)` (defence in depth).
- **Precedent có sẵn:** dùng đúng pattern `shell:revealSourceFolder` — `apps/desktop/electron/src/ipc.ts:95-105` (nhận slug, derive + validate, `shell.showItemInFolder`). Feature này thêm handler tương tự `shell:revealSessionFolder` (nhận `engineId`).
- **KHÔNG dùng** `shell:revealPath` / `shell:openPath` hiện có cho session dir: chúng validate qua `resolveInsideWorkspace(root, relPath)` — session dir nằm **ngoài** workspace nên sẽ bị chặn (đúng như thiết kế). Không được nới `resolveInsideWorkspace` để lách.
- **Invariant #4 (IPC boundary):** UI không `import fs` / build path tuyệt đối rồi gửi xuống. Chỉ gửi `engineId` qua IPC method dedicated.
- **No secret leak:** path session không chứa secret; an toàn để copy/hiển thị.

## Dependency với entity hiện có

- **Session** — cần `engineId` (slug on-disk). Nguồn: `stores/sessions.ts` (`session.engineId`).
- **Project** — chỉ để đảm bảo **không hồi quy** (action project khác giữ nguyên `projectPath`).
- **Sidecar path helpers** — `sessionDir(id)` / `sessionsDir()` (`sessions/jsonl.ts`) là nguồn chân lý layout on-disk; main process phải derive path **cùng công thức** (`~/.awog/sessions/<id>/`). Nếu layout đổi, cả 2 nơi phải đồng bộ (ghi chú cross-ref trong code).

## Out of scope

- Không thêm action "Copy path to `session.jsonl`" (chỉ folder). Có thể là follow-up nếu user cần.
- Không đổi menu cấp project (SessionTabBar `pOpenFinder`) — đang đúng.
- Không refactor `resolveInsideWorkspace` / các reveal path khác.
- Không thêm reveal cho `attachments/` riêng.
- Không đụng luồng export session (`useSessionExport` đã reveal đúng file export của nó).
- Không hỗ trợ reveal session dir trong browser-dev (không có OS shell).

## Restart-safe / local-first / notification

- **Local-first / offline:** action thuần local (clipboard + shell), không cần mạng. OK offline.
- **Restart-safe:** action idempotent, không ghi state. Không cần resume.
- **Approval gate / trace / auto-commit:** không chạm. Không persist event.
- **Tray/notification:** chỉ cần toast in-app khi session chưa persist (AC5). Không native notification.

## Open questions còn lại

- (Không còn open question chặn triển khai — 2 câu của PO đã chốt ở bảng trên.)
- Xác nhận nhỏ cho tech-lead: đặt tên IPC method mới `shell:revealSessionFolder` (nhận `engineId`) — nhất quán với `shell:revealSourceFolder`. Nếu muốn gộp thành `shell:revealAwogHomeFolder(kind, slug)` tổng quát thì để TL quyết (YAGNI: nghiêng về method riêng, đơn giản hơn). → **Chốt ở "Design decisions (Tech Lead)" bên dưới.**

## Đề xuất chuyển tiếp

Spec đủ để chuyển **tech-lead / developer**: thay đổi khu trú (1 IPC handler mới + preload + `useSidecar` wrapper + sửa 2 handler trong `SessionList.vue`). Không cần ADR mới (tái dùng pattern `revealSourceFolder` đã có ADR/precedent). Đề xuất bỏ qua PM decompose (task S đơn), đi thẳng developer, QA verify theo AC1–AC5.

## Design decisions (Tech Lead)

> Loại quyết định: **design note** (không ADR). Lý do: thay đổi khu trú, tái dùng nguyên precedent `shell:revealSourceFolder` (đã có tiền lệ/ADR), không thêm dependency, không đổi schema/data shape, không phá invariant nào. Dưới ngưỡng "BẮT BUỘC ADR".

### Q1 — Hình method reveal: **method riêng `shell:revealSessionFolder(engineId)`** ✔

Không dùng `shell:revealAwogHomeFolder(kind, slug)` tổng quát.

- **YAGNI:** hiện chỉ có 2 loại folder awog-home cần reveal (sources, sessions), mỗi cái đã/đang có method riêng. Chưa có loại thứ 3 nào cần → không abstract sớm (Rule of Three: mới 2 lần copy).
- **KISS + audit:** mỗi method 1 dir cố định hard-code (`sources` / `sessions`) → sink filesystem đọc thẳng ra tên method, dễ audit invariant #2. Method tổng quát phải map `kind → dir` (thêm 1 lớp allowlist enum, thêm bề mặt lỗi) mà không đổi được gì về bảo mật.
- **Đối xứng:** mirror 1-1 `shell:revealSourceFolder` — developer copy pattern, reviewer đọc quen.

### Q2 (load-bearing) — Nguồn string "Copy path": **(b) thêm IPC `shell:sessionFolderPath(engineId)` trả absolute path** ✔

Không copy dạng chưa expand `~/.awog/sessions/<engineId>`.

- **Least Astonishment (thắng KISS ở đây):** người dùng copy path để `cd`/paste vào tool. `~` không expand ở nhiều context (file manager, terminal non-interactive, IDE "reveal path", app GUI) → path gãy. Copy path phải là **absolute, dùng được ngay** — đó chính là giá trị của tính năng. AC1 cũng ghi rõ "đường dẫn tuyệt đối".
- **Invariant #4 + #2 giữ nguyên:** renderer **không** tự build từ `homedir()`. Main derive + validate rồi trả string. Đối xứng hoàn toàn với reveal (cùng derive + cùng validate), chỉ khác action cuối (trả string vs `showItemInFolder`).
- **Chi phí:** +1 method thuần. Chấp nhận được để đạt AC1 đúng nghĩa.
- **Không chạm secret:** path session không chứa secret (invariant #1 không bị chạm).

### Signature 2 method mới (`electron/src/ipc.ts` + `preload.ts`)

Dùng chung 1 regex allowlist + 1 helper derive để DRY (không lặp validate 2 chỗ):

```ts
// ipc.ts — cùng charset SOURCE_SLUG_RE hiện có (ipc.ts:30). engineId = slug
// session-slug.ts: `${yymmdd}-${adj}-${noun}-${tail}`, chỉ [a-z0-9-]. Tái dùng
// luôn hằng đó, KHÔNG khai regex mới.
function sessionDirFromId(engineId: string): string {
  if (typeof engineId !== 'string' || !SOURCE_SLUG_RE.test(engineId)) {
    throw new Error(`invalid session id: ${String(engineId)}`)
  }
  const sessionsDir = join(homedir(), '.awog', 'sessions')
  const target = join(sessionsDir, engineId)
  if (!target.startsWith(sessionsDir + sep)) {
    throw new Error(`session path escapes sessions dir: ${target}`)
  }
  return target
}

ipcMain.handle('shell:revealSessionFolder', async (_e, engineId: string) => {
  shell.showItemInFolder(sessionDirFromId(engineId)) // input: engineId; output: void
})

ipcMain.handle('shell:sessionFolderPath', async (_e, engineId: string) =>
  sessionDirFromId(engineId), // input: engineId; output: absolute path string
)
```

| Method | Input | Output | Validate |
|---|---|---|---|
| `shell:revealSessionFolder` | `engineId: string` | `Promise<void>` | `SOURCE_SLUG_RE` + `startsWith(sessionsDir + sep)` |
| `shell:sessionFolderPath` | `engineId: string` | `Promise<string>` (absolute) | như trên (dùng chung `sessionDirFromId`) |

**Charset validate `engineId`:** `SOURCE_SLUG_RE = /^[a-z0-9-]+$/` (tái dùng hằng có sẵn ở `ipc.ts:30`). Cho phép: chữ thường `a–z`, số `0–9`, dấu `-`. Cấm: `/`, `\`, `.` (chặn `..` + path tuyệt đối), `_`, khoảng trắng, mọi ký tự khác. Đủ phủ định dạng engineId thực tế (`utils/session-slug.ts` chỉ sinh `[a-z0-9-]`). `startsWith` là defence-in-depth trùng `sanitizeChild` phía sidecar (`jsonl.ts:48`).

> **Lưu ý cho developer:** KHÔNG stat kiểm tra dir tồn tại **ở main** (thêm I/O + race). AC5 (session chưa persist) gate **ở renderer** theo `session.engineId != null`. Nếu có `engineId` nhưng folder chưa flush (edge hiếm), `showItemInFolder` best-effort — chấp nhận.

### Impact / Consequences

- **Sửa:** `electron/src/ipc.ts` (+1 helper +2 handler), `electron/src/preload.ts` (+2 wrapper `revealSessionFolder` / `sessionFolderPath`), `useSidecar` (thêm 2 method + typing `window.awog`), `SessionList.vue:504-517` (2 handler `ctxCopyPath` / `ctxOpenFinder` gọi method mới thay `projectPath`).
- **Không migrate data.** Không đổi layout on-disk (đọc theo công thức `sessionDir` sẵn có).
- **Không đụng:** `resolveInsideWorkspace`, `SessionTabBar.pOpenFinder` (project-level, đúng), luồng export session.
- **Ảnh hưởng:** chỉ context menu cấp session. Browser-dev: Copy path degrade (không có IPC → gate `sc.available` hoặc no-op); Open in Finder ẩn/disable như AC.

### Bước tiếp (developer task list)

1. `ipc.ts`: thêm `sessionDirFromId` + 2 handler `shell:revealSessionFolder` / `shell:sessionFolderPath` (tái dùng `SOURCE_SLUG_RE`, `homedir`, `sep`, `join`).
2. `preload.ts`: expose 2 wrapper trong `window.awog` (mirror `revealSourceFolder`).
3. `useSidecar` wrapper: `revealSessionFolder(engineId)` + `sessionFolderPath(engineId)` (+ typing).
4. `SessionList.vue`: `ctxCopyPath` → `await sc.sessionFolderPath(engineId)` rồi `navigator.clipboard.writeText`; `ctxOpenFinder` → `sc.revealSessionFolder(engineId)`. Gate cả 2 theo `ctx.session.engineId != null` (AC5); Open in Finder thêm gate `sc.available`.
5. QA verify AC1–AC5.
