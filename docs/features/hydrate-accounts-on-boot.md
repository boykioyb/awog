# Feature Spec — Hydrate accounts on boot (fix false "No active account")

- **Loại:** Bug fix UX (false negative).
- **Branch:** `fix/hydrate-accounts-on-boot`
- **Surface:** `apps/desktop/ui-next/` (rebuild). UI cũ `apps/desktop/ui/` KHÔNG trong phạm vi (ghi known-issue).
- **Brief nguồn:** Product Owner (đã chốt scope, xem mục Scope).
- **Liên quan:**
  - Store account/settings: [apps/desktop/ui-next/stores/settings.ts](../../apps/desktop/ui-next/stores/settings.ts)
  - Creator flow: [apps/desktop/ui-next/composables/usePromptCreator.ts](../../apps/desktop/ui-next/composables/usePromptCreator.ts)
  - Layout mount điểm hydrate: [apps/desktop/ui-next/layouts/default.vue](../../apps/desktop/ui-next/layouts/default.vue)
  - Resolver Sessions tham chiếu: [apps/desktop/ui-next/stores/sessions.ts](../../apps/desktop/ui-next/stores/sessions.ts) (`defaultsForNewSession`)

---

## 1. Vấn đề & root cause

Trong `ui-next`, khi user đã kết nối account thật (credentials.json tồn tại trên đĩa) nhưng vào thẳng **Skills → Create-by-chat** mà chưa mở Settings, panel báo sai:

> "No active account. Connect one in Settings."

Đây là **false negative**: state trên đĩa đúng, chỉ là UI chưa nạp.

### Chuỗi nguyên nhân (đã xác minh trong code)

1. `providers` trong `stores/settings.ts:308-312` là **sidecar-truth KHÔNG persist**, khởi tạo `{ accounts: [], activeAccountId: null }` cho cả 3 provider.
2. Chỉ được nạp qua `hydrateFromSidecar()` (RPC `accounts.list`, `settings.ts:390-405`).
3. `hydrateFromSidecar()` CHỈ được gọi ở 3 điểm **muộn**: mở Settings modal, Onboarding, Project LLM defaults. KHÔNG gọi lúc boot / layout mount (`layouts/default.vue` không gọi).
4. 7 page-controller đọc `settings.activeAccount('anthropic')?.id ?? null` → khi store rỗng, trả `null`.
5. `usePromptCreator.send()` (`usePromptCreator.ts:146-152`): khi `sc.available===true` nhưng `accountId==null` → set `error = 'No active account. Connect one in Settings.'` và return.

### Failure modes

| FM | Mô tả | Trạng thái thực tế | Cách xử lý |
|---|---|---|---|
| **FM1** | Không hydrate lúc boot (root cause) | Có account trên đĩa, store rỗng vì chưa mở Settings | Hydrate sớm & toàn cục + guard lazy |
| **FM2** | Thật sự chưa kết nối account nào | Đĩa không có account | Wording "chưa kết nối" |
| **FM3** | Có account nhưng chưa set active | `accounts.length > 0`, `activeAccountId == null` | Wording "chưa chọn active", khác FM2 |
| **FM4** | Hardcode provider `'anthropic'` ở 7 nơi | User chỉ có OpenAI/Google vẫn bị chặn | Helper resolve theo provider active mặc định |

### 7 callsite hardcode `'anthropic'` (FM4)

Tất cả gọi `settings.activeAccount('anthropic')?.id ?? null` — đã grep xác nhận:

- `composables/useSkillsPage.ts:26`
- `composables/useAgentsPage.ts:28`
- `composables/useCommandsPage.ts:33`
- `composables/useRulesPage.ts:26`
- `composables/useHooksPage.ts:25`
- `composables/useConnectionsPage.ts:32`
- `composables/useWorkflowGen.ts:139`

> Lưu ý: `components/agent/AgentEditor.vue:349` dùng `activeAccount(draft.value.provider)` — provider theo agent, KHÔNG hardcode → **không** thuộc FM4, giữ nguyên.

---

## 2. Phạm vi (chốt bởi PO)

