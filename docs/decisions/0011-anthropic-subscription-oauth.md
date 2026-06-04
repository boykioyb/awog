# 0011 — Anthropic Claude Pro/Max OAuth subscription (trước API key)

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-27
- **Người quyết định:** Tech Lead

## Bối cảnh

AWOG cần một cách để gọi `POST /v1/messages` của Anthropic mà:

1. Không bắt user signup Anthropic Console + nạp credit (rào cản onboarding).
2. Tận dụng được quota Pro / Max mà nhiều user (và dev của dự án) đã trả phí hằng tháng.
3. Tương thích invariant security #1: API key / token không rời sidecar.

Hai phương án chính:

- **API key Console** — chuẩn, tài liệu hoá đầy đủ. Nhưng cần signup + billing, user Pro **không** dùng được.
- **OAuth Claude Pro/Max** — sinh token Bearer sử dụng quota subscription. Endpoint không có trong tài liệu công khai; phát hiện qua reverse-engineering Anthropic CLI / craft-agents-oss.

M0 (ngày 2026-05-27) đã verify thực nghiệm rằng OAuth flow hoạt động ổn định với một số quirk không có trong OAuth 2.1 / PKCE spec.

## Quyết định

M7 implement **Claude Pro/Max OAuth subscription** làm phương thức auth duy nhất cho Anthropic. API key Console là roadmap (`authMode: 'api-key'` đã reserve trong type — xem [models-and-accounts.md](../features/models-and-accounts.md)).

Constants verified (M0 — 2026-05-27):

```ts
const AUTH_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const SCOPES = 'org:create_api_key user:profile user:inference'
```

### Findings (không có trong OAuth spec)

1. **`User-Agent: claude-cli/1.0.0 (external, cli)`** — bắt buộc ở *mọi* request đến `TOKEN_URL`. Thiếu header này → endpoint trả `429 Too Many Requests` ngay từ request đầu, kể cả khi rate-limit chưa bị chạm.
2. **`state` trong body token exchange** — OAuth 2.1 chỉ yêu cầu `state` ở authorize redirect. Anthropic *cũng* validate `state` trong body của `POST /v1/oauth/token` (cả grant_type `authorization_code` lẫn `refresh_token` đầu tiên). Thiếu → 400.
3. **`anthropic-beta: oauth-2025-04-20`** — bắt buộc ở `POST /v1/messages` khi `Authorization: Bearer <oauth_access_token>`. Endpoint vẫn nhận `anthropic-version: 2023-06-01` như request thường, nhưng phải có beta header để route logic dùng OAuth principal thay vì API key principal.
4. **Refresh trả `refresh_token` mới** — mỗi refresh response trả về **cả** `access_token` **và** `refresh_token` mới. Phải overwrite cả 2 trong storage; nếu chỉ cập nhật `access_token` thì lần refresh kế tiếp sẽ fail vì `refresh_token` cũ đã bị revoke.

## Phương án đã cân nhắc

- **Chỉ API key (Console-only)** — Cleaner, hoàn toàn tài liệu. Loại bỏ vì: (1) user phải signup + billing tách rời subscription Pro/Max → rào cản UX lớn nhất, (2) dev cũng phải nạp credit để test → tốn ngân sách dự án, (3) đi ngược "1-click to value" của AWOG.
- **OAuth + API key song song M0** — Cho user chọn auth mode ngay từ đầu. Loại bỏ vì gấp 2 effort + 2 bề mặt test ở giai đoạn cần verify giả thuyết product, trong khi API key có thể bolt-on sau (cùng `Account` entity, khác `authMode`).
- **Không support Anthropic, chỉ OpenAI / Google** — Loại bỏ vì Claude là model chính cho coding agent workload của AWOG; bỏ Claude tương đương bỏ MVP.

## Hệ quả

- **Tích cực:**
  - **Onboarding $0**: user có Pro/Max sẵn sign-in 3 click, không nạp credit.
  - Dev dùng Pro cá nhân để test → giảm chi phí dự án, không phải share API key.
  - Subscription quota cao hơn nhiều so với free tier API → đủ chạy task thật trong development.
  - Tương thích invariant security #1 vì token vẫn nằm trong sidecar; UI chỉ thấy `AccountSafe`.
