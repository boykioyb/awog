# Feature: Settings

**Trạng thái:** Draft

## Overview

Settings panel cung cấp cấu hình workspace, model API key, connector và appearance. Tổ chức thành 4 section trong sidebar.

## 4 Section

### 1. Workspace

- **Local path** của workspace (`~/workspaces/...`).
- **Git versioning status** — hiển thị có đang track không, branch hiện tại.
- **Auto-approve toggle** — bật để skip approval gate (xem [human-approval](./human-approval.md)).
- **Notifications toggle** — bật/tắt native notification (xem [tray-and-notifications](../design/tray-and-notifications.md)).

### 2. Models & API Keys

- **3 provider card** mặc định:
  - **Anthropic** — API key (password input), connection status dot, **Test** button.
  - **OpenAI** — tương tự.
  - **Google** — tương tự.
- **"Add custom provider" card** cho:
  - OpenRouter
  - Ollama (local)
  - LM Studio (local)
- API key lưu cục bộ trong `settings.json` (không bao giờ rời máy người dùng — xem [ADR 0001](../decisions/0001-local-first-storage.md)).
- Encrypt at-rest bằng OS keychain (macOS Keychain, Windows Credential Store, libsecret Linux).

### 3. Connectors

- **Notion** — Connect / Disconnect.
- **Jira** — Connect / Disconnect.
- **Slack** — Connect / Disconnect.
- Mỗi connector status dot xanh khi đã kết nối.
- Sau MVP: thêm GitHub, GitLab, Confluence, Discord, …

### 4. Appearance

- Link tới theme toggle ở sidebar (không duplicate control).
- Sau MVP: font size, density (comfortable / compact), accent color.

## Thuộc tính

```
{
  workspacePath: string
  autoApprove: boolean
  notificationsEnabled: boolean
  providers: {
    anthropic: { connected: boolean, apiKey: string }
    openai:    { connected: boolean, apiKey: string }
    google:    { connected: boolean, apiKey: string }
    // custom providers...
  }
  contextProviders: {
    notion: { connected: boolean }
    jira:   { connected: boolean }
    slack:  { connected: boolean }
  }
}
```

## Lưu trữ dữ liệu — phân tầng (ADR 0045 + issue #43)

> Phần dưới mô tả **ui-next**. `apps/desktop/ui/composables/useSettingsSync.ts` là
> bản cũ của app tiền-rebuild, không còn dùng.

### Vấn đề

Trước #43, phần lớn preference của app nằm trong **một key localStorage** (`awog-settings-v1`) của renderer:

- Không đi theo người dùng: cài lại app / xoá cache là mất sạch.
- Không export / backup / xem bằng mắt được.
- **Setting chức năng chỉ lưu localStorage là setting không có tác dụng thật.** Ví dụ đo được: Remote Gateway (Electron main) đọc `settings.get → defaults.{provider,modelId,thinkingLevel}` để quyết định model cho phiên tạo từ điện thoại, nhưng UI chưa bao giờ ghi `defaults` vào `settings.json` ⇒ điện thoại luôn rơi về hằng số `claude-opus-5` / `high`.
- Không có tầng dự án, và UI không nói được giá trị đang đến từ đâu.

### Ba nơi lưu và tiêu chí phân chia

| Nơi lưu | Là tầng gì | Chứa cái gì |
|---|---|---|
| `~/.awog/settings.json` | **user** — đi theo người dùng trên máy này | Mọi preference **có chức năng** hoặc mà người dùng mong còn nguyên sau khi cài lại |
| `{project}/.awog/settings.json` | **project** — đi theo repo, commit được | Phần dự án muốn ghi đè cho mọi thành viên |
| `localStorage` | **local** — theo máy + theo renderer, không bao giờ đồng bộ | Trạng thái xem tạm thời + **bản cache** của tầng user để vẽ khung hình đầu tiên |

**Tiêu chí quyết định** (áp cho từng field, không phải từng màn hình):

1. **Engine hoặc main process có đọc nó không?** Có ⇒ `settings.json`. Setting mà sidecar/Electron không thấy thì nó chỉ là một cái công tắc trang trí.
2. **Người dùng có mong nó còn sau khi cài lại máy/app không?** Có ⇒ `settings.json`.
3. **Con số này có ý nghĩa trên máy khác không?** Không (chiều rộng panel, toạ độ cửa sổ, đường dẫn tuyệt đối) ⇒ `localStorage`.
4. **Nó có đổi liên tục theo thao tác không?** (tab đang mở, ô đang chọn, chuỗi tìm kiếm) ⇒ `localStorage`, đừng bắt đĩa chịu.

Áp vào code hiện tại (`stores/settings.ts`):

