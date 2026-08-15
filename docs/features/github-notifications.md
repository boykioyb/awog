# GitHub notifications → toast trong app

> Trạng thái: **implemented** (2026-08-14). Liên quan: [project-github.md](project-github.md), [ADR 0049](../decisions/0049-github-issues-and-prs-via-gh-cli.md).

## Vấn đề

Khi làm việc trong AWOG, các sự kiện đáng chú ý trên GitHub (được yêu cầu review, bị mention, có comment mới trên PR của mình) chỉ thấy được nếu chủ động mở tab Issues/PR hoặc rời app sang github.com. Người dùng muốn **biết ngay trong app**, không phải đi kiểm tra.

## Phạm vi

- **Poll hộp thông báo GitHub** của gh account đang dùng (mặc định app-level, Settings → Git).
- **Opt-in theo project**: một tài khoản GitHub thường có hàng chục repo; chỉ project mà người dùng chọn mới được bắn thông báo. Không chọn project nào ⇒ không poll gì cả (kể cả khi bật toggle).
- **Chọn kiểu gửi**: toast in-app (bấm được → mở thẳng drawer PR/Issue), thông báo **native OS**, hoặc cả hai.
- KHÔNG có: inbox UI riêng, mark-as-read, subscribe/unsubscribe (chưa cần — YAGNI).

## Luồng

```
useGhNotifications (renderer, singleton, main window)
   │  mỗi tick (≥60s)
   ├─ gh.notifications { account?, since?, limit }
   │        └─ sidecar: gh api "notifications?per_page=N[&since=…]"   (1 spawn)
   ├─ lọc theo repoToProject (chỉ project đã opt-in)
   ├─ dedupe theo (id, updatedAt) — persist localStorage
   ├─ pushActionToast(text, { action, icon })       → ActionToastHost
   └─ Notification API khi window hidden/blur       → click = focus + route
```

Click toast → `useProjectModal.open(projectId, { tab, ghNumber })` → ProjectQuickViewModal → ProjectDetail (chuyển tab + `openNumber`) → ProjectGh → `gh.open(number)` mở drawer. Không map được project/number (release, discussion…) ⇒ `openExternal(url)`.

## RPC

| Method | Params | Trả về |
|---|---|---|
| `gh.notifications` | `{ account?, since?: ISO-UTC, limit?: 1..100 }` | `{ notifications: GhNotification[] }` |

```ts
type GhNotificationType = 'PullRequest' | 'Issue' | 'Other'
interface GhNotification {
  id: string            // thread id (ổn định qua các lần update)
  reason: string        // review_requested | mention | assign | comment | …
  updatedAt: string
  title: string
  type: GhNotificationType
  repo: string          // owner/repo
  number: number | null // null cho release/discussion
  url: string           // LUÔN là https://github.com/… (khác ⇒ bỏ)
}
```

- **Account-scoped, KHÔNG repo-scoped** → dùng `runGhAccount()` (không cwd): inbox trải trên mọi repo nên không có project cwd để gán, và cũng không có gì path-like đi vào args.
- `since` validate bằng regex ISO-8601 UTC trước khi vào query — đây là giá trị duy nhất do renderer cung cấp chạm vào request path.
- Parse bằng zod lenient (`.passthrough()`), chỉ pick field cần; `subject.url` (API url) map sang web url + số hiệu.

## Dedupe & seed

- **Key dedupe = `(id, updatedAt)`**, không phải id: GitHub giữ nguyên thread id khi có comment mới, nên chỉ so id sẽ nuốt mất "PR cũ có hoạt động mới".
- **Seed lần đầu**: lần poll đầu tiên của một máy mới chỉ ghi nhận inbox hiện có mà KHÔNG toast — nếu không, mở app lên là ăn một tường toast cho thứ đã đọc trên github.com.
- `seen` (cap 300 entry) + `polledAt` persist localStorage → restart app không toast lại.
- `since` = lần poll trước ⇒ payload nhỏ. Stamp `polledAt` TRƯỚC khi present để một lỗi khi hiển thị không làm tick sau gửi lại nguyên cửa sổ đó.
- Một tick nhiều thông báo mới → tối đa **3 toast** + 1 dòng gộp `+N`.

## Settings (Settings → Git)

| Setting | Mặc định | Ghi chú |
|---|---|---|
| `githubNotify.enabled` | `true` | Bật/tắt nguồn GitHub (công tắc nằm ở Settings → Thông báo). Bật nhưng chưa chọn project ⇒ vẫn không poll. |
| `githubNotify.intervalMs` | `60_000` | 1/2/5/10 phút. Poller **floor ở 60s** — mức tối thiểu GitHub tài liệu hoá cho API này. |
| `githubNotify.projectIds` | `[]` | Danh sách project được theo dõi (checkbox). |

**Ranh giới cấu hình** (một chỗ một việc):

