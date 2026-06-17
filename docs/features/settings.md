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

## Lưu trữ dữ liệu / Persistence (ADR 0045)

App settings (trừ accounts/API key) persist vào **`~/.awog/settings.json`** —
đọc/ghi **qua sidecar** (UI không `import fs`, invariant #4). localStorage giữ vai
trò **cache đọc-nhanh** (chống FOUC theme/appearance); **file là source of truth**.

**Scope file** (toàn bộ trừ accounts): `themeMode`, `appearance`, `defaults`,
`git`, `autoUpdate`, `composer`, `quotaWarning`, `workspacePath`, `autoApprove`,
`notificationsEnabled`. **Accounts / API key KHÔNG vào đây** — vẫn ở
`credentials.json` + OS keychain (invariant #1).

**RPC (sidecar):**

| Method | Vai trò |
|---|---|
| `settings.get` | Trả object JSON đã lưu (hoặc `{}` nếu chưa có file). Sidecar **dumb** — không coerce/áp default; UI sở hữu schema. |
| `settings.set({ patch })` | Shallow-merge `patch` (mỗi nhóm = 1 top-level key) → ghi atomic (`.tmp` → `chmod 600` → `rename`), serialize qua mutex. Trả object đã merge. |

**Đồng bộ (`useSettingsSync`):**

1. **Boot** — seed store từ localStorage (sync, không FOUC) → `settings.get` (async).
   File có data → coerce + distribute vào store (cascade ra localStorage + DOM qua
   watcher sẵn có) ⇒ **file thắng** khi user sửa tay. File rỗng → seed từ snapshot.
2. **Ghi** — một deep-watch trên snapshot → debounce 400ms → `settings.set`.

> File là input **L1** (user có thể sửa tay) → mỗi slice coerce ở biên trước khi
> đưa vào store. Sidecar/Task có thể đọc thẳng `settings.json` (vd git auto-commit
> per-phase đang deferred).

Sidecar: [`settings/store.ts`](../../apps/desktop/sidecar/src/settings/store.ts),
[`methods/settings.get.ts`](../../apps/desktop/sidecar/src/methods/settings.get.ts),
[`methods/settings.set.ts`](../../apps/desktop/sidecar/src/methods/settings.set.ts).
UI: [`composables/useSettingsSync.ts`](../../apps/desktop/ui/composables/useSettingsSync.ts)
+ các `coerce*` trong từng `useXxxSettings`.

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
