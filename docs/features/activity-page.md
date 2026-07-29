# Activity Page — quota/usage thực tế + chi phí theo giá model

> Trang **Activity** riêng (route `/activity`) thống kê token usage thực tế và **chi phí bằng tiền**
> theo giá model, lọc theo khoảng thời gian (1d/7d/30d/90d/all), breakdown theo **account** và theo
> **model**, gộp usage từ cả **Sessions** và **Tasks**, kèm panel **rate-limit thực tế** của provider.
> Khác với tile Activity ở Home (sparkline 24h, token-only): đây là màn phân tích sâu, có cost tally.

- **Trạng thái:** Spec — Ready for TL/PM. Cần TL chốt OQ-1..OQ-6 trước khi PM chia task.
- **Owner:** Business Analyst
- **Ngày:** 2026-06-25
- **Phạm vi:** `apps/desktop/ui-next` (1 trang mới `/activity` + 1 store + 1 composable) + sidecar (2 RPC mới `activity.summary` / `activity.pricing`, 1 module rollup-cache, 1 pricing-catalog bundled, bổ sung persist `accountId` per assistant turn).
- **Liên quan:** [home-dashboard.md](home-dashboard.md) (tile Activity 24h — đừng trùng), [tray-account-usage.md](tray-account-usage.md) (rate-limit per-account — tái dùng), [session-system.md](session-system.md), [task-execution-engine.md](task-execution-engine.md), [workspace-panel.md](workspace-panel.md) (mẫu format), [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md), [ADR 0048](../decisions/0048-session-index-lazy-load.md).

## Bối cảnh

Hiện có **một** tile Activity ở Home (`pages/index.vue`) lấy từ RPC [`dashboard.usage`](../../apps/desktop/sidecar/src/methods/dashboard.usage.ts): chỉ token-only, cửa sổ 24h, 12 bucket 2h, không tiền, không breakdown account/model. Đó là widget liếc nhanh.

Nhu cầu mới: một **trang phân tích** đầy đủ. Nguồn dữ liệu gốc đã có sẵn trong session JSONL:

- Mỗi assistant turn là một [`SessionMessage`](../../apps/desktop/sidecar/src/types/shared.ts) (`shared.ts` dòng 235) với:
  - `at: string` (ISO) — thời điểm; `completedAt?: number` (ms epoch) — ưu tiên dùng (như `collectUsageSince`).
  - `modelUsed?: string` — model thực tế chạy turn (nguồn breakdown by-model).
  - `usage?: { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }` — token 4 nhóm (cache optional, back-compat).
