# Provider Model Catalog (model theo provider + fetch)

> Trạng thái: **Đang triển khai** (Pha 1). Thay mô hình "model curated theo account" bằng **model theo provider**, gom cấu hình về 1 nơi, thêm nút **Fetch** cập nhật list model từ live API + Pi catalog.

## Vấn đề

Hiện tại danh sách model model bị **phân mảnh 3 nơi khác nhau**:

1. **Catalog code** (`ui-next` hardcode): `agent-display.ts` `PROVIDER_MODELS`, `useSessionsData.ts` `PROVIDER_MODELS`/`MODEL_DISPLAY`, `SettingsAccountEditDialog.vue` `MODEL_CATALOG`, `context-window.ts`, `sidecar/pricing/catalog.ts`, `models-map.ts` — mỗi lần ra model mới phải sửa tay nhiều file.
2. **Danh sách model của account** (`credentials.json` → `account.models`): session model chip đọc từ đây → mỗi account có list riêng, **3 tài khoản Anthropic curate cứng `[opus-5, sonnet-5, haiku-4-5]`** dù chung 1 provider.
3. **Pi SDK catalog** (`getModels(provider)`): nguồn runtime thật, nhưng chỉ cập nhật khi bump Pi.

Hệ quả: session chip (đọc `account.models`) khác Settings picker (đọc catalog code); ra model mới (Opus 5) phải sửa code + re-curate từng account.

## Quyết định

- **Model thuộc PROVIDER, không thuộc account.** 3 tài khoản Anthropic dùng chung 1 danh sách model Anthropic. `account.models` chỉ còn ý nghĩa cho **custom endpoint** (endpoint tự khai model riêng).
- **1 nguồn duy nhất:** sidecar RPC `models.list(provider)` trả danh sách model gộp từ **Pi catalog + live provider API + AWOG extras**. UI đọc từ đây; bỏ hardcode `PROVIDER_MODELS`.
- **Fetch = Live API + Pi (union):** nút "Cập nhật model" gọi `GET /v1/models` của provider (bằng credential account) **union** Pi catalog (metadata: context-window/cost/reasoning). Model mới hơn Pi (vd Opus 5) lấy id từ live API; runtime resolve qua clone-fallback đã có (`model-resolver.ts`).
- **1 nơi cấu hình:** Settings → Models & Keys tách 2 phần: (a) **Accounts** (chỉ credential), (b) **Models (per provider)** — list + bật/tắt + nút Fetch. Bỏ per-account ModelListEditor cho built-in provider.

## Kiến trúc

```
Pi getModels(provider) ─┐
Live GET /v1/models ────┼─► sidecar models.list(provider,accountId?) ─► useProviderModels (ui-next)
AWOG extras (opus-5…) ──┘                                                    │
                                                          ├─ session model chip
                                                          ├─ Settings default picker
                                                          ├─ agent editor / project defaults
                                                          └─ Settings → Models (list + fetch + toggle)
```

- **Runtime resolve** vẫn qua `model-resolver.ts` (Pi getModel + clone-fallback cho id Pi chưa biết). Không đổi.
- **Persist:** subset "enabled" per provider + snapshot fetched-list + fetchedAt → `~/.awog/provider-models.json` (sidecar) hoặc settings store. (Chốt ở Pha 2.)

## Merge rule (models.list)

1. Base = `getModels(provider)` (id + name + contextWindow + maxTokens + reasoning + input + cost).
2. Union live `GET /v1/models` (id + display_name). Id chỉ có ở live API → metadata tối thiểu (name = display_name/id; context-window kế thừa từ model cùng tier nếu suy được, else để trống).
3. AWOG extras: model AWOG-internal (vd `claude-opus-5-1m`) + model mới hơn Pi (opus-5/sonnet-5) — nếu đã có trong live API thì bỏ qua; nếu chưa (offline) thì bổ sung.
4. Dedup theo id; đánh dấu `source: 'pi' | 'api' | 'both'`.
5. Custom endpoint: KHÔNG fetch (SSRF — chỉ allowlist host provider chính chủ). Giữ `account.models`.

## Pha

- **Pha 1 (foundation):** sidecar `models.list` (Pi + extras + live API Anthropic). typecheck.
- **Pha 2 (UI core):** `useProviderModels` store; rewire session chip + Settings picker + agent editor + project defaults đọc provider models; bỏ `account.models` khỏi session path (built-in).
- **Pha 3 (Settings UX):** tách "Models (per provider)" section + nút Fetch + toggle; account editor bỏ ModelListEditor built-in; live API OpenAI/Google.
- **Pha 4:** persist enabled subset + migrate `account.models` cũ; dọn hardcode `PROVIDER_MODELS`/`MODEL_CATALOG`; cập nhật pricing/context tự động từ metadata fetch.

## Bảo mật

- Fetch chỉ tới **host provider chính chủ** (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) — hardcode, không nhận host từ payload UI → không SSRF. Custom endpoint không fetch.
- Credential lấy qua `resolveCredential`, **không** rời sidecar (không log/echo token).
