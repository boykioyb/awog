# Session — Git branch & Git manager modal

Cho phép thao tác Git của project ngay trong một Session mà không rời màn hình chat:

1. **Hiển thị branch hiện tại** — chip trong header Session ([SessionHeader.vue](../../apps/desktop/ui/components/session/SessionHeader.vue)).
2. **Đổi branch nhanh** — bấm chip mở dropdown lọc + danh sách branch local → checkout.
3. **Mở Git manager đầy đủ trong modal** — nút Git ở header (hoặc footer dropdown) bật modal chứa nguyên trang Git, ghim sẵn project của Session.

## Kiến trúc

### Tái dùng trang Git qua `GitManager.vue`

Thân trang Git được tách thành component [components/git/GitManager.vue](../../apps/desktop/ui/components/git/GitManager.vue); [pages/git/index.vue](../../apps/desktop/ui/pages/git/index.vue) chỉ còn render `<GitManager />`. Một nguồn sự thật duy nhất cho cả trang `/git` lẫn modal trong Session.

- `GitManager` nhận prop tuỳ chọn `projectId`:
  - **Page mode** (không prop): giữ nguyên hành vi cũ — chọn lại project trước đó / project đầu tiên nếu chưa chọn.
  - **Modal mode** (`projectId` = project của Session): `store.setSelectedProject(projectId)` trước khi discover + reload. Modal **chủ động** đổi `selectedProjectId` toàn cục (hành động do người dùng khởi tạo) — mở `/git` sau đó sẽ thấy đúng project vừa xem.
- Modal: [components/session/SessionGitModal.vue](../../apps/desktop/ui/components/session/SessionGitModal.vue) — overlay rộng (92vw × 86vh, max 1400px) bọc `GitManager`. Không dùng `BaseModal` vì cần width/height lớn hơn. `useEscape` (stack LIFO) đảm bảo các sub-modal của `GitManager` (branch menu, dirty-checkout…) nuốt Escape trước; click backdrop (`@click.self`) đóng modal, các sub-modal teleport ra `body` nên không kích hoạt backdrop này.

### Chip branch độc lập qua `useSessionBranch`

Chip + đổi branch nhanh **không** đụng global git store (tránh việc duyệt Session làm "trôi" selection của trang Git). Composable [composables/useSessionBranch.ts](../../apps/desktop/ui/composables/useSessionBranch.ts) gọi thẳng `useGitApi` theo `workspaceRoot` của Session — đúng pattern [WorkspaceDiffTab.vue](../../apps/desktop/ui/components/session/workspace/WorkspaceDiffTab.vue):

- `branchList(root)` → `currentBranch`, `localBranches`, `ahead`/`behind`.
- `switchBranch(name)` → `branchCheckout(root, { name })`. **Chỉ checkout khi cây sạch**: lỗi `DIRTY_TREE` set `dirtyBranch` → dropdown hiện cảnh báo trỏ sang Git manager (force/stash thuộc về modal đầy đủ, không làm inline để tránh discard nhầm).
- Subscribe `git:status:changed` (debounce 200ms) → reload, nên checkout trong modal / terminal ngoài cũng cập nhật chip.

UI: [components/session/SessionBranchSwitcher.vue](../../apps/desktop/ui/components/session/SessionBranchSwitcher.vue) — chip chỉ render khi đã biết branch (project bound vào repo thật), nên không cần dấu phân tách trong header.

## i18n

`session.branch.*` (switch / filter / none / no_match / dirty / open_git) + `session.git.*` (title / open) — en + vi.

## Edge cases

- Session không project / project không phải repo → chip ẩn; nút Git vẫn mở modal (Git manager tự xử lý empty + init CTA).
- Browser dev (no sidecar): `useSessionBranch` trả rỗng (chip ẩn); `GitManager` chạy nhánh mock của git store như trang `/git`.
- Đổi Session khi modal đang mở → modal đóng (watch `session.id` reset `showGitModal`).