### In scope

- **FM1 (bắt buộc):** hydrate accounts **sớm & toàn cục** ở `default.vue` mount khi `sidecar.available`. Async, không block first paint, idempotent, không gọi RPC khi sidecar offline.
- **FM4 (bắt buộc):** trích **một** helper "resolve active creator account" giải theo provider active mặc định (khớp cách Sessions giải), dùng chung 7 nơi. KHÔNG sửa rời rạc từng file.
- **FM3 (chỉ thông báo):** message "chưa chọn active account" khác message "chưa kết nối".
- **FM2 (chỉ thông báo):** wording "chưa kết nối account" khác FM3.
- **Guard lazy trong `send()`:** defense-in-depth — khi `!accountId` nhưng `sc.available`, `await hydrateFromSidecar()` rồi re-check trước khi báo lỗi. KHÔNG thay thế FM1.

### Out of scope

- Đổi cơ chế persist accounts (giữ sidecar-truth không persist).
- UX chọn active account trong Settings.
- Auto-connect / auto-select account.
- UI cũ `apps/desktop/ui/` — để known-issue.

### Invariant bảo mật (bắt buộc)

- Token / API key **KHÔNG** rời sidecar. `accounts.list` chỉ trả safe view (`ProviderAccount`: fingerprint, label, models, baseURL, status — không có key). Hydrate chỉ nạp safe view này. (Invariant #1.)

---

## 3. Trả lời Open Questions (đọc code Sessions thật)

### OQ1 — "Provider active mặc định" khi giải account cho creator

**Nguồn sự thật:** `sessions.ts` → `defaultsForNewSession()` (dòng 1094-1121), là logic Sessions dùng để chọn account cho một session MỚI.

Sessions giải theo thứ tự:

```
provider  = projectLlmDefaults.provider ?? settings.defaults.provider     // (1100-1102)
account   = project-pinned account (nếu còn tồn tại)                        // (1110)
          ?? account.isActive trong provider đó                            // (1111)
          ?? account đầu tiên trong provider đó                            // (1112)
          ?? account[0] bất kỳ (fallback cross-provider)                   // (1113)
```

Trong đó `isActive` được set khi `account.id === providers[provider].activeAccountId` (`useAccounts.ts:64`) → tức bằng `settings.activeAccount(provider)`.

**Kết luận cho helper creator** (không có project context — creator library là global/scope tier, không bind project account):

> **Provider mặc định = `settings.defaults.provider`** (global session default), giống Sessions khi không có project.
> Account = `activeAccount(defaultProvider)` → nếu null, fallback OQ2 bên dưới.

Đây bám ĐÚNG Sessions (bỏ nhánh project-pinned vì creator không có project context), đảm bảo nhất quán: account creator dùng = account một New Session global sẽ dùng.

### OQ2 — Fallback khi provider mặc định chưa có account nhưng provider khác có

Sessions fallback cross-provider ở dòng 1112-1113 (provider-first → any account). Giữ **cùng thứ tự** cho creator để nhất quán, nhưng phân biệt rõ trạng thái để chọn wording:

Thứ tự resolve của helper `resolveCreatorAccount()`:

```
1. activeAccount(defaultProvider)                          → dùng, kind = 'active'
2. accounts[0] của defaultProvider (connected)             → dùng, kind = 'fallback-provider-first'
3. active/first account của BẤT KỲ provider nào có account → dùng, kind = 'fallback-cross-provider'
4. không có account nào ở mọi provider                     → null,  kind = 'none'
```

- Case 1: đường bình thường.
- Case 2 (FM3 biến thể): provider mặc định có account nhưng chưa set active → **vẫn dùng account đầu tiên của provider đó** (không chặn), đồng thời có thể surface hint FM3. Bám Sessions (Sessions cũng lấy `inProvider[0]`).
- Case 3: provider mặc định không có account nào, nhưng provider khác có (vd default=anthropic nhưng user chỉ kết OpenAI) → **dùng account provider khác** (bám Sessions dòng 1113). Đây là điểm chính FM4 sửa: KHÔNG còn chặn user chỉ có OpenAI/Google.
- Case 4 (FM2): thật sự trắng → null → wording "chưa kết nối".

**Wording FM3 vs FM2** (tiếng Anh trong UI theo convention code, message hiển thị cho user):

- **FM2 (case 4, `kind='none'`):** `"No account connected. Connect a provider in Settings."`
- **FM3 (case 2, provider mặc định có account nhưng chưa active):** `"No active account for <Provider>. Set one active in Settings."` — chỉ là hint; creator VẪN chạy được với account fallback nếu có (không hard-block, đồng nhất Sessions).

> Ghi chú: vì case 2 và case 3 helper VẪN trả account dùng được, `send()` sẽ chạy được. FM3 message chỉ áp dụng khi UI muốn cảnh báo "bạn chưa chọn active nhưng chúng tôi dùng tạm account X" HOẶC khi provider mặc định có account nhưng không có provider nào khác được chọn dùng. Quyết định cuối: **hard-block chỉ ở case 4 (`none`)**; case 2/3 là hint mềm không chặn — nhất quán Sessions (Sessions không bao giờ hard-block khi còn account nào đó).

---

## 4. Persona chịu tác động

- **Người dùng đã kết nối 1 account (Anthropic):** vào thẳng Skills/Agents/Commands/Rules/Hooks/Connections/Workflow-gen → phải chạy được ngay, không thấy false error.
- **Người dùng chỉ kết nối OpenAI hoặc Google:** creator phải dùng account đó, không bị chặn bởi hardcode `'anthropic'` (FM4).
- **Người dùng chưa kết nối gì (FM2):** thấy message rõ ràng "chưa kết nối" + hướng vào Settings.
- **Người dùng có account nhưng chưa active (FM3):** thấy hint đúng loại, không nhầm với "chưa kết nối".
- **Dev chạy browser (không sidecar):** không có RPC, giữ message "Engine offline".

---

## 5. User flows

### UF1 — Boot → vào thẳng Skills → Create-by-chat (đường hạnh phúc, sửa FM1)

1. App khởi động, `default.vue` mount.
2. Layout gọi hydrate accounts async (fire-and-forget) khi `sidecar.available`.
3. User điều hướng ngay tới `/skills` (có thể trước khi hydrate xong).
4. User mở Create-by-chat, gõ prompt, gửi.
5. **Nếu hydrate xong:** `accountId` đã có → chạy bình thường.
6. **Nếu hydrate CHƯA xong (`accountId==null`):** guard lazy trong `send()` `await hydrateFromSidecar()` → re-check → có account → chạy. User KHÔNG thấy error giả.

### UF2 — Người dùng chỉ có OpenAI (sửa FM4)

1. `settings.defaults.provider` có thể vẫn là `'anthropic'` (default).
2. Helper resolve: anthropic không có account → fallback cross-provider → OpenAI account.
3. Creator chạy với OpenAI account. Không báo "No active account".

### UF3 — Chưa kết nối account nào (FM2)

1. Hydrate xong, mọi provider trống.
2. `send()` guard: `await hydrateFromSidecar()` → vẫn trống → hiển thị "No account connected. Connect a provider in Settings."

### UF4 — Có account nhưng chưa active (FM3)

1. `accounts.length > 0`, `activeAccountId == null` cho provider mặc định.
2. Helper trả account fallback (provider-first) → creator chạy được.
3. UI có thể surface hint mềm "No active account for <Provider>" (không chặn).

---

## 6. Acceptance Criteria (Given/When/Then)

### FM1 — Hydrate sớm & toàn cục

**AC-FM1.1**
- **Given** app khởi động và `sidecar.available === true`
- **When** `default.vue` mount
- **Then** hệ thống gọi `hydrateFromSidecar()` async một lần, KHÔNG block first paint (không `await` chặn render), và store `providers` được nạp từ `accounts.list`.

**AC-FM1.2 (idempotent)**
- **Given** hydrate đã chạy ở boot
- **When** một điểm khác (Settings modal / Onboarding / Project LLM defaults) gọi lại `hydrateFromSidecar()`
- **Then** không lỗi, không phá state (hydrate ghi đè bằng cùng dữ liệu từ sidecar), không nhân đôi account.

**AC-FM1.3 (offline)**
- **Given** `sidecar.available === false` (browser-dev)
- **When** `default.vue` mount
- **Then** KHÔNG gọi RPC `accounts.list`; store giữ giá trị khởi tạo; không lỗi console.

**AC-FM1.4 (không thấy false error)**
- **Given** đĩa có 1 account Anthropic connected, chưa mở Settings
- **When** user vào thẳng `/skills` → Create-by-chat → gửi prompt
- **Then** KHÔNG hiển thị "No active account"; turn chạy bình thường.

### FM4 — Helper resolve dùng chung 7 nơi

**AC-FM4.1**
- **Given** codebase
- **When** review 7 callsite (`useSkillsPage`, `useAgentsPage`, `useCommandsPage`, `useRulesPage`, `useHooksPage`, `useConnectionsPage`, `useWorkflowGen`)
- **Then** không còn literal `activeAccount('anthropic')`; tất cả dùng chung một helper resolve provider-agnostic.

**AC-FM4.2**
- **Given** user chỉ kết nối 1 account OpenAI, `settings.defaults.provider === 'anthropic'`
- **When** mở Create-by-chat và gửi
- **Then** helper trả account OpenAI; turn chạy; không báo "No active account".

**AC-FM4.3 (bám Sessions)**
- **Given** provider mặc định `settings.defaults.provider` có account active
- **When** helper resolve
- **Then** account trả về === `settings.activeAccount(defaultProvider)` (giống nhánh `inProvider.find(isActive)` của `defaultsForNewSession`).

### FM3 — Wording "chưa active"

**AC-FM3.1**
- **Given** provider mặc định có ≥1 account nhưng `activeAccountId == null`, và không provider nào khác có account
- **When** creator resolve/gửi
- **Then** account fallback (provider-first) được dùng (không hard-block); nếu không dùng được, message hiển thị = "No active account for <Provider>. Set one active in Settings." (KHÁC message FM2).

### FM2 — Wording "chưa kết nối"

**AC-FM2.1**
- **Given** không provider nào có account (`kind='none'`)
- **When** user gửi trong creator (sidecar available)
- **Then** hiển thị "No account connected. Connect a provider in Settings." (KHÁC message FM3).

### Guard lazy trong `send()`

**AC-GUARD.1**
- **Given** `sc.available === true` và `config.accountId() === null` (hydrate chưa xong)
- **When** `send()` được gọi
- **Then** `send()` `await hydrateFromSidecar()`, re-check `config.accountId()`; nếu giờ có account → tiếp tục gửi (KHÔNG báo lỗi).

**AC-GUARD.2**
- **Given** sau khi `await hydrateFromSidecar()` vẫn `accountId === null`
- **When** re-check
- **Then** hiển thị message FM2/FM3 phù hợp (không phải "Engine offline").

**AC-GUARD.3 (offline vẫn đúng)**
- **Given** `sc.available === false`
- **When** `send()`
- **Then** giữ message "Engine offline — chat unavailable. Run the desktop app." (không đổi), KHÔNG gọi hydrate.

**AC-GUARD.4 (không double-hydrate song song)**
- **Given** hydrate boot đang chạy dở khi `send()` gọi hydrate lazy
- **When** cả hai chạy
- **Then** không lỗi; kết quả cuối nhất quán (xem edge case EC2). Chấp nhận 2 lần `accounts.list` (idempotent) HOẶC dedup bằng in-flight promise (khuyến nghị, xem Open note kỹ thuật cho tech-lead).

---

## 7. Edge cases

| ID | Tình huống | Kỳ vọng |
|---|---|---|
| EC1 | Sidecar offline (browser-dev) | Không RPC lúc boot; `send()` giữ message "Engine offline"; không lỗi. |
| EC2 | Hydrate boot đang chạy khi user mở creator và bấm gửi | Guard lazy `await hydrateFromSidecar()`; nếu boot-hydrate + lazy-hydrate chạy song song, state cuối vẫn đúng (ghi đè cùng data). Khuyến nghị dedup in-flight. |
| EC3 | Nhiều provider có account, default=anthropic | Helper ưu tiên anthropic active; nếu anthropic không active nhưng OpenAI active → theo thứ tự resolve (provider-first của default trước, rồi cross-provider). |
| EC4 | Account bị xóa ở Settings trong khi creator đang mở | `accountId` computed reactive → thành null nếu account biến mất; lần gửi kế tiếp guard lazy re-hydrate; nếu hết account → FM2 message. |
| EC5 | `accounts.list` RPC lỗi/timeout lúc boot | `hydrateFromSidecar` đã `try/catch` + `console.warn`; store giữ rỗng; guard lazy sẽ thử lại khi gửi. Không crash boot. |
| EC6 | Provider mặc định có account connected nhưng `status==='expired'` | Bám hành vi Sessions: `activeAccount` trả account bất kể status (chỉ `isProviderConnected` mới check `connected`). Creator vẫn resolve account đó; lỗi auth (nếu có) sẽ đến từ RPC author, không phải false negative ở đây. (Không mở rộng scope: KHÔNG thêm check status mới.) |
| EC7 | User đổi `settings.defaults.provider` sau khi mở creator | `accountId` computed reactive theo provider mặc định → cập nhật ngay lần gửi kế. |
| EC8 | Concurrent: mở 2 tab creator (Skills + Agents) cùng lúc trước khi hydrate | Cả hai đọc cùng store; hydrate một lần đủ; guard lazy an toàn nếu store còn rỗng. |
| EC9 | credentials.json tồn tại nhưng account bị revoke phía provider | Ngoài scope wording; account vẫn list (status có thể `expired`), lỗi thật đến khi gọi author RPC. Không phải false negative UI. |

---

## 8. Dependencies

### Entity / store hiện có

- **`settings.providers`** (`stores/settings.ts`): nguồn state accounts, không persist.
- **`settings.hydrateFromSidecar()`**: RPC `accounts.list` → safe view.
- **`settings.activeAccount(provider)`**: getter dùng lại trong helper.
- **`settings.defaults.provider`** (`SessionDefaults`): quyết định provider mặc định (OQ1).
- **`useSidecar()`**: `available` flag + `request`.
- **`ProviderAccount`** type (safe view — không chứa key).

### Consumer sẽ đổi (7 file)

`useSkillsPage.ts`, `useAgentsPage.ts`, `useCommandsPage.ts`, `useRulesPage.ts`, `useHooksPage.ts`, `useConnectionsPage.ts`, `useWorkflowGen.ts` — chuyển sang helper chung.

### Không đụng

- `AgentEditor.vue:349` (`activeAccount(draft.value.provider)`) — provider theo agent, giữ nguyên.
- Cơ chế persist, Settings UX, auto-connect.
- Sidecar (không đổi RPC; chỉ đọc `accounts.list` sẵn có).

### AWOG-specific checklist

- **Local-first / offline:** AC-FM1.3, EC1 — không RPC khi offline.
- **Restart-safe:** hydrate lại mỗi boot; không state cần resume.
- **Approval gate:** không chạm.
- **Trace/event log:** không persist event mới; hydrate là read-only `accounts.list`.
- **Git workspace:** không auto-commit gì.
- **Tray/notification:** không notify.
- **Multi-task concurrent:** EC8 — nhiều creator dùng chung store, an toàn.
- **Security invariant #1:** chỉ nạp safe view; token/key không rời sidecar. (Cần infosec xác nhận `accounts.list` không leak.)

---

## 9. Ghi chú kỹ thuật cho Tech Lead (không quyết ở BA, để TL chốt)

Các điểm cần TL/dev quyết khi thiết kế (không phải open question sản phẩm):

1. **Vị trí helper resolve:** một composable mới (vd `useCreatorAccount()`) hay một getter trong `settings` store? Đề xuất: getter/composable đọc `settings` — trả `{ accountId, provider, kind }` với `kind ∈ 'active'|'fallback-provider-first'|'fallback-cross-provider'|'none'`.
2. **Dedup hydrate in-flight:** khuyến nghị giữ một `Promise` in-flight trong store để boot-hydrate và guard-lazy-hydrate không gọi `accounts.list` 2 lần song song (EC2). YAGNI-check: nếu idempotent đủ rẻ, có thể bỏ qua — TL cân nhắc.
3. **Điểm mount hydrate:** `default.vue` `onMounted` (đã có sẵn block onMounted).
4. **Message mapping FM2/FM3:** đặt ở `usePromptCreator` dựa trên `kind` trả về từ helper (creator cần biết `kind` để chọn wording) — hoặc caller truyền message. Giữ single source of wording.

> **→ Đã chốt ở §12 (Quyết định kỹ thuật — TL).**

---

## 10. Known issue (out of scope, ghi lại)

- UI cũ `apps/desktop/ui/` có cùng lớp bug (không hydrate boot) — KHÔNG sửa lần này theo chốt PO.

---

## 11. Open questions còn lại

Không còn open question sản phẩm chặn — OQ1 & OQ2 đã trả lời dựa trên `defaultsForNewSession`. Điểm cần TL chốt đã liệt kê ở §9 (thuộc kiến trúc, không phải sản phẩm) — **đã chốt ở §12**.

**Đề xuất chuyển tiếp:** → `project-manager` (decompose-tasks) rồi `tech-lead` chốt §9, sau đó `developer`. Cần `infosec` xác nhận `accounts.list` safe view (invariant #1) khi PR chạm hydrate.

---

## 12. Quyết định kỹ thuật (TL)

> Chốt T1 trong [hydrate-accounts-on-boot.tasks.md](./hydrate-accounts-on-boot.tasks.md). **Không cần ADR mới** (xác nhận lại chốt PO): không thêm dependency, không đổi IPC protocol/event schema/data shape entity, không đổi cơ chế persist/async/approval. Đây là bug fix UX + trích helper thuần trong renderer — thuộc "refactor nội bộ + bug fix" theo tiêu chí "khi nào KHÔNG cần ADR". Ghi lại làm design note ngay trong spec.

### 12.1 — Vị trí helper `resolveCreatorAccount` (§9.1)

**Quyết định: getter thuần trong `settings` store**, tên `resolveCreatorAccount()`, export cùng `activeAccount`.

- **Chữ ký:** `resolveCreatorAccount(): { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }`
- **Kiểu:** `type CreatorAccountKind = 'active' | 'fallback-provider-first' | 'fallback-cross-provider' | 'none'` — khai trong `settings.ts` (data shape của store, không phải type UI dùng chung → không đẩy vào `types/index.ts`).
- **`provider` trả về** = provider của account được chọn (case cross-provider trả provider thật của account đó, KHÔNG phải `defaults.provider`). Ở `kind='none'` trả `settings.defaults.provider` (để wording FM2/FM3 vẫn có tên provider mặc định nếu cần).
- **`accountId`** = id account chọn được, hoặc `null` khi `kind='none'`.

**Vì sao store getter, không phải composable mới:**
- Helper chỉ đọc `settings.providers` + `settings.defaults.provider` (đều đã là `ProviderName` lowercase) + tái dùng getter `activeAccount(provider)` sẵn có. Đây là **derived state của chính store settings** → thuộc về store (SRP: settings store là bounded context của account state). Đặt vào composable riêng sẽ phải inject store, thêm một khái niệm mới mà không thêm giá trị (KISS/YAGNI).
- Sessions cũng đặt logic tương đương (`defaultsForNewSession`) trong store `sessions`, không phải composable riêng → nhất quán pattern.
- Getter là sync (không async, không IPC) → callsite bọc `computed(() => settings.resolveCreatorAccount())` giữ reactivity (EC4/EC7). **Encapsulation OK:** getter là function đọc reactive state, gọi trong `computed` sẽ track đúng dependency (`providers[*].accounts`, `activeAccountId`, `defaults.provider`).

**Thuật toán (bám `defaultsForNewSession` sessions.ts:1107-1114, bỏ nhánh project-pinned):**

```
const p = defaults.provider                              // ProviderName lowercase
1. activeAccount(p)                       → { id, p, 'active' }
2. providers[p].accounts[0]               → { id, p, 'fallback-provider-first' }
3. duyệt ['anthropic','openai','google'] theo thứ tự cố định:
   provider đầu tiên có account → activeAccount(q) ?? accounts[0]
                                          → { id, q, 'fallback-cross-provider' }
4. không có gì                            → { null, p, 'none' }
```

> Lưu ý so Sessions: Sessions dùng `accounts.value[0]` (flat, cross-provider bất kỳ) cho fallback cuối. Helper duyệt provider theo thứ tự cố định `anthropic → openai → google` để **deterministic** (Sessions' `accounts.value` là mảng phẳng đã gộp, thứ tự khác). Kết quả tập account giống nhau; chỉ cần đảm bảo "provider mặc định trước, rồi cross-provider" — AC-FM4.3 vẫn thỏa vì case 1 khớp `activeAccount(defaultProvider)`.

### 12.2 — Dedup hydrate in-flight (§9.2)

**Quyết định: CÓ dedup bằng in-flight promise cache trong `hydrateFromSidecar`.** Không đổi chữ ký public (`(): Promise<void>`), chỉ thêm state nội bộ store.

```
let inFlight: Promise<void> | null = null

async function hydrateFromSidecar(): Promise<void> {
  const sidecar = useSidecar()
  if (!sidecar.available) return
  if (inFlight) return inFlight          // dedup: reuse đang chạy
  inFlight = (async () => {
    try { /* accounts.list → merge providers (giữ nguyên logic hiện tại) */ }
    catch (err) { console.warn('[settings] hydrateFromSidecar failed', err) }
    finally { inFlight = null }
  })()
  return inFlight
}
```

- **Vì sao dedup (không chấp nhận idempotent 2 call):** boot-hydrate fire-and-forget + guard-lazy `await` trong `send()` là **race thực tế đường hạnh phúc** (UF1 bước 6), không phải case hiếm. Dedup rẻ (~8 dòng), loại hẳn 2 RPC song song + double-merge reactive (tránh flicker computed). Chữ ký không đổi → T4/T5 không phụ thuộc thay đổi API (khử risk ghi ở T1). Đây là đúng chỗ áp "Fail-safe cho race" — nằm trong 1 hàm, không rò khái niệm ra ngoài.
- **Không cần** cache kết quả sau khi xong (không giữ `inFlight` sau resolve): mỗi lần gọi mới (Settings mở lại, guard lazy lần 2) VẪN nên re-fetch để bắt account mới kết nối. Chỉ dedup **khi đang bay**, không memo vĩnh viễn. Idempotent-merge hiện tại lo phần "gọi lại nhiều lần an toàn" (AC-FM1.2).
- **Guard lazy trong `send()`** gọi `await settings.hydrateFromSidecar()` → tự nhiên nhận promise dedup nếu boot đang chạy (AC-GUARD.4/EC2).

### 12.3 — Điểm mount hydrate boot (§9.3)

**Quyết định: `default.vue` `onMounted` (block đã tồn tại, dòng 106-109).** Fire-and-forget, KHÔNG `await`.

```
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  initResponsiveShell()
  // FM1: hydrate account safe-view sớm & toàn cục. Fire-and-forget — không block
  // first paint. hydrateFromSidecar tự no-op khi sidecar offline (AC-FM1.3) và
  // tự dedup nếu bị gọi lại (§12.2). Nuốt lỗi ở đây vì hàm đã try/catch nội bộ.
  void useSettingsStore().hydrateFromSidecar()
})
```

- **Vì sao `default.vue`, không phải plugin/app.vue:** layout `default.vue` là single app-lifetime mount đã chứa các global khởi tạo (`useNativeNotify`, `useTrayStatus`, `useGlobalShortcuts`) → đúng chỗ theo pattern hiện có (Least Astonishment). Plugin sẽ chạy quá sớm (trước khi Pinia/ sidecar bridge sẵn sàng ổn định) và tách khỏi nơi các boot-side-effect khác đang sống.
- **Điều kiện `sidecar.available`:** KHÔNG check ở callsite — `hydrateFromSidecar()` đã tự `return` sớm khi offline (`settings.ts:392`). Gọi trần giữ callsite mỏng, không lặp guard (DRY). AC-FM1.3 thỏa vì hàm không RPC khi offline.
- **`void`** trước call: cố ý fire-and-forget, khỏi cần `.catch` (hàm nuốt lỗi nội bộ, EC5). Không block first paint (AC-FM1.1).

### 12.4 — Mapping wording FM2/FM3 (§9.4)

**Quyết định: helper trả `kind` (+ provider); `usePromptCreator.send()` map `kind` → string.** Helper KHÔNG trả sẵn chuỗi hiển thị.

- **Vì sao helper trả `kind`, không trả string:** SoC — store settings không nên biết wording UI (i18n/tiếng người dùng là việc của lớp trình bày). `kind` là dữ liệu phân loại; string là view concern. Điều này cũng để callsite khác (không phải creator) dùng lại `resolveCreatorAccount()` mà không bị dính message của creator.
- **Nơi map:** trong `usePromptCreator.send()`. Config `PromptCreatorConfig` đổi `accountId: () => string | null` **thành** một getter trả cả kind, hoặc thêm getter `resolve: () => { accountId, provider, kind }`. **Quyết định cụ thể:** thay `accountId` bằng `account: () => { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }` (getter reactive, callsite bind `() => settings.resolveCreatorAccount()`). `send()` đọc `config.account()`.
- **Logic `send()` (thay dòng 146-152):**

```
if (!sc.available) { error = 'Engine offline — chat unavailable. Run the desktop app.'; return }  // AC-GUARD.3, KHÔNG hydrate
let { accountId, provider, kind } = config.account()
if (!accountId) {
  await settings.hydrateFromSidecar()          // guard lazy (dedup §12.2)
  ;({ accountId, provider, kind } = config.account())   // re-check reactive
}
if (!accountId) {                              // vẫn null sau hydrate
  error = kind === 'none'
    ? 'No account connected. Connect a provider in Settings.'                              // FM2
    : `No active account for ${PROVIDER_DISPLAY[provider] ?? provider}. Set one active in Settings.`  // FM3
  return
}
// ... tiếp tục gửi với accountId
```

- **Nguồn tên `<Provider>`:** dùng `PROVIDER_DISPLAY` (đã export ở `composables/useSessionsData.ts:400`) — single source, không hardcode chuỗi mới. `PROVIDER_DISPLAY['anthropic'] → 'Anthropic'`, v.v.
- **Wording là single source** trong `send()` (chỉ 2 literal, không lặp ở nơi khác). `usePromptCreator` là composable chung 7 nơi → wording tự động thống nhất.
- **Hard-block chỉ khi `!accountId`** (case 4 `none`, hoặc trắng sau hydrate). Case 2/3 helper trả account dùng được → `accountId != null` → KHÔNG rơi vào nhánh error → creator chạy (hint FM3 mềm; nếu muốn surface hint không chặn thì panel đọc `kind` riêng — ngoài phạm vi bắt buộc, chỉ khi UI cần).

### 12.5 — Import boundary cần lưu ý (dev)

- `usePromptCreator.ts` hiện KHÔNG import `settings` store (chỉ nhận `config`). Sau đổi, `send()` cần `settings.hydrateFromSidecar()` → import `useSettingsStore` vào composable. Chấp nhận: guard lazy là hành vi của creator, không thể để callsite tự lo (mọi callsite sẽ lặp). Giữ `hydrateFromSidecar` gọi qua store (SoC — không IPC trực tiếp).
- `PROVIDER_DISPLAY` import từ `~/composables/useSessionsData` — đã là export sẵn, không tạo mapping mới.
- Helper KHÔNG `import fs`/SDK (getter đọc reactive state thuần) — SoC OK.
