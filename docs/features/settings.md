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

## Lưu trữ dữ liệu

`workspace/settings.json` (loại trừ khỏi Git qua `.gitignore` để tránh leak API key).

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