- **Tiêu cực / Trade-off:**
  - **Phụ thuộc endpoint undocumented** — Anthropic có thể đổi `CLIENT_ID`, `TOKEN_URL`, header requirement, scope mà không thông báo. M0 verify date được ghi lại để khi flow break biết "đã hoạt động đến ngày nào".
  - **Không SLA** từ Anthropic cho endpoint này — về lý thuyết có thể bị tắt bất kỳ lúc nào. Mitigation: API key fallback ([models-and-accounts.md](../features/models-and-accounts.md#todo-post-m7)) cần triển khai trước khi có nhiều user.
  - **Vi phạm tiềm tàng ToS**: việc dùng subscription qua API có thể không được Anthropic chính thức ủng hộ. Hiện tại không có động thái block, nhưng ghi nhận rủi ro.
  - **Quirk khó debug**: lỗi 429/400 do thiếu header rất khó chẩn đoán nếu không biết trước. Code có comment kèm ADR reference; logger sidecar log full header (đã mask token) để dễ truy vết.
- **Risk mitigation:**
  - [ADR 0010](./0010-pause-on-quota-for-connection-switch.md) — khi Pro/Max hết quota, pause task để user switch account thay vì fail.
  - M0 verify date được ghi rõ trong header ADR — định kỳ smoke-test (ví dụ weekly) để phát hiện sớm regression.
  - API key flow là backlog post-M7 ưu tiên cao; khi endpoint OAuth break thì có alternative.
  - Constants tập trung ở [`apps/desktop/sidecar/src/auth/`](../../apps/desktop/sidecar/src/auth/) (1 nơi sửa) — không rải khắp codebase.
- **Việc cần làm tiếp:**
  - Smoke test định kỳ: sign-in + 1-token ping `/v1/messages` (CI có thể chạy với fixture).
  - Implement API key auth mode (cùng `Account` entity, `authMode: 'api-key'`).
  - Quan sát error rate `AUTH_EXPIRED` và 401 sau refresh — nếu tăng đột biến → cảnh báo ADR cần update.

## Postscript — M7 SDK Migration (2026-05)

Tại M7, sidecar nâng cấp từ raw `fetch('/v1/messages')` sang `@anthropic-ai/claude-agent-sdk` `query()`. Thay đổi:

- **Token delivery:** Sidecar vẫn giữ PKCE flow cũ + credentials.json ở ~/.awog. Khi `query()` gọi, sidecar pass access token via `CLAUDE_CODE_OAUTH_TOKEN` env (SDK tự read khi không có credentials file riêng).
- **Token management:** token-manager (refresh, expiry check) không đổi. Pre-refresh 5 phút trước expiry. Mỗi refresh response overwrite cả token + refresh token (Anthropic quirk).
- **Tool-use:** SDK nội tích 15 tools (Read/Write/Edit/Bash/Glob/…). Sidecar không cần custom tool registry.
- **Permission flow:** SDK emit `permission_request` event khi `permissionMode: 'default'` + `canUseTool` callback. Sidecar map tới `session.permission-request` notification.
- **Impact security invariant:** Không đổi — raw token vẫn không rời sidecar, chỉ exist trong RAM + file (chmod 600).
- **API contract stability:** Endpoint + headers + scope không đổi (verify date 2026-05-27 vẫn hiệu lực).

Legacy raw-fetch path giữ lại ở `apps/desktop/sidecar/src.legacy/` để reference/fallback.

## Tham chiếu

- [0001](./0001-local-first-storage.md) — local-first storage (credentials trên filesystem).
- [0008](./0008-stdio-ipc-for-sidecar.md) — IPC boundary, raw token không qua webview.
- [0010](./0010-pause-on-quota-for-connection-switch.md) — handling khi subscription quota cạn.
- [../features/models-and-accounts.md](../features/models-and-accounts.md) — feature spec đầy đủ.
- [../features/sessions.md](../features/sessions.md) — feature consume `/v1/messages` via SDK.
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #1 API key isolation.
