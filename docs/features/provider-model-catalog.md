# Provider Model Catalog (model theo provider + fetch)

> Trạng thái: **Hoàn tất** (Pha 1–4 ✅). Thay mô hình "model curated theo account" bằng **model theo provider**, gom cấu hình về 1 nơi, thêm nút **Fetch** cập nhật list model từ live API + Pi catalog.

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
- **Persist:** subset "enabled" per provider + snapshot fetched-list + fetchedAt → **localStorage `awog.providerModels.v1`** (xem mục [Persist](#persist) ở Pha 4).

## Merge rule (models.list)

1. Base = `getModels(provider)` (id + name + contextWindow + maxTokens + reasoning + input + cost).
2. Union live `GET /v1/models` (id + display_name). Id chỉ có ở live API → metadata tối thiểu (name = display_name/id; context-window kế thừa từ model cùng tier nếu suy được, else để trống).
3. AWOG extras: model AWOG-internal (vd `claude-opus-5-1m`) + model mới hơn Pi (opus-5/sonnet-5) — nếu đã có trong live API thì bỏ qua; nếu chưa (offline) thì bổ sung.
4. Dedup theo id; đánh dấu `source: 'pi' | 'api' | 'both'`.
5. Custom endpoint: KHÔNG fetch (SSRF — chỉ allowlist host provider chính chủ). Giữ `account.models`.

## Pha

- **Pha 1 (foundation) ✅:** sidecar `models.list` (Pi + extras + live API Anthropic). typecheck.
- **Pha 2 (UI core) ✅:** `composables/useProviderModels.ts` = single source (module-singleton reactive catalog seed bằng bundled default + `load(provider,{live,accountId})` → `models.list` + `shown()` auto-filter `isModernModelId`). Rewire session chip (Pha 2a: `useAccounts.modelsForAccount` → provider catalog, custom endpoint giữ `account.modelIds`), `useSessionsData` (`modelsForProvider`/`modelDisplayName`/`modelIdFromDisplay` delegate — giữ chữ ký sync), `agent-display`, project/translate defaults. Picker vẫn dùng display-name làm value; helper display↔id đọc từ catalog store nên id động round-trip. Chưa auto-load (nút Fetch = Pha 3).
- **Pha 3 (Settings UX) ✅:** section "Available models" (`SettingsProviderModels.vue`) trong Models & Keys — seg chọn provider + list full `all()` + toggle enable/disable (persist localStorage `awog.providerModels.v1`, hydrate merge seed) + nút **Fetch** gọi `models.list {live, accountId active}`. Account editor bỏ ModelListEditor cho built-in (oauth Claude + builtin-key) — chỉ giữ cho **Codex** (openai OAuth, model set riêng) + custom endpoint; bỏ hardcode `MODEL_CATALOG`. project/translate defaults chỉ honor `account.models` khi là custom endpoint (có `baseURL`). Sidecar `models.list` thêm live **OpenAI** (`GET /v1/models`, lọc chat, skip Codex bearer) + **Google** (`/v1beta/models?key=`, lọc `generateContent`).
- **Pha 4 ✅:** `toSafe` (sidecar) **thôi expose `account.models` cho built-in** (chỉ Codex + custom còn giữ) → "models thuộc provider" đúng tới biên API; field cũ trong credentials.json thành dead data vô hại (không mutate file nhạy cảm). `context-window.ts` **derive từ metadata fetch** làm fallback cho id chưa biết (map hardcode vẫn authoritative cho id đã liệt kê — giữ quy ước base-vs-`-1m`). Hardcode catalog UI đã sạch từ Pha 2/3 (chỉ còn hằng default-model đơn lẻ, đúng ý). **Pricing giữ nguyên**: giá không suy được từ `/v1/models` (metadata không có giá) — hệ thống giá đã có sẵn 3 tầng `default → remote (activity.pricing.fetch) → override (Settings modelPricing)`; model fetched-mới chưa có giá → `getEffectivePricing` trả null → caller flag `missingPrices` (graceful), user override tay được.

### Seed mang luôn `contextWindow` — sửa 2026-09-07

`load()` **chỉ** được gọi từ một chỗ (Settings → Models), nên user chưa bao giờ mở panel đó có catalog **không có metadata cửa sổ ngữ cảnh nào cả** — trong khi `providerModelContextWindow()` chính là fallback mà thước đo ngữ cảnh dùng cho mọi provider **trừ** Anthropic (Anthropic có bảng hardcode authoritative riêng trong [context-window.ts](../../apps/desktop/ui-next/utils/context-window.ts) để giữ quy ước base-vs-`-1m`).

Hệ quả: gauge đọc **200k mặc định** cho mọi model OpenAI/Google — GPT-5.5 (272k) hụt 1/4, Gemini 3.5 Flash và GPT-5.5 Pro (~1.05M) hụt **5×**. Cùng mẫu số đó lái auto-compact, nên compact nổ sớm gấp bốn lần.

Nay mỗi dòng SEED mang `contextWindow` lấy **đúng từ metadata pi-ai** (con số mà một lần Fetch sẽ trả về) nên seed và fetch không thể lệch nhau; `gemini-2.0-flash` không có trong catalog pi nên dùng số từ bảng model của Google (1.048.576) và ghi rõ nguồn tại chỗ.

`hydrate()` còn một lỗ liên quan: `persist()` ghi catalog **as-is** nên một lần *toggle* model (không Fetch) cũng tạo cache — cache đó viết trước bản vá này thì không có `contextWindow`, và `JSON.stringify` bỏ `undefined` nên dòng cache "thắng metadata" sẽ **xoá** luôn cửa sổ vừa seed. Sửa: spread seed **nằm dưới** dòng cache (`{ ...seed, ...cached }`) — cache vẫn thắng ở field nó thực sự có, nhưng không xoá được field nó chưa từng mang.

### Persist
Enabled-subset per provider + snapshot catalog fetched + fetchedAt lưu **localStorage** `awog.providerModels.v1` (UI-presentation cache, không phải engine setting — model gửi đi vẫn theo lựa chọn per-session/task). `hydrate()` merge **seed trước** để model mặc định của bản app mới không bị cache cũ che. (Có thể chuyển sang `~/.awog/provider-models.json` sidecar-authoritative sau nếu cần đồng bộ đa thiết bị.)

## Bảo mật

- Fetch chỉ tới **host provider chính chủ** (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) — hardcode, không nhận host từ payload UI → không SSRF. Custom endpoint không fetch.
- Credential lấy qua `resolveCredential`, **không** rời sidecar (không log/echo token).
