# 0045 — Persist app settings vào `~/.awog/settings.json` qua sidecar

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-17
- **Người quyết định:** tech-lead (theo yêu cầu user)

## Bối cảnh

Toàn bộ app settings (appearance, theme mode, session defaults, git, composer,
quota-warning, auto-update, workspacePath…) hiện chỉ persist ở **`localStorage`**
của renderer (mỗi nhóm một key `awog.*.v1`, qua các composable `useAppearance`,
`useGitSettings`, …). Hai vấn đề:

1. **Lệch triết lý local-first.** AWOG lấy *filesystem làm data layer*
   (`~/.awog/mcp-servers/`, `~/.awog/workflows/`, `credentials.json`…). Settings
   sống trong localStorage thì **không inspect/edit/backup/version-control bằng
   file được**, và đó là điều user kỳ vọng từ một app local-first.
2. **Sidecar không đọc được settings.** Mọi setting mà sidecar/task cần (vd git
   auto-commit per-phase — đang *deferred* đúng vì lý do này) phải nhồi vào IPC
   payload mỗi request, hoặc không dùng được. localStorage là vùng của renderer,
   sidecar không truy cập.

Ngoài ra trước thay đổi này, **theme mode (dark/light)** và **session defaults**
còn chưa persist gì cả (reload là mất) — đã vá tạm bằng localStorage, nay gộp
luôn vào file.

Ràng buộc:
- **Invariant #4 (IPC boundary):** UI không được `import fs` — ghi file phải đi
  qua sidecar IPC.
- **Không FOUC:** theme/appearance phải apply ngay frame đầu; đọc file qua IPC là
  *async* → nếu phụ thuộc hoàn toàn vào file sẽ "nháy" theme default mỗi lần mở.
- **Không secret vào file:** accounts/API key vẫn thuộc `credentials.json` +
  keychain (invariant #1), **không** đưa vào `settings.json`.

## Quyết định

Thêm một file **`~/.awog/settings.json`** làm **source of truth bền vững** cho
app settings, đọc/ghi **qua sidecar** bằng 2 RPC method mới:

- `settings.get` → trả về object JSON đã lưu (hoặc `{}` nếu chưa có file). Sidecar
  **không** áp default/coerce — chỉ I/O thuần (dumb blob store); UI sở hữu
  schema + coercion (file là input L1, coerce ở biên).
- `settings.set({ patch })` → **shallow-merge** `patch` vào object đã lưu (mỗi
  nhóm là một top-level key nên merge nông là đủ, tránh race giữa các nhóm), ghi
  **atomic** (`.tmp` → `chmod 600` → `rename`), trả về object đã merge. Ghi được
  serialize qua mutex in-process.

Scope file = **toàn bộ trừ accounts**: `themeMode`, `appearance`, `defaults`,
`git`, `autoUpdate`, `composer`, `quotaWarning`, `workspacePath`, `autoApprove`,
`notificationsEnabled`.

**localStorage giữ vai trò cache đọc-nhanh** (chống FOUC), **file là nguồn sự
thật**. Hợp đồng đồng bộ (`useSettingsSync`):

- **Boot:** seed store từ localStorage (sync, không FOUC) → rồi `settings.get`
  (async). Nếu file có dữ liệu → coerce + distribute vào store (cascade ra
  localStorage + DOM qua watcher sẵn có) ⇒ **file thắng** khi user sửa tay file.
  Nếu file rỗng (máy mới / lần đầu migrate) → seed file từ snapshot store hiện tại.
- **Ghi:** một deep-watch trên snapshot các nhóm → debounce → `settings.set`.

Tức là *vừa* có file inspect/edit/backup được + sidecar đọc được, *vừa* không
regress FOUC.

## Phương án đã cân nhắc

- **Chỉ file, bỏ localStorage** — loại: `settings.get` async ⇒ nháy theme default
  mỗi lần mở (regress UX so với hiện tại). Cần cache sync ⇒ localStorage là lựa
  chọn hiển nhiên.
- **Giữ nguyên localStorage, không làm file** — loại: chính 2 vấn đề ở Bối cảnh
  (không inspect được, sidecar không đọc được) là thứ user muốn giải.
- **Sidecar coerce/áp default trong `settings.get`** — loại: trùng schema với UI
  (DRY ngược), và UI vẫn phải coerce vì file là L1. Giữ sidecar dumb (KISS).
- **Mỗi nhóm một file** (`settings/appearance.json`…) — loại: nhiều file vụn,
  khó đọc tổng thể; một `settings.json` map thẳng shape store, dễ inspect hơn.
- **`settings.set` ghi cả object thay vì patch** — loại: race giữa các watcher
  nhóm ghi đè nhau; patch + shallow-merge an toàn hơn.

## Hệ quả

- **Tích cực:**
  - Settings là file thật: inspect / sửa tay / backup / version-control được;
    đúng tinh thần filesystem-as-data-layer.
  - Sidecar đọc được settings trực tiếp ⇒ mở đường wire git auto-commit per-phase
    (đang deferred) mà không phải nhồi payload.
  - Không FOUC (localStorage cache giữ nguyên đường first-paint).
  - Churn nhỏ: 6 composable chỉ cần *export* hàm `coerce*`; logic localStorage giữ
    nguyên.
- **Tiêu cực / Trade-off:**
  - **Hai nơi lưu** (localStorage cache + file). Khử mơ hồ bằng luật "file thắng
    lúc boot"; ghi luôn đẩy cả hai. Chấp nhận 1 lần ghi-lặp vô hại lúc distribute.
  - Browser-dev (không có sidecar) ⇒ chỉ còn localStorage (file no-op) — đúng như
    các store khác đã fallback.
- **Việc cần làm tiếp:**
  - (Tùy chọn) wire sidecar đọc `settings.json` cho git auto-commit per-phase.
  - (Tùy chọn) infosec review: file 600, không secret, path cố định trong
    `awogHome()`.

## Tham chiếu

- [docs/features/settings.md](../features/settings.md) — spec chi tiết phần persistence
- ADR liên quan: [0017](0017-git-manager-ipc-contract.md) (git settings deferred),
  [0028](0028-auto-update.md), [0044](0044-adopt-shadcn-vue-real.md)
- Invariant: [.claude/rules/security.md](../../.claude/rules/security.md) (#1, #4)
