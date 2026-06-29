# Kéo folder vào Session → thư mục làm việc

## Vấn đề

Người dùng kéo file/folder vào một session để nhờ AI thao tác (vd "dịch các file markdown trong folder này"). Trước đây chỉ có **file attachment** (mang nội dung qua `preview`/`dataUrl`), nhưng attachment **không mang đường dẫn trên đĩa** — trình duyệt cắt path thật của file. Hệ quả: model không biết folder nằm đâu để đọc các file anh em, và nếu session chưa gắn project thì cwd fallback về `process.cwd()` (thư mục cài app), khiến `find` quét trúng `node_modules` của sidecar. Xem thêm bản vá cwd ở [system-overview](../architecture/system-overview.md) (engine spawn sidecar với `cwd: homedir()`).

## Giải pháp

Cho phép **kéo cả folder** vào session. Folder đó trở thành **thư mục làm việc (cwd) của session**: model đọc/ghi + khám phá file con như khi mở project, và sống suốt session (persist qua restart). Kèm hiển thị **cây file** của folder trong `PreviewModal`.

## Luồng

Folder là **attachment theo từng message** (như file đính kèm): hiện trên bubble của turn gửi nó, KHÔNG giữ chip persistent dưới composer — vì history được gửi lại model mỗi turn nên ngữ cảnh không mất. Khi gửi, nó set **thư mục làm việc của session** (`session.workspaceFolder` = cwd, bền + forward mỗi turn) để tool thật sự chạy trong folder ở các turn sau.

1. **Kéo folder** vào `SessionDetail`. `onDrop` phân biệt folder với file qua `DataTransferItem.webkitGetAsEntry().isDirectory`, lấy path tuyệt đối qua `window.awog.getPathForFile(file)` (Electron `webUtils.getPathForFile` — `File.path` đã bị gỡ từ Electron 32). Đẩy một `SessionAttachment` `{ folder: true, path }` vào `pendingAtt` (chip tạm ở composer, giống file).
2. **Gửi** (`onSend`): nếu pending có folder att → `store.setWorkspaceFolder(id, path)` (set+persist cwd) rồi `sendMessage` (folder att vào `message.att` → bubble), xoá pending. Folder att render bằng `SessionAttachmentChip` (icon folder, bấm → cây); KHÔNG mang nội dung tới model (bị loại khỏi `engineAtts`).
3. **Mỗi turn** store forward `workspacePath = session.workspaceFolder` xuống `sessions.sendMessage`.
4. **Sidecar** (`sessions.send-message.ts`): validate `workspacePath` (absolute + directory) → dùng làm **cwd** (ưu tiên trước path từ `projectId`). Chèn block `<workspace_tree>` (bounded: depth ≤ 4, ≤ 300 entry, prune `SKIP_DIRS`, không theo symlink) vào `systemPromptAppend`.
5. **Info → "FILE NGỮ CẢNH"** (`useSessionContextFiles`): liệt kê working folder (kind `folder`, từ `session.workspaceFolder`) + attachment + pinned. Bấm row folder → mở cây.
6. **PreviewModal** (`kind: 'folder'`): cây lazy qua `fs.listDir` (controller trong `usePreviewModal`, render bằng `SessionFileTree`). Bấm file trong cây → repoint modal sang file đó (`fs.readFile`/`fs.readFileBase64`).

## Persist

`session.workspaceFolder` (cwd) round-trip y như `pinnedContext`: trên `Session` (UI + sidecar `types/shared.ts`), qua `sessions.upsert` (schema + `update-metadata` patch + `SessionMetadataPatch`), trả trong full session (`sessions.get`) để hydrate → cwd + row Info sống qua restart. Folder att trên bubble KHÔNG persist sidecar (bị loại khỏi `engineAtts`) → sau reload bubble cũ mất chip folder, nhưng cwd + Info vẫn còn.

## Bảo mật (8 invariant)

- **#2 Path sanitize:** mọi I/O trong folder scope qua `assertInsideWorkspace(folder, rel)` sẵn có (cwd = folder). Cây lazy + block tree đều resolve qua `assertInsideWorkspace`, không theo symlink ra ngoài.
- Folder do user **chủ động kéo** (đã đồng thuận) — `getPathForFile` chỉ trả path của đúng file/folder vừa thả, không liệt kê filesystem tùy ý. Không mở thêm bề mặt tấn công.
- **#4 IPC boundary:** UI không đụng `fs`; mọi đọc cây/đọc file qua sidecar RPC.

## Giới hạn đã biết (v1)

- **Đổi/clear folder:** kéo folder mới (trước khi gửi) → att tạm trong composer, có thể gỡ bằng × như file. Sau khi gửi, cwd đã set; muốn đổi thì kéo folder khác (lần gửi sau ghi đè `session.workspaceFolder`). Chưa có nút clear cwd hẳn (dead `clearWorkspaceFolder` còn trong store cho tương lai).
- **Bubble folder chip mất sau reload:** folder att không persist sidecar (loại khỏi `engineAtts`); cwd + row Info vẫn còn (từ `session.workspaceFolder`).
- **1 folder / session:** một cwd tại một thời điểm; kéo folder mới ghi đè.
- **Mở file trong cây thay nội dung modal:** bấm file trong cây thay cây bằng file đó; mở lại cây qua row "FILE NGỮ CẢNH" trong Info hoặc bubble chip.

## File chạm

| Lớp | File |
|---|---|
| Electron preload | `apps/desktop/electron/src/preload.ts` (`getPathForFile`), `apps/desktop/ui-next/types/awog-bridge.d.ts` |
| UI drop + store | `components/session/SessionDetail.vue` (`onDrop`), `stores/sessions.ts`, `composables/useSessionsData.ts` |
| UI composer chip | `components/session/SessionComposer.vue` |
| UI preview tree | `composables/usePreview.ts`, `composables/usePreviewModal.ts`, `components/common/PreviewModal.vue` (tái dùng `SessionFileTree.vue`) |
| Sidecar | `methods/sessions.send-message.ts` (`workspacePath` + `<workspace_tree>`), `methods/sessions.upsert.ts`, `sessions/store.ts`, `types/shared.ts` |
| i18n | `i18n/locales/{en,vi}/sessions-composer.json`, `i18n/locales/{en,vi}/common.json` |
