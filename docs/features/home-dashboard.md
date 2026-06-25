# Home Dashboard (Bento) — tích hợp data thật

> Wire 8 tile của trang Home (bento dashboard) ở `ui-next` vào store/IPC thật,
> thay toàn bộ mock hardcoded. Một bảng tổng quan "trạng thái guild" đọc-only:
> cần xử lý gì, đang chạy gì, hoạt động token 24h, git, agents, connections, session gần đây.

- **Trạng thái:** Spec — Ready for TL/PM. Cần TL chốt OQ-1..OQ-5 trước khi PM chia task.
- **Owner:** Business Analyst
- **Ngày:** 2026-06-25
- **Phạm vi:** `apps/desktop/ui-next` (trang Home + 3 store mới + 1 composable) + 1 RPC mới ở sidecar (`dashboard.usage`).
- **Liên quan:** [task-execution-engine.md](task-execution-engine.md), [git-manager.md](git-manager.md), [session-system.md](session-system.md), [connections-manager.md](connections-manager.md), [agent-builder.md](agent-builder.md), [workspace-panel.md](workspace-panel.md) (mẫu format), [tray-account-usage.md](tray-account-usage.md) (usage hạ tầng — đừng trùng), [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md), [ADR 0048](../decisions/0048-session-index-lazy-load.md)

## Bối cảnh

Trang Home [`pages/index.vue`](../../apps/desktop/ui-next/pages/index.vue) là bento dashboard port verbatim từ `awog-prototype.html` (`data-page="home"`). Chrome string đã đi qua i18n ([`i18n/locales/{en,vi}/home.json`](../../apps/desktop/ui-next/i18n/locales/vi/home.json)), nhưng **mọi entity data đều mock hardcoded** (tên session, số đếm, % progress, sparkline cố định…). Nhiệm vụ "tích hợp" = nối 8 tile vào live store + IPC, giữ nguyên class layout của [`prototype.css`](../../apps/desktop/ui-next/assets/css/prototype.css) (`.bento` / `.tile` / `.await` / `.run` / `.spark` / `.grow` / `.ag` / `.conn` / `.rs`).