- **Settings → Thông báo** — *thông báo đến tay người dùng KIỂU GÌ*, dùng chung cho mọi nguồn: `notifications.delivery` (`toast` / `native` / `both`, mặc định `both`), `notifications.toastPosition` (6 góc, mặc định `bottom-right`) + nút Xem thử, và công tắc bật/tắt từng nguồn (`sessionEvents`, `githubNotify.enabled`).
- **Settings → Git → Thông báo GitHub** — *poll CÁI GÌ*: chu kỳ, danh sách project, nút **Kiểm tra kết nối** (`checkGhNotifications()`). Nút này là chẩn đoán: poll cố tình nuốt lỗi (toast lỗi mỗi phút còn tệ hơn thiếu tính năng) nên đây là chỗ duy nhất thấy được gh chưa auth / project map sai. Nó fetch một lần rồi báo inline `matched/total`, KHÔNG bắn toast và KHÔNG đụng `seen`/`polledAt`.

Slice `notifications` gom từ 3 chỗ cũ (`githubNotify.delivery`, `appearance.toastPosition`, `sessions.notificationsEnabled`) — store seed từ giá trị cũ khi hydrate nên install đang chạy không mất lựa chọn.

**Thông báo native OS** dùng Notification API của renderer (Chromium trong Electron) — cùng đường với native notification của Sessions, KHÔNG phải `Notification` của Electron main. Quyền chỉ xin khi người dùng chọn kiểu gửi có OS (không bao giờ xin lúc boot), và chọn xong là **bắn ngay một thông báo mẫu**: quyền bị từ chối mà im lặng thì không phân biệt được với "chưa có thông báo nào". Kết quả (`granted` / `denied` / `unsupported`) hiện ngay ở mô tả của field. Lưu ý môi trường: bản dev chưa ký hiện tên "Electron", và Focus/Do Not Disturb của macOS vẫn chặn được — đó là hành vi của OS, không phải lỗi app.

Kiểu gửi `native` cố tình bỏ qua cổng focus cho thông báo GitHub (không có toast thì phải có cái gì đó hiện ra kể cả khi app đang trước mặt); `both` giữ luật cũ — OS chỉ bắn khi cửa sổ không focus. **Sự kiện session luôn chỉ bắn khi mất focus** kể cả ở mode `native`: session đang mở đã hiện trạng thái trực tiếp rồi. Mode `toast` = không bao giờ đụng OS, áp cho mọi nguồn.

## repo → project

Map `owner/repo` (lowercase) → projectId, dựng lại mỗi khi đổi lựa chọn project / account:

1. `githubSlugFromRemote(project.gitRemote)` — đồng bộ, phủ project single-repo.
2. `git.discoverRepos` cho từng project đã chọn — phủ **multi-repo workspace** (project root không có remote riêng).

## Bảo mật

- Token gh không rời sidecar (invariant #1): `runGhAccount` dùng đúng đường `resolveGhEnv` như mọi lệnh gh khác — token chỉ vào env của child.
- `url` trả về UI được ép phải nằm trên `https://github.com/` trước khi đưa vào `openExternal` — dữ liệu từ API vẫn coi là L1.
- Không thêm surface remote-gateway: `gh.*` KHÔNG nằm trong allowlist mobile (không cần infosec re-audit cho PWA).
- Poll thất bại (gh chưa cài / chưa auth / rate limit) là **im lặng** — toast lỗi mỗi phút còn tệ hơn thiếu tính năng; lỗi cuối lưu ở `useGhNotificationsStatus()`.

## Acceptance

- **AC1** — Bật toggle + chọn ≥1 project ⇒ trong vòng ≤ interval, notification mới của repo thuộc project đó hiện thành toast; project không chọn thì không.
- **AC2** — Bấm toast của PR/Issue ⇒ mở quick-view của đúng project, đúng tab, drawer đúng số hiệu. Bấm toast của release/discussion ⇒ mở github.com.
- **AC3** — Mở lại app không toast lại thông báo đã thấy; máy mới chạy lần đầu KHÔNG toast backlog.
- **AC4** — Kiểu gửi `both`: cửa sổ không focus ⇒ có native notification (khi đã cấp quyền), click vào route đúng như toast. Kiểu `native`: có notification OS kể cả khi app đang focus và KHÔNG có toast. Kiểu `toast`: không đụng OS.
- **AC5** — Tắt toggle hoặc bỏ chọn hết project ⇒ không còn lệnh `gh` nào chạy theo chu kỳ.
- **AC6** — gh chưa auth / lỗi mạng ⇒ không toast lỗi lặp lại, app vẫn hoạt động bình thường.
- **AC7** — Settings → Thông báo: đổi vị trí toast ⇒ toast mẫu hiện ngay ở góc mới; nút "Xem thử" bắn lại được mà không cần đổi vị trí. Vị trí áp dụng cho mọi toast, không riêng GitHub.
- **AC8** — Settings → Git → "Kiểm tra kết nối" ⇒ báo inline `matched/total` khi OK, hoặc lý do khi hỏng (chưa chọn project / engine không khả dụng / lỗi gh). KHÔNG bắn toast, và sau khi kiểm tra thì thông báo thật vẫn được bắn ở tick sau (không ghi `seen`/`polledAt`).

## Chưa làm (có thể sau)

- Inbox UI + mark-as-read (`PATCH /notifications/threads/:id`).
- Lọc theo `reason` (chỉ review_requested/mention).
- Dùng header `X-Poll-Interval` / `Last-Modified` của GitHub để nhịp poll tự thích ứng (hiện `gh api` không expose header cho caller).