- **Synced (`settings.json`)** — `defaults`, `git`, `sessions`, `quota`, `autoUpdate`, `appearance`, `pet`, `githubAccount`, `githubAutoFetchMs`, `githubNotify`, `notifications`, `translate`, `context`, `keymap`, `statusline`. Ngoài ra `modelPricing` + `monacoPreviewTheme` đã ghi thẳng vào file này từ trước.
- **Local-only (`localStorage`)** — `workspacePath` (luôn suy lại từ `app:info`) và `workspacePanel` (dock + chiều rộng/cao — hình học theo màn hình).
- **Không nằm ở cả hai** — API key / token: chỉ ở `credentials.json` + OS keychain (bất biến an ninh #1). `settings.json` **không bao giờ** chứa secret.

Ngoài store này, các state UI thoáng qua vẫn ở localStorage như cũ (tab session đang mở, bộ lọc danh sách, preset ghi chú ghim…) — đúng tiêu chí 3–4, không cần chuyển.

### Thứ tự ưu tiên (precedence)

```
mặc định trong code  ←  user (~/.awog/settings.json)  ←  project ({project}/.awog/settings.json)
```

Phải nhất là **project**. Merge sâu **đúng hai cấp**: `slice` và `slice.field`.

- Cả hai tầng cùng có `git` (object) ⇒ trộn theo từng field, field của project thắng.
- Giá trị không phải object (string/number/array) ⇒ project thay thế nguyên giá trị.
- Không đi sâu hơn 2 cấp: dưới nữa là mảng (`projectIds`, `models`) mà trộn mảng thì luôn phải đoán ý.

`settings.resolve` trả về kèm **bản đồ nguồn** `origin`, khoá theo `'git'` hoặc `'git.autoFetchIntervalMs'`, giá trị `'user' | 'project'`. UI hỏi `settings.originOf(path)`; không có trong bản đồ ⇒ `'default'` (đang chạy mặc định của code). Dòng trạng thái tuỳ biến là consumer đầu tiên: popover của nó nói rõ "Đang dùng mẫu của bạn" hay "Dự án này đang ghi đè" và có nút bỏ ghi đè.

**Keymap cố ý chỉ có tầng user.** Phím tắt là thói quen của ngón tay người dùng; một repo không có quyền đổi phím tắt của người mở nó.

### RPC

| Method | Params | Trả về |
|---|---|---|
| `settings.get` | *(không có)* hoặc `{ scope?, projectId? }` | Blob **thô** của đúng một tầng. Không params ⇒ tầng user — mặc định này là **hợp đồng**: Remote Gateway gọi `settings.get` với `null`. |
| `settings.resolve` | `{ projectId? }` | `{ user, project, effective, origin }` |
| `settings.set` | `{ patch, scope?, projectId? }` | Blob của tầng vừa ghi (`scope` mặc định `'user'`) |
| `settings.unset` | `{ paths, scope?, projectId? }` | Blob sau khi xoá; `paths` nhận `'statusline'` hoặc `'git.autoFetchIntervalMs'` |

Ghi là read-modify-write, **nối chuỗi theo từng file** nên hai lệnh set song song không đè nhau; ghi qua file tạm + `rename` (atomic) + `chmod 600`. Đường dẫn tầng project **không bao giờ** lấy từ payload UI mà suy từ `projects.json` (`loadProject(projectId).path`) — bất biến an ninh #2/#3.

### Vòng đời trong renderer

1. Boot: `loadPersisted()` đọc localStorage **đồng bộ** để khung hình đầu tiên không nháy giá trị mặc định.
2. `hydrateFromSidecar()` (đã gọi sẵn ở `layouts/default.vue`) kéo theo `hydrateSettings()` — chạy **một lần** mỗi phiên app: đọc `settings.get`, đắp lên các slice, rồi **đẩy nguyên snapshot ngược lại**.
3. Mỗi thay đổi: ghi localStorage ngay + đẩy `settings.set` sau **500 ms** debounce (kéo slider/kéo mép panel gộp thành một lần ghi). Trùng nội dung lần trước ⇒ bỏ qua.
4. Không có sidecar (browser-dev): localStorage là nơi lưu duy nhất, mọi push là no-op.

### Migrate không mất cấu hình

- Chiều duy nhất: **localStorage → settings.json**. Cú đẩy snapshot đầy đủ ở bước 2 chính là phép migrate — không có code migrate riêng để bảo trì.
- **Không xoá gì khỏi localStorage.** Bản cũ vẫn còn nguyên nên hạ version app xuống bản trước #43 vẫn thấy đủ cấu hình.
- Thứ tự đắp là `mặc định ← localStorage ← settings.json` nên khi hai bên lệch thì **đĩa thắng**; key chỉ có ở localStorage thì được giữ và đẩy lên đĩa ở cú push đầu tiên.
- `settings.set` merge theo top-level key, nên các key có sẵn trong `settings.json` mà store không quản (`modelPricing`, `monacoPreviewTheme`) **không bị đụng**.
- Có log: `[settings] migrating preferences from localStorage → settings.json` (chỉ in khi file đĩa chưa có key nào của store mà localStorage thì có) và `[keymap] migrating bindings from localStorage → settings.json`.
- Keymap: key cũ `awog-keymap` chỉ được đọc **một lần** để mồi, khi slice trong store còn rỗng; không xoá.

### Còn lại (follow-up)

- Các pane Settings hiện có (Git / Sessions / Defaults / Context…) chưa hiện huy hiệu tầng. Cơ chế đã sẵn (`settings.originOf`, `settings.setProjectOverride`, `settings.clearProjectOverride`); mỗi pane chỉ cần thêm huy hiệu + nút "bỏ ghi đè" — làm ở task của chủ sở hữu từng file.
- `composables/useModelPricing.ts` gọi `settings.set` **sai hình dạng** (`{ modelPricing }` thay vì `{ patch: { modelPricing } }`) nên override giá đang không được lưu. Lỗi có từ trước #43, đã ghi nhận, chưa sửa (ngoài phạm vi).

## Bảo mật

- API key encrypt qua OS keychain.
- Test button gọi endpoint xác thực của provider, không lưu response.
- Connector OAuth token cũng lưu qua keychain.

## Phụ thuộc

- [agent-builder](./agent-builder.md) — chọn model dùng API key đã cấu hình.
- [context-providers](./context-providers.md) — connector cung cấp data cho provider.

## Câu hỏi mở

- Có nên hỗ trợ multiple workspace và switch giữa chúng?
- Settings export/import (chia sẻ config với teammate)?
- Notification preference fine-grained (chỉ Failed, chỉ Approval, …)?