Hiện `ui-next` chỉ có 3 store live: [`sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts), [`git.ts`](../../apps/desktop/ui-next/stores/git.ts), [`settings.ts`](../../apps/desktop/ui-next/stores/settings.ts). Tasks / Connections / Agents **chưa có store ở ui-next** (đã wire trong `apps/desktop/ui` cũ — dùng làm tham chiếu IPC). Home cần cả ba.

Đây là tile **đọc-only**: không tạo/sửa entity, chỉ điều hướng (`navigateTo` sang `/sessions` `/tasks` `/git`). Vì vậy 3 store mới ở giai đoạn này chỉ cần phần **đọc + live event** (list/hydrate/subscribe), không cần action CRUD đầy đủ.

## Mục tiêu

- 8 tile hiển thị data thật khi chạy trong Electron shell (`sc.available`), live-update qua event có sẵn (`task.*`, `session.*`, `mcp.status`, `git:status:changed`) — không cần reload.
- Browser-dev (no shell) giữ **mock parity**: tile vẫn render data seed hợp lý, không crash, không gọi IPC.
- Mỗi tile có loading / empty / error state rõ ràng (không "đứng hình" số mock cũ).
- Thêm đúng **một** RPC mới: `dashboard.usage` (sparkline + token-today). Mọi tile khác tái dùng method đã có.
- Giữ nguyên markup/class prototype; data binding thay literal, không đổi cấu trúc DOM/CSS.

## Non-goals

- Không thêm action mutate (create/run/approve trực tiếp **trong** Home) — nút "Approve" trên tile Attention chỉ **điều hướng** sang `/tasks` (resolve thực hiện ở trang đích). Xem OQ-2.
- Không vẽ biểu đồ usage lịch sử dài hạn / dự báo — sparkline chỉ 12 bucket 24h (tile Activity). Quota per-account là phạm vi [tray-account-usage](tray-account-usage.md), **không** trùng.
- Không scan toàn bộ history JSONL để tính token (guardrail tail-read, xem `dashboard.usage`).
- Không thêm dependency mới (chart lib…). Sparkline render bằng `<i style="height:%">` như prototype.

## Personas

- **Solo Builder** (persona chính MVP) — chạy nhiều session/task local. Mở app → cần nhìn 1 màn để biết: có gì chờ mình (reply/approve), có gì đang chạy, hôm nay đốt bao nhiêu token, repo nào dirty. Home là "control tower" buổi sáng.

## Tile → nguồn data → trạng thái

| # | Tile (class) | Nguồn data (store / IPC) | Live event | Empty state |
|---|---|---|---|---|
| 1 | **Attention** (`.await` / `.acard`) | session `awaiting` (reply/permission/question pending) `useSessionsStore` + task `waiting_approval` (`tasks` store) | `session.*`, `task.status` | "Không có gì cần xử lý" — ẩn tile hoặc card rỗng (OQ-4) |
| 2 | **Running** (`.stat` big number) | derived: #session `streaming` + #task `running`; subline "N task · M session · ~Xk tok/min" (rate từ `dashboard.usage.ratePerMin`) | `session.*`, `task.status`, `dashboard.usage` refresh | big number `0` + subline "không có gì đang chạy" |
| 3 | **Running tasks** (`.run` / `.ritem`) | task `running` từ `tasks` store; progress % = phase `completed` / tổng phase (đọc `task.phases` + `workflowSnapshot`) | `task.status`, `task.phase.status`, `task.run.*` | "Không có task đang chạy" |
| 4 | **Activity** (`.spark`) | RPC mới `dashboard.usage` → `{ today, yesterday, buckets[12], ratePerMin }` | poll/refresh (xem cadence) + `session.*`/`task.*` đánh dấu dirty | sparkline phẳng + "0 tok today" |
| 5 | **Git** (`.grow` / `.gchip`) | per-repo summary: repo label, branch, dirty count (M/A), ahead/behind. **Cần đa-repo** — xem OQ-1 | `git:status:changed` | "Chưa có repo" (NO_REPO) |
| 6 | **Agents** (`.ag` / `.as`) | roster `agents.list`; status **suy ra**: "working" nếu có task/session running dùng `agentId` đó, else "Xm ago" | `task.*`, `session.*` | "Chưa có agent" |
| 7 | **Connections** (`.conn` / `.cdot`) | `mcp.list` → `McpServerSnapshot` (name + `status`) | `mcp.status` | "Chưa có connection" |
| 8 | **Recent sessions** (`.rs`) | `useSessionsStore.sessions` (đã sort theo `updatedAt`), top N | `session.*` | "Chưa có session" |

> Tile 1, 2, 6 là **derived cross-store** → gom vào composable `useHomeDashboard()`.

## Kiến trúc triển khai

### Store mới (dual-path, mirror `sessions.ts` + `git.ts`)

Ba store mới ở `ui-next/stores/`, cùng pattern: `useIpc = useSidecar().available`; IPC mode hydrate từ RPC + subscribe live event; browser-dev seed mock. **Chỉ phần đọc** ở giai đoạn này.

- **`tasks.ts`** — `tasks.list` → `Task[]`; subscribe `task.status` / `task.phase.status` / `task.run.*` ([emit.ts](../../apps/desktop/sidecar/src/tasks/emit.ts)) cập nhật phase status + run progress tại chỗ. Getter: `running` (status `running`), `waitingApproval` (status `waiting_approval`). Tham chiếu logic IPC: `apps/desktop/ui/stores/tasks.ts`.
- **`connections.ts`** — `mcp.list` → `McpServerSnapshot[]`; subscribe `mcp.status` cập nhật `status`/`lastError` tại chỗ. Tham chiếu: `apps/desktop/ui/stores/workspace.ts` (phần mcp).
- **`agents.ts`** — `agents.list` (truyền `projectIds` đã đăng ký) → `Agent[]`. Roster đọc-only; status **không** lưu trong store (derive ở composable từ tasks + sessions). Tham chiếu: `apps/desktop/ui/stores/workspace.ts` (phần agents).

Reuse nguyên `useSessionsStore` (đã live) + `useGitStore` (đã live, có caveat OQ-1).

### Composable `useHomeDashboard()`

Orchestrate derived cross-store, page Home chỉ `const { attentionItems, runningCount, runningTasks, activity, gitSummary, agentsWithStatus, connections, recentSessions } = useHomeDashboard()` (page-controller pattern, [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md)). Computed:

- `attentionItems` — gộp session `awaiting` + task `waiting_approval`, mỗi item `{ kind: 'session'|'task', id, title, subtitle, action: 'reply'|'review' }`.
- `runningCount` — `sessions.streaming.length + tasks.running.length`; subline ghép `N task · M session · ~Xk tok/min`.
- `runningTasks` — map `tasks.running` → `{ title, who: agent·model, nodeLabel: "Node X/Y · skillName", percent, elapsed }`. `X` = số phase `completed`, `Y` = tổng node trong `workflowSnapshot.nodes` (fallback `Object.keys(task.phases).length`), `percent = round(X/Y*100)`.
- `activity` — đọc `dashboard.usage` state (xem dưới).
- `gitSummary` — per-repo `{ label, branch, dirtyCount, addCount, ahead, behind, clean }` (phụ thuộc OQ-1).
- `agentsWithStatus` — `agents` + status suy ra: `working` nếu `agentId` xuất hiện trong task running (`workflowSnapshot.nodes[].agentId`) hoặc session streaming dùng agent đó; else `"<relativeWhen> ago"` từ lần dùng gần nhất (OQ-3 về "lần dùng gần nhất").
- `connections` — map `McpServerSnapshot` → `{ name, dotColor, statusLabel }` (running=green, idle=faint, error=red).
- `recentSessions` — `sessions` top N, `{ dotColor, title, project, model, statusLabel }` (`awaiting`→amber "đang chờ", `streaming`→accent "đang chạy", `done`→faint "xong").

### Cadence refresh `dashboard.usage`

Activity tile cần dữ liệu tươi nhưng KHÔNG hammer disk. Đề xuất:
- Fetch lần đầu khi Home mount.
- Re-fetch khi nhận `session.*` / `task.*` "dirty" event, **debounce ≥ 30s** (gộp burst streaming).
- Re-fetch on window `focus` nếu lần fetch gần nhất > 60s.
- KHÔNG timer nền khi không ở trang Home (mirror non-goal poller của [tray-account-usage](tray-account-usage.md)). Cadence chính xác — OQ-5.

## Contract RPC mới: `dashboard.usage`

Method mới ở sidecar (chưa tồn tại — đã đối chiếu `methods/`, không có `dashboard.*`). Đọc tail JSONL các session, gom token theo bucket thời gian.

### Request

```ts
type DashboardUsageParams = {
  // Cửa sổ tính bằng giờ. Mặc định 24. Bucket = windowHours / 12 (mặc định 2h/bucket).
  windowHours?: number // default 24, max 48
  // Mốc "now" (ms epoch) cho test/determinism. Mặc định Date.now().
  now?: number
}
```

### Response

```ts
type DashboardUsageResult = {
  // Tổng token trong cửa sổ "hôm nay" (24h gần nhất tính tới `now`).
  today: number
  // Tổng token cửa sổ 24h liền trước (24h..48h) — để tính "↑Y% vs hôm qua".
  yesterday: number
  // 12 bucket token, cũ → mới. buckets[11] = bucket chứa `now`.
  // Mỗi phần tử = tổng token mọi message có `at` rơi vào bucket đó.
  buckets: number[] // length 12
  // Token/phút ước lượng từ hoạt động ~5 phút gần nhất (cho subline tile Running).
  ratePerMin: number
}
```

### Ngữ nghĩa

- **token = `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`** của mỗi `SessionMessage.usage` ([shared.ts](../../apps/desktop/sidecar/src/types/shared.ts) `SessionMessage.usage`). Cache token PHẢI cộng — mirror quyết định context-window của session (history nằm ở `cacheRead`, [MEMORY: usage_cache_tokens]). Bỏ qua message không có `usage`.
- **bucket** = `windowHours / 12` giờ (mặc định 2h). `buckets[i]` cộng dồn token của message có `at` (ISO) ∈ `[now - (12-i)*bucketMs, now - (11-i)*bucketMs)`. Message ngoài cửa sổ 24h → không vào `buckets` nhưng có thể vào `yesterday`.
- **today / yesterday** = tổng token 0..24h / 24..48h. `% vs hôm qua` tính ở UI: `today === 0 && yesterday === 0` → ẩn delta; `yesterday === 0 && today > 0` → "mới"; else `round((today - yesterday) / yesterday * 100)`.
- **ratePerMin** = tổng token mọi message có `at` trong 5 phút gần nhất ÷ 5 (làm tròn). 0 khi không có hoạt động.

### Guardrail performance (tail-read — bắt buộc)

- Đọc JSONL **newest-first**: với mỗi session, đọc file ngược từ cuối (tail) hoặc stream từng dòng và dừng **ngay khi gặp message có `at` < đầu cửa sổ** (`now - 48h`). KHÔNG `JSON.parse` toàn bộ transcript vào RAM (mirror [MEMORY: session_jsonl_byte_minimal_persist] — loader phải stream).
- Bound theo **hoạt động gần đây**, không theo tổng kích thước history: session không có message trong 48h → bỏ qua hầu hết, chỉ chạm vài dòng cuối.
- Chỉ xét session có `updatedAt` trong cửa sổ (đọc từ `sessions/index.json` trước để lọc — KHÔNG mở file session inactive). Tham chiếu index list: [ADR 0048](../decisions/0048-session-index-lazy-load.md).
- Cap số session quét (vd ≤ 200 newest theo `updatedAt`) + cap số dòng/file để chặn worst-case JSONL khổng lồ.
- Sanitize: response KHÔNG chứa text message / token API key — chỉ số đếm (invariant #1).

## Acceptance Criteria

### AC-1 — Tile Attention (await)

- **Given** có session ở trạng thái `awaiting` (question/permission pending) hoặc task `waiting_approval`
  **When** Home render
  **Then** mỗi item hiện 1 `.acard.hot` với title (session/task title), subtitle (vd "<agent> hỏi: …" / "Permission: <tool> <path>" / "Phase chờ duyệt"), nút action: session→"Reply", task→"Review".
- **When** bấm nút action **Then** `navigateTo('/sessions')` (session) hoặc `navigateTo('/tasks')` (task) — KHÔNG resolve tại Home (OQ-2).
- **Given** count `.ct` **Then** = tổng số item (`home.attention.count`), cập nhật live khi 1 session được trả lời / task được duyệt (qua `session.*` / `task.status`).
- **Loading:** trước khi store hydrate xong → tile hiện skeleton/placeholder, KHÔNG hiện "0".
- **Empty:** 0 item → hiển thị empty state (OQ-4), count 0.
- **Error:** store hydrate fail → tile hiện "Không tải được" inline, KHÔNG crash trang.
- **Browser-dev:** seed mock 1-2 acard như prototype hiện tại; action navigate vẫn chạy.

### AC-2 — Tile Running (stat count)

- **Given** N session `streaming` + M task `running`
  **Then** big number = `N + M`; subline = `M task · N session · ~{ratePerMin*1...}k tok/min` (rate từ `dashboard.usage.ratePerMin`, format `~Xk` khi ≥ 1000, `~X` khi nhỏ).
- **When** một session bắt đầu/kết thúc stream (`session.*`) hoặc task đổi status (`task.status`) **Then** big number cập nhật live.
- **Empty:** N+M = 0 → big number `0` + subline "không có gì đang chạy" (rate ẩn).
- **Loading:** chưa hydrate → placeholder, không "3" mock.
- **Browser-dev:** seed mock (vd 2 task + 1 session) cho parity.

### AC-3 — Tile Running tasks (run)

- **Given** task `running` có `workflowSnapshot` với Y node, X phase `completed`
  **Then** mỗi `.ritem` hiện: title, `who` = "<agent> · <model>", `.ph` = "Node X/Y · <skillName phase hiện tại>", `.bar i` width = `percent%`, `.mt` hiện "elapsed <mm ss>" + "<percent>%".
- **Given** `percent = round(X/Y*100)` với `Y = workflowSnapshot.nodes.length` (fallback `Object.keys(task.phases).length` khi snapshot thiếu — legacy task).
- **When** nhận `task.phase.status` (một phase → completed) **Then** progress bar + "Node X/Y" cập nhật live.
- **When** `task.run.*` (run mới chạy) **Then** skillName/elapsed cập nhật.
- **Empty:** 0 task running → "Không có task đang chạy".
- **Edge — không có workflowSnapshot và phases rỗng:** percent = 0, "Node 0/0" → hiển thị "đang khởi tạo" thay vì chia cho 0.
- **Browser-dev:** seed 1-2 ritem mock.

### AC-4 — Tile Activity (spark)

- **Given** `dashboard.usage` trả `{ today, buckets[12], yesterday, ratePerMin }`
  **Then** 12 `.spark i` có height = `bucket / max(buckets) * 100%` (min-height 3px theo CSS); bucket lớn nhất gắn class `.hi`.
  **And** `.u1` = format(`today`) + label "tok today"; `.u2` = "↑/↓ Y% vs hôm qua" (xem ngữ nghĩa % ở contract).
- **Given** `today === 0 && yesterday === 0` **Then** sparkline phẳng (mọi cột min-height), `.u1` = "0 tok today", `.u2` ẩn.
- **Given** `yesterday === 0 && today > 0` **Then** `.u2` = "mới" (không chia 0).
- **Loading:** trước fetch đầu → sparkline skeleton/phẳng + "…", không số mock 2.4M.
- **Error / RPC fail:** giữ giá trị fetch gần nhất nếu có, else "không khả dụng" inline; KHÔNG crash.
- **Browser-dev:** `dashboard.usage` không gọi (no IPC) → seed mock buckets như prototype.
- **Performance:** mở Home với history nhiều session lớn → fetch hoàn tất nhanh nhờ tail-read (KHÔNG block UI; AC kiểm bằng guardrail trong test scenario).

### AC-5 — Tile Git

- **Given** project hiện hành có ≥1 repo (OQ-1)
  **Then** mỗi `.grow` hiện: `.rn` repo label, `.br` branch, chip `.gchip.m` "<N> M" khi có file modified/added, `.gchip.a` "↑<ahead>"/"↓<behind>" khi ahead/behind > 0.
- **Given** repo sạch (0 dirty, ahead=behind=0) **Then** chip `.gchip` "clean" (`home.git.clean`).
- **When** nhận `git:status:changed` **Then** dirty count + ahead/behind cập nhật live (debounce 200ms như git store).
- **Empty / NO_REPO:** "Chưa có repo" + (tùy chọn) CTA mở `/git`.
- **Loading:** chưa load status → placeholder.
- **Browser-dev:** seed mock 1-2 repo (như prototype "awog"/"sidecar").
- **Caveat:** xem OQ-1 — `useGitStore` ui-next hiện chỉ giữ state 1 repo đang chọn; tile cần per-repo summary nhiều project/repo.

### AC-6 — Tile Agents

- **Given** `agents.list` trả roster
  **Then** mỗi `.ag` hiện badge (initials), `.an` name, `.am` model, `.as` status.
- **Given** agentId xuất hiện trong task `running` (`workflowSnapshot.nodes[].agentId`) hoặc session `streaming` đang dùng agent đó
  **Then** `.as.live` = "working" (`home.agents.working`).
- **Given** agent không đang chạy **Then** `.as` = "<relativeWhen> ago" (lần dùng gần nhất — OQ-3) hoặc "—" nếu chưa từng dùng.
- **Given** count `.ct` = số agent (`home.agents.active`).
- **When** task/session running đổi (`task.*`/`session.*`) **Then** status "working" cập nhật live.
- **Empty:** roster rỗng → "Chưa có agent".
- **Browser-dev:** seed mock 3 agent (tech-lead/infosec/developer).

### AC-7 — Tile Connections

- **Given** `mcp.list` trả `McpServerSnapshot[]`
  **Then** mỗi `.cn` hiện `.cdot` màu theo `status` (running→green, idle/starting→faint, error→red, disabled→faint dim) + name + `.cm` status label ("running" / "idle" / "error" / "disabled").
- **Given** count `.ct` = số connection (`home.connections.count`).
- **When** nhận `mcp.status` **Then** dot màu + label cập nhật live.
- **Empty:** danh sách rỗng → "Chưa có connection".
- **Error:** một server `status === 'error'` → dot đỏ + label "error" (KHÔNG hiện `lastError` raw — tránh leak; chỉ nhãn).
- **Browser-dev:** seed mock (github/filesystem running, linear/notion idle).

### AC-8 — Tile Recent sessions (rs)

- **Given** `useSessionsStore.sessions` đã hydrate (sort theo `updatedAt`)
  **Then** top N (vd 5) `.rs`: `.si` dot màu theo status, `.st1` title, `.tag` project, `.tag` model, `.sw` status+age.
  - `awaiting` → dot amber, `.sw` = "đang chờ · <age>".
  - `streaming` → dot accent, `.sw` = "đang chạy · <age>".
  - `done`/idle → dot faint, `.sw` = "xong · <age>".
- **When** session đổi status/updatedAt (`session.*`) **Then** list re-sort + nhãn cập nhật live.
- **Empty:** 0 session → "Chưa có session".
- **Browser-dev:** dùng seed mock của `useSessionsStore` (đã có).

### AC-9 — Mock parity (browser-dev)

- **Given** chạy `pnpm dev` ngoài Electron (`!sc.available`)
  **When** mở Home
  **Then** cả 8 tile render data seed hợp lý (không "đứng hình" rỗng), KHÔNG gọi IPC, KHÔNG lỗi console; `dashboard.usage` không được gọi (Activity dùng mock buckets).
- **Given** chạy trong Electron shell **Then** 8 tile dùng data thật; chuyển dev↔shell không đổi public surface của store (cùng getter/computed).

### AC-10 — Đọc-only + bảo mật

- **Given** mọi tương tác trên Home **Then** chỉ `navigateTo`; KHÔNG mutate entity, KHÔNG action sidecar nào ngoài các `*.list` read + `dashboard.usage`.
- **Given** payload `dashboard.usage` **Then** chỉ chứa số (token counts), KHÔNG text message / token API / path nhạy cảm (invariant #1).
- **Given** tile Connections error **Then** không render `lastError` raw lên UI (chỉ nhãn "error").

## Edge cases

| Edge case | Hành vi mong muốn |
|---|---|
| Không có task chạy + không session streaming | Tile Running big number `0` + "không có gì đang chạy"; tile Running tasks empty "Không có task đang chạy". KHÔNG NaN/chia 0. |
| Không có repo (project không phải repo, chưa discover) | Tile Git "Chưa có repo" + CTA `/git`. KHÔNG crash khi `workspaceRoot` rỗng. |
| Account/session không có usage (toàn message thiếu `usage`) | `dashboard.usage` trả `today=0, buckets[12]=0, ratePerMin=0`; Activity sparkline phẳng + "0 tok today", delta ẩn. KHÔNG báo lỗi. |
| JSONL khổng lồ (session nhiều GB) | Tail-read newest-first + dừng khi `at < now-48h` + cap dòng/session → bounded; fetch không block UI. (Guardrail bắt buộc trong contract.) |
| Task có `workflowSnapshot` thiếu (legacy) | `Y = Object.keys(task.phases).length`; nếu cũng rỗng → "Node 0/0 · đang khởi tạo", percent 0. |
| Agent bị xóa khi đang là node của task running | Roster `agents.list` không còn agent đó → tile Agents bỏ; nhưng tile Running tasks vẫn hiện task (who = agentId fallback / "unknown agent"). KHÔNG crash. |
| Concurrent: nhiều task running cùng dùng 1 agent | Agent đó "working" (chỉ cần ≥1 lần dùng). KHÔNG đếm trùng. |
| Session streaming nhưng app vừa restart (resume) | `session.*` chưa replay → status từ `sessions.list` summary; live event sửa lại khi tới. Chấp nhận stale ngắn tới event đầu. |
| `mcp.status` đổi nhanh (start→idle) | Dot cập nhật theo event mới nhất; không nhấp nháy quá mức (đã có debounce ở store nếu cần). |
| Múi giờ / `now` lệch giữa sidecar và UI | `dashboard.usage` nhận `now` optional cho test; production dùng `Date.now()` ở sidecar (1 nguồn). UI không tự cắt bucket. |
| Cửa sổ Home không mở (ở trang khác) | KHÔNG poll `dashboard.usage`; store live event vẫn cập nhật state nền (rẻ). Fetch usage lại khi quay về Home (cadence OQ-5). |
| Sidecar unavailable giữa chừng | Tile chuyển sang giá trị gần nhất + nhãn "không khả dụng" inline, KHÔNG crash; reconnect → hydrate lại. |

## Dependencies

### Hạ tầng đã có (tái dùng)

- RPC: [`tasks.list`](../../apps/desktop/sidecar/src/methods/tasks.list.ts), [`mcp.list`](../../apps/desktop/sidecar/src/methods/mcp.list.ts), [`agents.list`](../../apps/desktop/sidecar/src/methods/agents.list.ts), `sessions.list` (đã dùng ở `sessions.ts`).
- Live event: `task.status` / `task.phase.status` / `task.run.started|output|trace|message|done` ([tasks/emit.ts](../../apps/desktop/sidecar/src/tasks/emit.ts)); `session.chunk`/`session.step`/`session.permission-request` (sessions store); `mcp.status`; `git:status:changed`.
- Store live: `useSessionsStore`, `useGitStore` (ui-next). Tham chiếu IPC logic: `apps/desktop/ui/stores/{tasks,workspace,git}.ts`.
- Types: [`Task` / `TaskStatus` / `TaskPhase` / `Workflow`](../../apps/desktop/sidecar/src/types/shared.ts), `McpServerSnapshot` / `McpStatus`, `Agent`, `SessionMessage.usage`, `SessionStatus` (ui-next `useSessionsMock`).
- Index session list ([ADR 0048](../decisions/0048-session-index-lazy-load.md)) — lọc session active cho `dashboard.usage`.

### Phần mới

- **RPC `dashboard.usage`** (sidecar) — tail-read JSONL gom token theo bucket. Method file `methods/dashboard.usage.ts`. Đọc index trước, tail từng session active, sanitize → counts.
- **Store `tasks.ts` / `connections.ts` / `agents.ts`** (ui-next, dual-path, phần đọc + subscribe).
- **Composable `useHomeDashboard()`** — derived cross-store + cadence fetch usage.
- **i18n keys mới** (en/vi): empty/loading/error string cho 8 tile (vd `home.attention.empty`, `home.running.none`, `home.runningTasks.empty`, `home.runningTasks.initializing`, `home.activity.new`, `home.git.noRepo`, `home.agents.empty`, `home.agents.ago`, `home.connections.empty`, `home.recent.empty`, `home.unavailable`). Flat dotted keys, qua `tr` ([MEMORY: ui_strings_i18n]).
- **(OQ-1)** Có thể cần getter đa-repo cho git (xem dưới).

### Entity liên quan

- **Task** — đọc status + phases + workflowSnapshot (tile 2/3/6). KHÔNG mutate.
- **Session** — đọc status + usage (tile 1/2/4/6/8).
- **Agent** — roster (tile 6).
- **MCP Connection** (`McpServerSnapshot`) — status (tile 7).
- **Git repo** — branch/dirty/ahead-behind (tile 5).

## Open questions

| ID | Câu hỏi | Cho ai | Đề xuất |
|---|---|---|---|
| OQ-1 | Tile Git cần per-repo summary **nhiều project/repo**, nhưng `useGitStore` ui-next hiện chỉ giữ state của **1 repo đang chọn** (`workspaceRoot()` theo `currentProjectId` + `selectedRepoLabel`). Lấy summary nhiều repo bằng cách nào? | TL | (A) Thêm getter nhẹ `repoSummaries()` gọi `git.status` per repo đã `discoverRepos` (cap số repo, đọc-only, không đổi state đang chọn). (B) Thêm RPC `dashboard.git` trả summary mọi project repo (1 round-trip). (C) MVP chỉ hiện repo của project đang active (1-2 repo) — đơn giản nhất, đúng prototype. **BA nghiêng (C) cho MVP**, mở rộng (A/B) sau. |
| OQ-2 | Nút "Approve"/"Review" trên tile Attention: chỉ điều hướng hay resolve tại chỗ? | PO | Đề xuất **chỉ điều hướng** sang `/tasks` `/sessions` (đọc-only Home, đỡ trùng logic gate). Resolve thực hiện ở trang đích. |
| OQ-3 | Status agent "Xm ago" = "lần dùng gần nhất" lấy từ đâu? Hiện chưa có index "agent → last used". | TL | (A) MVP chỉ phân biệt **working / idle** (bỏ "Xm ago", hiện "—" hoặc "idle"). (B) Derive "last used" từ `updatedAt` của session/task gần nhất có agent đó (đắt, cần quét). **BA nghiêng (A)** cho MVP. |
| OQ-4 | Tile Attention khi rỗng: ẩn cả tile hay hiện empty card? | PO/designer | Đề xuất **hiện empty card** "Không có gì cần xử lý" (giữ layout bento ổn định, không nhảy grid). |
| OQ-5 | Cadence refresh `dashboard.usage` chính xác (debounce/interval/focus)? | TL | Đề xuất: fetch khi mount Home + debounce ≥30s theo dirty event + on-focus nếu > 60s; KHÔNG timer nền ngoài Home. |

## Test scenarios (input cho QA)

- **TS-1 (attention):** Tạo 1 session question pending + 1 task waiting_approval → tile Attention hiện 2 acard; count 2. Trả lời session → còn 1 (live).
- **TS-2 (running count):** 2 task running + 1 session streaming → big number 3; subline "2 task · 1 session · ~Xk tok/min". Hủy 1 task → big number 2 (live).
- **TS-3 (running tasks progress):** Task 5 node, 3 completed → ritem "Node 3/5", bar 60%, "60%". Một phase completed (`task.phase.status`) → "Node 4/5", 80% (live).
- **TS-4 (activity buckets):** Chạy vài turn trong 2h gần nhất → bucket cuối tăng; `today` = tổng input+output+cacheRead+cacheWrite; `.u2` đúng dấu so yesterday.
- **TS-4b (usage guardrail):** Session JSONL rất lớn (giả lập nhiều dòng), message mới nhất < 48h → `dashboard.usage` trả nhanh, KHÔNG đọc toàn file (verify số dòng đọc bounded / không OOM).
- **TS-4c (no usage):** Workspace mới, 0 message có usage → `today=0`, sparkline phẳng, delta ẩn, không lỗi.
- **TS-5 (git):** Repo có 7 file M + ahead 2 → chip "7 M" + "↑2". Sửa thêm file (`git:status:changed`) → count cập nhật. Repo sạch → "clean".
- **TS-5b (no repo):** Project không repo → tile Git "Chưa có repo", không crash.
- **TS-6 (agents):** Task running dùng agent tech-lead → tile Agents tech-lead "working"; agent khác "idle/—". Task xong → tech-lead về idle (live).
- **TS-7 (connections):** github running, linear idle, 1 server error → dot xanh/faint/đỏ + label tương ứng. `mcp.status` đổi → dot cập nhật; KHÔNG hiện lastError raw.
- **TS-8 (recent):** 5 session trạng thái khác nhau → dot màu + "đang chờ/đang chạy/xong · age" đúng; session mới updatedAt → lên đầu (live).
- **TS-9 (mock parity):** `pnpm dev` browser → 8 tile render seed, 0 IPC call, 0 console error; `dashboard.usage` không gọi.
- **TS-10 (security):** Inspect payload `dashboard.usage` → chỉ số, KHÔNG text/token/path; tile Connections error → KHÔNG raw error string.
- **TS-11 (sidecar down):** Kill sidecar → tile chuyển "không khả dụng" inline, không crash; restart → hydrate lại.
- **TS-12 (loading):** Mở Home khi store chưa hydrate → tile placeholder/skeleton, KHÔNG hiện số mock cũ.

## Đề xuất tiếp theo

- Spec **Ready for TL**: cần TL chốt OQ-1 (đa-repo git), OQ-3 (agent last-used), OQ-5 (cadence) + xác nhận contract `dashboard.usage` + guardrail tail-read trước khi PM chia task.
- Cần PO chốt OQ-2 (action navigate vs resolve) + OQ-4 (empty card vs ẩn tile).
- Bàn giao **Tech Lead** (skill `write-adr`): xét xem `dashboard.usage` + 3 store mới có cần ADR riêng hay chỉ là wiring theo [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)/[ADR 0048](../decisions/0048-session-index-lazy-load.md) (BA nghiêng: KHÔNG cần ADR mới, là read-path wiring; chỉ note guardrail tail-read).
- Sau TL: **Project Manager** (skill `decompose-tasks`) chia theo surface: (1) sidecar `dashboard.usage`, (2) store `tasks/connections/agents` ui-next, (3) composable `useHomeDashboard` + wiring `pages/index.vue`, (4) i18n keys + empty/loading/error states.

## Liên kết

- Trang: [`pages/index.vue`](../../apps/desktop/ui-next/pages/index.vue) · CSS [`prototype.css`](../../apps/desktop/ui-next/assets/css/prototype.css) · i18n [`home.json`](../../apps/desktop/ui-next/i18n/locales/vi/home.json)
- Store mẫu: [`stores/sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts) · [`stores/git.ts`](../../apps/desktop/ui-next/stores/git.ts)
- Tham chiếu IPC cũ: `apps/desktop/ui/stores/{tasks,workspace,git}.ts`
- Sidecar: [`tasks/emit.ts`](../../apps/desktop/sidecar/src/tasks/emit.ts) · [`types/shared.ts`](../../apps/desktop/sidecar/src/types/shared.ts) · RPC [`tasks.list`](../../apps/desktop/sidecar/src/methods/tasks.list.ts) · [`mcp.list`](../../apps/desktop/sidecar/src/methods/mcp.list.ts) · [`agents.list`](../../apps/desktop/sidecar/src/methods/agents.list.ts)
- ADR: [0024 — Task Execution Engine IPC](../decisions/0024-task-execution-engine-ipc-contract.md) · [0048 — Session index lazy-load](../decisions/0048-session-index-lazy-load.md)
- Liên quan (đừng trùng): [tray-account-usage.md](tray-account-usage.md) (quota per-account)
- [VISION](../../artifacts/VISION.md) · [.claude/rules/security.md](../../.claude/rules/security.md) (invariant #1)