- Account hiện chỉ ở **mức session**: [`SessionSettings.accountId`](../../apps/desktop/sidecar/src/types/shared.ts) (dòng 159, optional). `SessionMessage` **KHÔNG** có `accountId` → breakdown theo account hiện không chính xác nếu session đổi account giữa chừng (cần bổ sung, xem [accountId per-turn](#accountid-per-turn)).
- Hàm tail-read sẵn có: [`collectUsageSince(windowStartMs)`](../../apps/desktop/sidecar/src/sessions/store.ts) (dòng 607) — đọc JSONL newest-first, dừng tại biên cửa sổ, dedupe theo message id, trả `{ at, tokens }[]`. Spec này mở rộng pattern đó (thêm model + accountId + tách 4 nhóm token).

Hai khoảng trống quan trọng cần ghi làm doc-of-record:

1. **Task usage chưa được persist token.** Task run lưu [`TraceNode`](../../apps/desktop/sidecar/src/types/shared.ts) (dòng 675) + [`TaskRun`](../../apps/desktop/sidecar/src/types/shared.ts) (dòng 701): chỉ có `model`, `duration` — **không** token. `node-runner.ts` (dòng 218) nhận `_usage` ở `onAssistantMeta` rồi **bỏ đi**. Muốn gộp Task vào Activity thì sidecar phải bắt đầu persist token per task-turn (xem OQ-2). Cho tới khi đó, by-account/by-model chỉ phủ Sessions.
2. **Không có cost.** Không nơi nào lưu giá model. Cần catalog giá bundled + override Settings.

`account.usage` ([method](../../apps/desktop/sidecar/src/methods/account.usage.ts)) trả **% rate-limit provider** (`UsageEntry[]` với `rateLimitType` `five_hour`/`seven_day`/… + `utilization` 0..1 + `resetsAt`) — KHÔNG có lịch sử token/cost. Đây là **panel độc lập** đặt cạnh cost-tally tự tính, không phải nguồn cost.

## Mục tiêu

- Trang `/activity` cho phép chọn **range** (1d / 7d / 30d / 90d / all) và lọc theo **account** → xem:
  - **Tổng** token (4 nhóm) + **chi phí USD** trong range.
  - **Timeseries** (chart cột/đường theo ngày) token và/hoặc cost.
  - Bảng **by-model**: model, token 4 nhóm, cost, % tổng.
  - Bảng **by-account**: account label, token, cost, % tổng.
  - Danh sách **model thiếu giá** (`missingPrices`) → cost của model đó = 0, có cảnh báo + CTA mở Settings.
- **Cost = token × giá model** (riêng input / output / cache-read / cache-write, USD/1M token), giá hiệu lực = `override(Settings) ?? default(catalog bundled)`.
- Gộp usage **Sessions + Tasks** (Tasks phụ thuộc persist token per task-turn — OQ-2).
- Panel **provider rate-limit** (% cửa sổ 5h / 7d) tái dùng `account.usage`, đặt cạnh cost tally.
- **Range dài (30/90/all) phải nhanh**: rollup cache theo ngày xuống đĩa; ngày quá khứ bất biến, chỉ "hôm nay" tính lại. KHÔNG scan toàn JSONL multi-GB mỗi request.

## Non-goals

- **Không** dự báo / billing tích hợp thanh toán / export hoá đơn (MVP). Cost là **ước lượng** theo catalog, không phải con số nhà cung cấp tính.
- **Không** thay/đụng tile Activity ở Home (`dashboard.usage` giữ nguyên — token-only 24h). Hai surface tách biệt.
- **Không** sửa cơ chế rate-limit của `account.usage` (chỉ tái dùng panel hiển thị).
- **Không** thêm chart library nặng nếu tránh được — ưu tiên render bằng SVG/`<i style>` như prototype, hoặc lib nhỏ đã có (OQ-5).
- **Không** persist text message / token API key vào rollup cache (invariant #1 — chỉ số liệu).
- **Không** lưu giá model vào git theo per-user (override Settings là local; catalog default bundled là hằng repo).

## Personas

- **Solo Builder / cost-conscious operator** — chạy nhiều session/task, dùng nhiều account (Pro/Max OAuth + API key). Cần biết: tuần này đốt bao nhiêu tiền, model nào đắt nhất, account nào sắp chạm rate-limit, có turn nào dùng model chưa khai giá không.
- **Team lead (tương lai)** — so sánh chi phí theo agent/model để tinh chỉnh workflow. MVP chỉ cần by-model + by-account; by-agent là mở rộng (OQ-6).

## User flow chính

1. Mở `/activity` (từ NavRail). Mặc định **range = 7d**, account = **tất cả**.
2. Trang hydrate: gọi `activity.summary({ range: '7d' })` + `activity.pricing()` + `account.usage` (cho panel rate-limit, account đang active của mỗi provider).
3. Người dùng thấy: tổng token + cost USD, chart timeseries (`byDay`), bảng by-model, bảng by-account, panel rate-limit provider.
4. **Đổi range** (1d/7d/30d/90d/all) → re-fetch `activity.summary({ range })` (pricing không đổi → có thể giữ cache client). Chart + bảng + tổng cập nhật.
5. **Lọc account** → chọn 1 account từ dropdown (`AppSelect`, [MEMORY: use_appselect_for_dropdowns]) → `activity.summary({ range, accountId })`. By-account thu về 1 hàng (account đó), by-model + chart + tổng giới hạn theo account.
6. Nếu có **model thiếu giá** (`missingPrices` không rỗng) → banner cảnh báo liệt kê model, CTA "Khai giá ở Settings" → `navigateTo('/settings')` tab Models/Pricing (OQ-4).
7. Panel rate-limit hiển thị % cửa sổ 5h / 7d theo provider/account (từ `account.usage`); reset time tương đối. Read-only.

## Kiến trúc đã chốt (doc-of-record)

### Giá model (pricing catalog)

- **Default catalog bundled trong repo** — một module hằng (vd `apps/desktop/sidecar/src/pricing/catalog.ts`), map `modelId → { inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok }` (USD / 1.000.000 token), kèm `provider` để nhóm. Đây là tri thức L3 (hardcoded constant) — cập nhật bằng PR khi giá đổi.
- **Override ở Settings** — người dùng có thể ghi đè/bổ sung giá qua `settings.set('modelPricing', { [modelId]: { ... } })`. Lưu local (settings store), KHÔNG vào git. Dùng cho model custom-endpoint / model mới chưa có trong catalog / giá thương lượng riêng.
- **Giá hiệu lực** = `override[modelId] ?? default[modelId]`. Nếu cả hai không có → model vào `missingPrices`, cost phần đó = 0 (KHÔNG đoán giá).
- `activity.pricing()` trả **catalog hiệu lực** (đã merge override) để UI hiển thị + biết model nào thiếu giá.

### Rollup cache theo ngày

- Sidecar tính usage **theo ngày (local day)** rồi cache xuống đĩa: `~/.awog/usage/daily/<YYYY-MM-DD>.json`.
  - Mỗi file = aggregate **một ngày**: `{ date, totals{4 token groups + turns}, byModel: { [modelId]: {…} }, byAccount: { [accountId]: {…} } }` (token thô, **chưa** nhân giá — cost tính ở thời điểm query để giá đổi không cần rebuild cache).
  - **Ngày quá khứ bất biến**: file của ngày đã đóng (`< todayStart`) chỉ tính **một lần**, sau đó đọc lại từ cache. Range dài = đọc N file JSON nhỏ + cộng dồn → nhanh, không chạm JSONL.
  - **Hôm nay** (`>= todayStart`) tính lại mỗi request (tail-read JSONL từ `todayStart`, bounded) vì còn đang ghi tiếp.
  - **`all`**: đọc mọi file daily đã cache + ngày hôm nay tính lại. Cận biên dưới = ngày đầu tiên có dữ liệu (lưu `~/.awog/usage/meta.json` `{ firstDay, lastBuiltDay, version }`).
- **Invalidation / rebuild**: cache schema version trong `meta.json`; bump version → rebuild lazy theo ngày được hỏi. Một ngày chỉ rebuild khi (a) chưa có file, hoặc (b) là "hôm nay". KHÔNG rebuild ngày cũ trừ khi version đổi hoặc file hỏng.
- **Guardrail performance (bắt buộc):**
  - KHÔNG `JSON.parse` toàn transcript vào RAM. Hôm nay tail-read newest-first, dừng khi `at < todayStart` (mirror [`collectUsageSince`](../../apps/desktop/sidecar/src/sessions/store.ts) + [MEMORY: session_jsonl_byte_minimal_persist] — history có thể tới 1.2GB).
  - Lọc session active qua `sessions/index.json` ([ADR 0048](../decisions/0048-session-index-lazy-load.md)) trước khi mở file — chỉ chạm session có `updatedAt >= todayStart` khi tính hôm nay.
  - Cap số dòng/file + cap số session quét để chặn worst-case.
  - **Build ngày cũ (lần đầu / rebuild)**: cũng tail-read theo session active của ngày đó; chấp nhận lần build đầu chậm hơn (one-off), sau đó cache. Cận trên thời gian build mỗi ngày phải bounded (cap dòng).

### accountId per-turn

- **Vấn đề:** `SessionMessage` không có `accountId`; account ở `SessionSettings.accountId` (mức session). Một session có thể đổi account giữa chừng (settings mutate) → by-account sai cho turn cũ.
- **Quyết định:** Bổ sung **persist `accountId` mỗi assistant turn** khi append `message.appended` ([`sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) dòng ~623, nơi đã gán `modelUsed` + `usage`). Thêm field optional `accountId?: string` vào `SessionMessage` (đổi type, back-compat: turn legacy thiếu field).
- **Fallback:** turn legacy không có `message.accountId` → dùng `session.settings.accountId` (đọc từ index/summary). Nếu cũng không có → gom vào nhóm account `"unknown"` (KHÔNG drop, để tổng khớp).
- Field này CHỈ là id (L3 reference), KHÔNG phải token/secret — an toàn persist (invariant #1).

## Contract RPC

### `activity.pricing()`

Trả catalog giá hiệu lực (merge default + override). Không tham số.

```ts
type ModelPrice = {
  // USD per 1,000,000 tokens, riêng từng nhóm.
  inputPerMTok: number
  outputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
}

type ActivityPricingResult = {
  // modelId → giá hiệu lực (override ?? default). Chỉ chứa model CÓ giá.
  prices: Record<string, ModelPrice & { provider?: string; source: 'default' | 'override' }>
  // Phiên bản catalog bundled (để UI badge "giá cập nhật <ngày>"). Tùy chọn.
  catalogVersion?: string
}
```

- `source` = `'override'` nếu Settings ghi đè model đó, else `'default'`.
- Model có trong default nhưng bị Settings override → `source: 'override'`, giá là giá override.

### `activity.summary({ range, accountId? })`

```ts
type ActivityRange = '1d' | '7d' | '30d' | '90d' | 'all'

type ActivitySummaryParams = {
  range: ActivityRange
  // Lọc 1 account (id trong credentials.json). Bỏ trống = mọi account.
  accountId?: string
  // Mốc "now" (ms epoch) cho test/determinism. Mặc định Date.now() ở sidecar.
  now?: number
}
```

```ts
type ActivityTokenTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  // = input + output + cacheRead + cacheWrite (cache buckets ĐƯỢC cộng — mirror
  // quyết định context-window của session, history nằm ở cacheRead).
  totalTokens: number
  // Chi phí USD ước lượng = Σ(token nhóm × giá nhóm / 1e6). Chỉ tính cho model
  // CÓ giá hiệu lực; model thiếu giá đóng góp 0 (và xuất hiện ở missingPrices).
  costUsd: number
  // Số assistant turn (message có usage) gộp vào tổng này.
  turns: number
}

type ActivityModelRow = {
  modelId: string
  provider?: string
  // null khi model không có giá hiệu lực (→ costUsd của row = 0, có ở missingPrices).
  price: ModelPrice | null
  totals: ActivityTokenTotals
}

type ActivityAccountRow = {
  // 'unknown' cho turn không xác định được account (legacy + thiếu settings).
  accountId: string
  // Label thân thiện (AccountSafe.label) nếu account còn tồn tại; else accountId
  // hoặc "Đã xoá" cho account không còn trong credentials.json (OQ-3).
  label: string
  provider?: string
  exists: boolean
  totals: ActivityTokenTotals
}

type ActivityDayRow = {
  // YYYY-MM-DD (local day) — trục X của timeseries.
  date: string
  totals: ActivityTokenTotals
}

type ActivitySummaryResult = {
  range: ActivityRange
  // Biên cửa sổ (ms epoch), inclusive from / exclusive-or-now to. Cho UI hiển thị.
  from: number
  to: number
  // Tổng toàn range (đã áp filter accountId nếu có).
  totals: ActivityTokenTotals
  // Sort desc theo totalTokens (hoặc costUsd — OQ-5).
  byModel: ActivityModelRow[]
  byAccount: ActivityAccountRow[]
  // Sort asc theo date — trục thời gian cho chart.
  byDay: ActivityDayRow[]
  // modelId xuất hiện trong range NHƯNG không có giá hiệu lực. UI cảnh báo +
  // CTA khai giá. Cost các model này = 0 trong mọi tổng/row.
  missingPrices: string[]
}
```

### Ngữ nghĩa từng field

- **token gộp 4 nhóm** y hệt `dashboard.usage` / context-window: `total = input + output + cacheRead + cacheWrite`. Cache PHẢI cộng ([MEMORY: usage_cache_tokens]).
- **`from`/`to`**: `range` ánh xạ sang số ngày (`1d`→ hôm nay, `7d`→ 7 ngày tính cả hôm nay, `30d`, `90d`, `all`→ từ `meta.firstDay`). Cắt theo **local day boundary** (như `dashboard.usage` dùng `setHours(0,0,0,0)`). `to = now`.
- **`byDay`** = một hàng / ngày trong range (kể cả ngày 0 token → row totals=0 để chart liền mạch — OQ-5 có thể bỏ ngày rỗng).
- **`byModel`** key theo `SessionMessage.modelUsed` (Task: model từ trace/persist — OQ-2). Turn thiếu `modelUsed` → gom `modelId: 'unknown'`, `price: null`, không vào `missingPrices` (vì không phải "model có tên nhưng thiếu giá"; OQ-4 có thể tách).
- **`byAccount`** key theo `message.accountId` (mới) ?? `session.settings.accountId` ?? `'unknown'`.
- **`costUsd`** tính **tại query-time** từ token thô (rollup) × giá hiệu lực — đổi giá KHÔNG cần rebuild rollup.
- **`missingPrices`** = các `modelId` (có tên thật) xuất hiện trong range mà `pricing.prices[modelId]` không có.

### `bySession[]` + drill-down chi phí theo ngày

> Bảng by-session được thêm sau bản spec gốc ở trên; shape thực tế là **field
> phẳng** (`totalTokens`, `costUsd`, `turns`… không bọc trong `totals`) — đọc
> [`ActivityBySession`](../../apps/desktop/sidecar/src/types/shared.ts) làm chuẩn.

Mỗi hàng session mang thêm `byDay` để UI mở rộng xem chi phí **từng ngày** của
riêng phiên đó (tương tự tab Cost trong session):

```ts
type ActivitySessionDay = {
  date: string // local YYYY-MM-DD, cùng day key với rollup
  totalTokens: number
  costUsd: number
  turns: number
}
```

- **Chỉ ngày có hoạt động.** Ngày phiên không chạy thì vắng mặt, không phải row 0
  (khác `byDay` cấp trang — cái đó cần liền mạch để vẽ chart).
- **Bất biến cộng dồn:** `Σ byDay[].{costUsd, totalTokens, turns}` = đúng field
  của hàng cha. Cùng một `lineCost` per-turn được cộng vào cả hai, nên filter
  account/dự án áp cho hàng cha cũng áp cho ngày.
- **Tính lại giá tại query-time** như phần còn lại của trang — **khác** với
  `sessions.costBreakdown` (tab Cost trong session) vốn cộng `usage.costUsd` đã
  persist lúc chạy. Hai con số có thể lệch khi giá catalog đổi; **không trộn hai
  nguồn trong cùng một view**.
- Nguồn quét là `collectSessionTurnsSince` (tail-first theo cửa sổ), KHÔNG dùng
  rollup ngày đã freeze — rollup cố tình bỏ session id.

### Provider rate-limit panel — tái dùng `account.usage`

- UI gọi [`account.usage({ provider, accountId?, force? })`](../../apps/desktop/sidecar/src/methods/account.usage.ts) cho provider/account đang quan tâm.
- Response: `{ profile, usage: UsageEntry[], cachedAt, accountId }`. `UsageEntry = { rateLimitType: 'five_hour'|'seven_day'|'seven_day_opus'|'seven_day_sonnet'|'overage', utilization: 0..1, resetsAt?, status }` ([providers/anthropic/usage.ts](../../apps/desktop/sidecar/src/providers/anthropic/usage.ts)).
- UI render: progress bar per bucket (`utilization * 100`%), nhãn reset tương đối (`resetsAt`), màu cảnh báo khi `status !== 'allowed'`. **Read-only**, đã có cache 60s ở sidecar.
- OpenAI Codex: `usage` từ header snapshot; API-key account: `usage: []` → panel hiện "không khả dụng". Anthropic API-key (non-oauth): cũng `[]`.
- **Đây là số liệu provider thực tế**, đặt CẠNH cost-tally tự tính (catalog) — KHÔNG trộn, nhãn rõ "rate-limit nhà cung cấp" vs "chi phí ước lượng (theo giá khai báo)".

## Công thức cost

Cho mỗi nhóm token của một (model, ngày, account):

```
costUsd(group) = tokens(group) × price(model, group) / 1_000_000
```

```
costUsd(model) = costInput + costOutput + costCacheRead + costCacheWrite
costUsd(total) = Σ costUsd(model)   // chỉ model có giá; model thiếu giá đóng góp 0
```

- Làm tròn hiển thị ở UI (vd 4 chữ số thập phân khi < $1, 2 chữ số khi ≥ $1) — sidecar trả số thực, KHÔNG tự làm tròn để tránh sai số cộng dồn.
- Model thiếu giá: 4 nhóm cost = 0, vào `missingPrices`, token vẫn cộng vào `totalTokens` (để token total khớp), cost không tính.

## Nguồn dữ liệu

| Nguồn | Field dùng | Ghi chú |
|---|---|---|
| Session JSONL (`message.appended`) | `SessionMessage.at`/`completedAt`, `modelUsed`, `usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}`, `accountId` (mới) | Tail-read qua pattern `collectUsageSince`; dedupe theo message id |
| `sessions/index.json` | `SessionSummary.updatedAt`, `settings.accountId` | Lọc session active + fallback account ([ADR 0048](../decisions/0048-session-index-lazy-load.md)) |
| Task JSONL trace | model + token per task-turn | **Cần bổ sung persist token** (OQ-2) — hiện chưa có |
| Rollup cache `~/.awog/usage/daily/<date>.json` + `meta.json` | token thô per ngày/model/account | Ngày cũ bất biến; hôm nay tính lại |
| Pricing catalog bundled + `settings.modelPricing` | giá USD/1M token | Giá hiệu lực = override ?? default |
| `account.usage` (provider) | `UsageEntry[]` rate-limit | Panel riêng, không phải cost |

## Acceptance Criteria

### AC-1 — Range filter

- **Given** trang `/activity` mở, range mặc định `7d`
  **When** chọn range khác (1d / 30d / 90d / all)
  **Then** gọi `activity.summary({ range })`; tổng token + cost + chart `byDay` + bảng by-model/by-account cập nhật theo `from..to` trả về.
- **Given** range `all` **Then** `from = meta.firstDay` (ngày đầu có dữ liệu), to = now; range dài KHÔNG block UI (rollup cache).
- **Given** đổi range **Then** KHÔNG cần gọi lại `activity.pricing()` (giá không phụ thuộc range — có thể cache client).
- **Edge — chưa có dữ liệu nào:** `from`/`to` hợp lệ, totals = 0, byDay = [] (hoặc ngày 0), bảng rỗng → empty state, KHÔNG lỗi.

### AC-2 — Account filter

- **Given** dropdown account (mọi account + "Tất cả")
  **When** chọn 1 account
  **Then** `activity.summary({ range, accountId })`; totals + chart + by-model giới hạn theo account đó; by-account chỉ còn 1 hàng.
- **Given** chọn "Tất cả" **Then** by-account hiện mọi account (kể cả `unknown`), tổng = Σ.
- **Edge — account chọn đã bị xoá khỏi credentials.json:** vẫn truy vấn được (lọc theo id trong rollup), `byAccount[0].exists = false`, label "Đã xoá" (OQ-3); KHÔNG lỗi.

### AC-3 — Bảng by-model

- **Given** range có ≥1 model
  **Then** mỗi hàng: `modelId`, provider, token 4 nhóm + total, costUsd, % tổng token (hoặc % cost — OQ-5); sort desc.
- **Given** model có giá hiệu lực **Then** cost > 0 hợp lý (= Σ token×giá/1e6).
- **Given** turn thiếu `modelUsed` **Then** gom hàng `unknown`, price null, cost 0.
- **Edge — model trong range nhưng thiếu giá** → cost hàng = 0, model có trong `missingPrices` (xem AC-6).

### AC-4 — Bảng by-account

- **Given** turn có `message.accountId` (mới) **Then** gom đúng account đó.
- **Given** turn legacy (không có `message.accountId`) **Then** fallback `session.settings.accountId`; nếu cũng không có → account `unknown`.
- **Given** account còn tồn tại **Then** `label = AccountSafe.label`, `exists = true`; đã xoá → `exists = false`, label "Đã xoá · <id rút gọn>".
- **Given** % tổng **Then** Σ % ≈ 100% (sai số làm tròn chấp nhận).

### AC-5 — Cost calculation

- **Given** một (model, ngày, account) với token nhóm đã biết + giá hiệu lực
  **Then** `costUsd = Σ tokens(g) × price(g) / 1e6`, khớp công thức.
- **Given** Settings override giá model X
  **When** mở/đổi range
  **Then** cost model X dùng giá override; `activity.pricing().prices[X].source = 'override'`. KHÔNG cần rebuild rollup cache (cost tính tại query-time).
- **Given** giá default trong catalog đổi (PR mới) **Then** cost cập nhật mà KHÔNG rebuild rollup (token thô bất biến).

### AC-6 — Missing-price model

- **Given** range chứa model không có giá hiệu lực (không trong default, không override)
  **Then** `missingPrices` chứa modelId; UI hiện banner cảnh báo liệt kê + CTA "Khai giá ở Settings".
  **And** token model đó vẫn cộng vào `totalTokens`; costUsd model đó = 0; tổng cost KHÔNG tính phần đó.
- **When** người dùng khai giá ở Settings rồi quay lại **Then** model rời `missingPrices`, cost bắt đầu tính.
- **Edge — toàn bộ model thiếu giá** → cost tổng = 0, banner rõ "chưa khai giá model nào", token vẫn hiển thị.

### AC-7 — Provider rate-limit panel

- **Given** account OAuth (Anthropic Pro/Max) đang active
  **When** trang mở **Then** gọi `account.usage({ provider, accountId })`; panel hiện bucket `five_hour` + `seven_day*` với `utilization` (%) + reset time.
- **Given** `status !== 'allowed'` **Then** bucket đó màu cảnh báo (warning/rejected).
- **Given** account API-key / OpenAI API-key / không OAuth **Then** `usage: []` → panel "không khả dụng cho account này", KHÔNG lỗi.
- **Given** panel này **Then** nhãn rõ "rate-limit nhà cung cấp (thực tế)" tách biệt cost-tally "ước lượng theo giá khai báo".
- **Security:** panel KHÔNG render token API / profile email nhạy cảm ngoài nhãn cần thiết; KHÔNG log token (invariant #1).

### AC-8 — Loading / empty / error

- **Loading:** trước khi `activity.summary` về → skeleton chart + bảng, KHÔNG hiện số cũ/mock.
- **Empty:** workspace mới, 0 usage → totals 0, "Chưa có hoạt động trong khoảng này", chart phẳng/ẩn, KHÔNG lỗi.
- **Error (RPC fail):** giữ dữ liệu fetch gần nhất nếu có, else "Không tải được hoạt động" inline + nút thử lại; KHÔNG crash trang.
- **Error rate-limit panel riêng:** panel lỗi độc lập với phần cost (một fail không kéo cả trang).

### AC-9 — Browser-dev mock parity

- **Given** chạy `pnpm dev` ngoài Electron (`!sc.available`)
  **When** mở `/activity`
  **Then** trang render data seed hợp lý (range/account/by-model/by-account/chart/cost/rate-limit) từ mock, KHÔNG gọi IPC, KHÔNG console error.
- **Given** trong Electron shell **Then** dùng `activity.summary`/`activity.pricing`/`account.usage` thật; public surface store/composable không đổi giữa dev↔shell.

### AC-10 — Bảo mật + perf

- **Given** payload `activity.summary` / `activity.pricing` **Then** chỉ chứa số liệu + modelId + accountId + label, KHÔNG text message / token API / path nhạy cảm (invariant #1).
- **Given** history JSONL khổng lồ + range `all`
  **Then** request hoàn tất nhanh: ngày cũ đọc từ rollup cache (JSON nhỏ), chỉ "hôm nay" tail-read bounded; KHÔNG `JSON.parse` toàn transcript, KHÔNG OOM.
- **Given** rollup cache **Then** mỗi ngày cũ tính tối đa 1 lần; "hôm nay" tính lại mỗi request (bounded).

### AC-11 — Drill-down chi phí theo ngày của session

- **Given** bảng "Theo phiên" có ít nhất một hàng
  **When** bấm nút mũi tên đầu hàng
  **Then** hàng mở ra danh sách ngày (mới nhất trước), mỗi ngày có: date, bar tỉ lệ theo **ngày đắt nhất của chính phiên đó**, tokens · số lượt, và cost.
- **Given** một hàng đang mở
  **Then** `Σ` cost/token/lượt của các ngày **bằng đúng** số ở hàng cha (và tổng các hàng bằng tổng trang).
- **Given** đang mở drill-down
  **When** đổi range / account / dự án
  **Then** mọi hàng tự thu lại (dữ liệu cũ không dính vào cửa sổ mới).
- **Given** phiên không có ngày nào trong cửa sổ (`byDay` rỗng)
  **Then** nút mũi tên bị disable, không mở được hàng rỗng.

## Edge cases

| Edge case | Hành vi mong muốn |
|---|---|
| Model không có giá (catalog + override đều thiếu) | Vào `missingPrices`; cost model = 0; token vẫn cộng `totalTokens`; banner + CTA Settings. KHÔNG đoán giá. |
| Account đã xoá khỏi credentials.json | by-account row `exists=false`, label "Đã xoá"; vẫn gộp token (id còn trong rollup). KHÔNG drop để tổng khớp. |
| History JSONL khổng lồ (nhiều GB) | Range cũ đọc rollup cache; hôm nay tail-read newest-first + dừng `< todayStart` + cap dòng/session. KHÔNG fold toàn file. |
| Không có usage trong range | totals=0, byModel/byAccount=[], byDay 0; empty state; rate-limit panel vẫn thử fetch (độc lập). |
| Multi-provider (Anthropic + OpenAI + custom) | by-model/by-account gộp xuyên provider; cost theo giá từng model; custom-endpoint model thường ở `missingPrices` tới khi khai giá override. |
| Session đổi account giữa chừng | Turn mới có `message.accountId` đúng; turn cũ fallback `settings.accountId`. By-account chính xác từ khi field mới ship; legacy gần đúng. |
| Turn thiếu `modelUsed` | Gom `unknown` model, price null, cost 0; token vẫn cộng. |
| Turn thiếu `usage` (cancel/error/legacy) | Bỏ qua turn đó (như `collectUsageSince`), KHÔNG cộng token. |
| Task usage (chưa persist token — OQ-2) | Tới khi bổ sung persist: Activity chỉ phủ Sessions; UI ghi rõ "chưa gồm Tasks" hoặc ẩn cho tới khi OQ-2 xong. KHÔNG báo cost Task sai. |
| Múi giờ / DST | Cắt ngày theo local day (`setHours(0,0,0,0)` như `dashboard.usage`). Rollup file key = local `YYYY-MM-DD`. `now` optional cho test. |
| Catalog default đổi giá (PR) sau khi rollup đã cache | Cost tính tại query-time từ token thô → cập nhật ngay, KHÔNG rebuild cache. |
| Rollup cache schema đổi (bump version) | meta.version mismatch → rebuild lazy ngày được hỏi; ngày cũ rebuild 1 lần rồi cache lại. |
| Rollup file hỏng (parse fail) | Tính lại ngày đó từ JSONL (1 lần), ghi đè file; KHÔNG crash, log warn. |
| Đồng hồ máy lùi (clock skew) | Dùng `now` từ sidecar 1 nguồn; ngày "tương lai" không tạo file; chấp nhận best-effort. |

## Dependencies

### Hạ tầng đã có (tái dùng)

- [`collectUsageSince`](../../apps/desktop/sidecar/src/sessions/store.ts) (dòng 607) + `readEventsBackwards` — pattern tail-read JSONL bounded. Mở rộng để trả thêm model + accountId + tách 4 nhóm token (không phá `dashboard.usage`).
- [`sessions/index.json`](../decisions/0048-session-index-lazy-load.md) — lọc session active + `settings.accountId` fallback.
- [`account.usage`](../../apps/desktop/sidecar/src/methods/account.usage.ts) + [`UsageEntry`](../../apps/desktop/sidecar/src/providers/anthropic/usage.ts) — panel rate-limit (đã cache 60s).
- `settings` store (ui-next) + `settings.get/set` — lưu `modelPricing` override.
- `AppSelect` ([MEMORY: use_appselect_for_dropdowns]) cho dropdown range/account.
- Types: [`SessionMessage`](../../apps/desktop/sidecar/src/types/shared.ts) (235), [`SessionSettings`](../../apps/desktop/sidecar/src/types/shared.ts) (154), [`AccountSafe`/`AccountIdentity`](../../apps/desktop/sidecar/src/types/shared.ts) (72/38), `DashboardUsage` (976).

### Phần mới

- **RPC `activity.summary`** (sidecar) — đọc rollup cache + tính hôm nay + áp giá + filter account. File `methods/activity.summary.ts`.
- **RPC `activity.pricing`** (sidecar) — merge catalog default + Settings override. File `methods/activity.pricing.ts`.
- **Module rollup** (sidecar) — `usage/rollup.ts`: build/read daily files `~/.awog/usage/daily/<date>.json` + `meta.json`, ngày cũ bất biến.
- **Pricing catalog bundled** (sidecar) — `pricing/catalog.ts` hằng (modelId → giá 4 nhóm + provider + catalogVersion).
- **Persist `accountId` per turn** — thêm `accountId?: string` vào `SessionMessage` (shared.ts + UI types index.ts) + gán khi append agent message ([`sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) dòng ~623).
- **Settings `modelPricing`** — schema override giá trong settings store + UI editor (tab Models/Pricing).
- **(OQ-2)** Persist token per Task-turn nếu gộp Tasks (đụng `node-runner.ts` + task event log).
- **Store `activity.ts` + composable `useActivity()`** (ui-next, dual-path) — page-controller cho `/activity`.
- **i18n keys mới** (en/vi) — flat dotted, qua `tr` ([MEMORY: ui_strings_i18n]): `activity.range.*`, `activity.account.all`, `activity.byModel.*`, `activity.byAccount.*`, `activity.cost.*`, `activity.missingPrice.*`, `activity.rateLimit.*`, `activity.empty`, `activity.loading`, `activity.error`, `activity.unavailable`.
- **(OQ-5)** Chart renderer (SVG nội bộ hay lib nhỏ — cần xác nhận, có thể ADR nếu thêm dep).

### Entity liên quan

- **Session** (đọc) — `at`/`completedAt`, `modelUsed`, `usage`, `settings.accountId` + `accountId` mới.
- **Account** (đọc) — label/exists cho by-account; `account.usage` cho rate-limit panel.
- **Task** (đọc, OQ-2) — model + token per turn (cần persist trước).
- **Settings** (đọc/ghi) — `modelPricing` override.

## Open questions

| ID | Câu hỏi | Cho ai | Đề xuất |
|---|---|---|---|
| OQ-1 | **Cấu trúc & vị trí rollup cache** chốt chính xác? (`~/.awog/usage/daily/<date>.json` + `meta.json`, schema version, atomic write tmp-rename) — đúng chuẩn? | TL | Đề xuất: 1 file JSON / local-day chứa token thô (chưa cost) per model/account; `meta.json` giữ `version`+`firstDay`+`lastBuiltDay`; atomic write (tmp + rename); ngày cũ bất biến. Có thể ghi vào ADR riêng (storage layout). |
| OQ-2 | **Gộp Tasks vào Activity ngay MVP** hay defer? Task hiện KHÔNG persist token per turn ([`TraceNode`](../../apps/desktop/sidecar/src/types/shared.ts)/`TaskRun` không có token; `node-runner.ts` bỏ `_usage`). | PO/TL | (A) MVP **chỉ Sessions**, UI ghi rõ "chưa gồm Tasks", defer persist token Task sang phase sau. (B) Bổ sung persist token per task-turn ngay (đụng `node-runner.ts` + task event log + rollup). **BA nghiêng (A)** cho MVP — tránh phình scope; (B) là follow-up rõ ràng. |
| OQ-3 | **Account đã xoá**: hiển thị thế nào trong by-account? | PO | Đề xuất: giữ row, `exists=false`, label "Đã xoá · <id 6 ký tự>"; vẫn gộp token để tổng khớp. KHÔNG ẩn (kẻo tổng lệch). |
| OQ-4 | **Settings UI cho `modelPricing`**: tab nào, layout nào? Model `unknown` (thiếu `modelUsed`) có nên vào `missingPrices` không? | PO/designer | Đề xuất: tab "Models / Pricing" trong Settings (gần `SettingsModels.vue`); bảng modelId → 4 giá, badge default/override, nút reset về default. `unknown` model KHÔNG vào `missingPrices` (không phải model có tên) — hiển thị riêng "không xác định model". |
| OQ-5 | **Chart renderer**: SVG tự vẽ hay lib? Trục Y = token hay cost (toggle)? `byDay` có gửi ngày 0-token không? Sort bảng theo token hay cost? | TL/designer | Đề xuất: render SVG nội bộ (không thêm dep → khỏi ADR); toggle token/cost; `byDay` gửi đủ ngày (kể cả 0) để chart liền; bảng sort desc theo **cost** mặc định (có thể đổi token). Nếu cần lib chart → ADR. |
| OQ-6 | **By-agent breakdown** (ngoài by-model/by-account) có nằm trong MVP? Cần map turn → agent (session có `agentId` per message; task có node `agentId`). | PO | Đề xuất: **ngoài MVP**. MVP chỉ by-model + by-account. By-agent là mở rộng (rollup có thể thêm chiều agent sau). |
| OQ-7 | **MVP scope**: Activity page là **feature mới ngoài [mvp-scope.md](../requirements/mvp-scope.md) hiện tại** (mvp-scope chỉ có tile Activity Home / quota cơ bản). Đưa vào MVP hay post-MVP? | PO | Đề xuất: post-MVP "nice-to-have analytics" — Home tile + tray quota đã đủ cho MVP; trang phân tích cost là nâng cao. (Chỉ ghi 1 dòng ở đây, KHÔNG sửa mvp-scope.md tới khi PO chốt.) |

## Test scenarios (input cho QA)

- **TS-1 (range):** Có usage rải 90 ngày → đổi 1d/7d/30d/90d/all → tổng + chart + bảng đổi đúng `from..to`; `all` nhanh (rollup).
- **TS-2 (account filter):** 2 account chạy session → "Tất cả" hiện 2 row; chọn 1 account → by-account 1 row, by-model/tổng giảm theo.
- **TS-3 (by-model + cost):** Turn với model có giá → cost = Σ token×giá/1e6 khớp tay; % tổng đúng.
- **TS-4 (override pricing):** Settings override giá model X → cost X đổi, `activity.pricing().source='override'`, KHÔNG rebuild rollup.
- **TS-5 (missing price):** Dùng model custom chưa khai giá → vào `missingPrices`, cost 0, banner CTA; khai giá → rời `missingPrices`, cost > 0.
- **TS-6 (account deleted):** Xoá account còn dữ liệu cũ → by-account row `exists=false` "Đã xoá", token vẫn gộp.
- **TS-7 (rate-limit panel):** Account OAuth → panel hiện five_hour/seven_day %; account API-key → "không khả dụng".
- **TS-8 (perf / rollup):** History lớn + range all → response nhanh; verify ngày cũ đọc cache, hôm nay tail-read bounded (không OOM, dòng đọc bounded).
- **TS-9 (rollup immutability):** Chạy 2 request range 30d cách nhau → ngày cũ KHÔNG tính lại (chỉ hôm nay); sửa giá → cost đổi, token thô file không đổi.
- **TS-10 (accountId per-turn):** Đổi account giữa session → turn mới gom account mới, turn cũ gom account cũ (legacy fallback settings).
- **TS-11 (empty/loading/error):** Workspace mới → empty; RPC fail → inline error + retry, không crash; rate-limit panel fail độc lập.
- **TS-12 (mock parity):** `pnpm dev` browser → trang render seed, 0 IPC, 0 console error.
- **TS-13 (security):** Inspect payload `activity.summary`/`pricing` → chỉ số + modelId/accountId/label, KHÔNG text/token/path.

## Đề xuất tiếp theo

- Spec **Ready for TL/PM**. Cần:
  - **TL** chốt OQ-1 (storage layout rollup — có thể cần ADR storage), OQ-5 (chart renderer — ADR nếu thêm dep), xác nhận contract `activity.summary`/`activity.pricing` + guardrail rollup/tail-read.
  - **PO** chốt OQ-2 (gộp Tasks ngay hay defer), OQ-3 (account xoá), OQ-4 (Settings pricing UI + model unknown), OQ-6 (by-agent), OQ-7 (MVP vs post-MVP + có sửa [mvp-scope.md](../requirements/mvp-scope.md) không).
- Bàn giao **Tech Lead** (skill `write-adr`): cân nhắc 1 ADR cho **storage layout rollup cache + pricing catalog** (giá là tri thức cập nhật theo thời gian → đáng ghi nguồn-của-sự-thật). Persist `accountId` per-turn là thay đổi nhỏ type → có thể nằm trong ADR đó hoặc note ở [ADR 0048](../decisions/0048-session-index-lazy-load.md).
- Sau TL: **Project Manager** (skill `decompose-tasks`) chia theo surface: (1) pricing catalog + `activity.pricing`, (2) rollup module + `activity.summary` + accountId per-turn persist, (3) Settings `modelPricing` editor, (4) store `activity.ts` + composable + trang `/activity` + chart, (5) i18n + empty/loading/error, (6) [OQ-2] persist token per Task-turn (nếu gộp Tasks).

## Liên kết

- Trang mới: `apps/desktop/ui-next/pages/activity.vue` (chưa tạo) · NavRail thêm mục Activity
- Sidecar mới: `methods/activity.summary.ts` · `methods/activity.pricing.ts` · `usage/rollup.ts` · `pricing/catalog.ts`
- Tái dùng: [`dashboard.usage`](../../apps/desktop/sidecar/src/methods/dashboard.usage.ts) · [`collectUsageSince`](../../apps/desktop/sidecar/src/sessions/store.ts) · [`account.usage`](../../apps/desktop/sidecar/src/methods/account.usage.ts) · [`providers/anthropic/usage.ts`](../../apps/desktop/sidecar/src/providers/anthropic/usage.ts)
- Types: [`types/shared.ts`](../../apps/desktop/sidecar/src/types/shared.ts) (`SessionMessage` 235 · `SessionSettings` 154 · `AccountSafe`/`AccountIdentity` 72/38 · `DashboardUsage` 976 · `TraceNode`/`TaskRun` 675/701)
- Persist accountId: [`sessions.send-message.ts`](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) (dòng ~623)
- ADR: [0024 — Task Execution Engine IPC](../decisions/0024-task-execution-engine-ipc-contract.md) · [0048 — Session index lazy-load](../decisions/0048-session-index-lazy-load.md)
- Liên quan (đừng trùng): [home-dashboard.md](home-dashboard.md) (tile Activity 24h) · [tray-account-usage.md](tray-account-usage.md) (quota per-account)
- [VISION](../../artifacts/VISION.md) · [.claude/rules/security.md](../../.claude/rules/security.md) (invariant #1) · [mvp-scope.md](../requirements/mvp-scope.md) (OQ-7)
