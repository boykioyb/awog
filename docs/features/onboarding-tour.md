# Onboarding Wizard + Spotlight Tour

> Màn **first-run setup wizard** (welcome → account → appearance → project → finish)
> + **spotlight tour** (coachmark highlight UI thật từng bước) cho `ui-next`. Mục tiêu: user mới mở
> AWOG lần đầu được dẫn qua đúng 2 thứ tối thiểu để app chạy được (1 LLM account + project đầu tiên),
> rồi được giới thiệu giao diện. Replayable bất cứ lúc nào.

- **Trạng thái:** **Implemented v1 (2026-06-28)** — typecheck + lint xanh; chưa QA runtime trong Electron shell.
- **Owner:** Business Analyst
- **Ngày:** 2026-06-28
- **Phạm vi:** `apps/desktop/ui-next` (UI-only). 2 composable mới + 1 namespace i18n mới + ~3 component group mới + thêm `data-tour` attribute vào vài component shell có sẵn. **KHÔNG cần RPC/sidecar mới**, **KHÔNG thêm dependency**.
- **Liên quan:** [home-dashboard.md](home-dashboard.md) (mẫu format), [models-and-accounts.md](models-and-accounts.md) (account connect — tái dùng), [project-workspace.md](project-workspace.md), [projects.md](projects.md) (sample project), [auto-update.md](auto-update.md) + `useWhatsNew` (mẫu persist cờ "đã xem"), [config-import-assistant.md](config-import-assistant.md)

## Bối cảnh

`ui-next` hiện **boot thẳng vào `/`** không có bất kỳ first-run friction nào (xác nhận: không tìm thấy `onboard`/`welcome`/`tour`/`firstRun` ở đâu). Một user mới cài AWOG mở app ra sẽ thấy bento dashboard rỗng và **không có gợi ý** rằng họ cần (1) chọn workspace path và (2) kết nối ít nhất 1 LLM account thì app mới làm được gì. Đây là rào cản kích hoạt (activation) lớn cho persona **Solo Builder**.

Shell đã có sẵn các điểm neo cần thiết để gắn feature này mà không phải đụng kiến trúc:

- **Mount point globals:** [`layouts/default.vue`](../../apps/desktop/ui-next/layouts/default.vue) §9 (dòng 23–36) là chỗ mount-once mọi overlay app-lifetime (`CommandPalette`, `SettingsModal`, `WhatsNewModal`…). Onboarding host + Tour host slot vào đây.
- **App boot hook:** [`app.vue`](../../apps/desktop/ui-next/app.vue) `onMounted` đã chạy `useTheme().init()` → `initLocale()` → `applyAll(...)`. Thêm `useOnboarding().maybeStart()` vào cuối chuỗi này.
- **Mẫu persist cờ:** [`useWhatsNew.ts`](../../apps/desktop/ui-next/composables/useWhatsNew.ts) — localStorage key + `useState` để đồng bộ in-session + try/catch graceful. Onboarding/Tour copy nguyên pattern này.
- **Mẫu anchored popover:** [`AppSelect.vue`](../../apps/desktop/ui-next/components/common/AppSelect.vue) (dòng 74–98) đã có `getBoundingClientRect()` + flip up/down theo viewport + teleport body. Coachmark tour tái dùng logic định vị này.
- **Account connect:** [`components/settings/`](../../apps/desktop/ui-next/components/settings/) có sẵn `SettingsModels.vue`, `SettingsOAuthDialog.vue`, `SettingsCodexDialog.vue`, `SettingsAccountEditDialog.vue`, `SettingsKeyRow.vue` — wizard reuse, **không** dựng lại flow auth.
- **Workspace path:** [`SettingsWorkspace.vue`](../../apps/desktop/ui-next/components/settings/SettingsWorkspace.vue) + `settings.workspacePath` (store [`settings.ts`](../../apps/desktop/ui-next/stores/settings.ts)).
- **Command palette:** [`CommandPalette.vue`](../../apps/desktop/ui-next/components/common/CommandPalette.vue) build list `PaletteCommand` ([`useCommandPalette.ts`](../../apps/desktop/ui-next/composables/useCommandPalette.ts)) — thêm 1 command "Hướng dẫn sử dụng".

## Mục tiêu

1. **Activation:** user mới hoàn tất 2 bước thiết yếu (workspace + 1 account) ngay lần đầu, không phải tự mò Settings.
2. **Định hướng:** spotlight tour highlight UI thật (NavRail, nút New, ⌘K, Settings…) — dạy đúng chỗ bấm, không phải đọc tài liệu.
3. **Không xâm lấn user cũ:** ai đã có workspace + account rồi thì **không** bị bật wizard (silent mark completed).
4. **Replayable:** chạy lại wizard/tour từ ⌘K Command Palette và Settings bất cứ lúc nào.
5. **Robust với UI đổi:** tour neo theo `data-tour` attribute (không theo CSS class) để không vỡ khi prototype.css đổi.
6. **Theo convention AWOG:** i18n en/vi, theme token (no hardcoded hex), reduced-motion, no new dep, no telemetry.

## Non-goals

- **Không** thêm dependency tour lib (driver.js / shepherd / intro.js) — build engine nhỏ tự viết. Đã chốt: "không thêm dependency khi chưa có ADR".
- **Không** thêm RPC/sidecar mới. Cờ "completed" sống ở localStorage; workspace/account persist qua kênh có sẵn của chúng.
- **Không** telemetry/analytics đếm bước onboarding (invariant #5).
- **Không** simulate data hay "interactive tutorial" (kiểu bắt user thật sự gõ thử) — tour chỉ highlight + giải thích, click "Tiếp".
- **Không** ép buộc: wizard luôn skippable; bỏ qua = đánh dấu completed, không hỏi lại.
- **Không** đụng `apps/desktop/ui` (bản cũ) — chỉ `ui-next`.

## Personas

- **Solo Builder mới cài** (persona chính) — vừa tải app, chưa biết AWOG là gì, chưa cấu hình gì. Cần được dẫn tới "trạng thái dùng được" trong < 2 phút.
- **User cũ nâng cấp** — đã có workspace + account. Tuyệt đối không được nhét wizard vào mặt; nhiều nhất là 1 dot "có tour mới" nếu sau này thêm tour.

---

## Thiết kế

Hai flow tách bạch nhưng nối tiếp nhau:

```
First launch ──► [Onboarding Wizard]  (full-screen modal, nhiều bước)
                        │ finish
                        ▼
                 [Spotlight Tour]      (coachmark trên UI thật)
                        │ end
                        ▼
                  app dùng bình thường

Replay: ⌘K "Hướng dẫn" / Settings → Help  ──► chạy lại Wizard hoặc Tour độc lập
```

### A. State & persistence — `composables/useOnboarding.ts`

Copy pattern [`useWhatsNew.ts`](../../apps/desktop/ui-next/composables/useWhatsNew.ts): helper read/write localStorage + `useState` đồng bộ in-session + try/catch.

```ts
// localStorage (UI state, không nhạy cảm → KHÔNG qua sidecar)
const KEY_COMPLETED = 'awog:onboarding:completed'   // '1' | null
const KEY_TOUR_SEEN = 'awog:tour:seen'              // JSON { [tourId]: '1' } — chỉ marker "đã xem", KHÔNG re-show theo version (OQ-6)

export function useOnboarding() {
  const wizardOpen = useState('onboarding:wizard-open', () => false)
  const completed   = useState('onboarding:completed', () => readCompleted())
  // maybeStart(): gọi 1 lần ở app.vue onMounted
  //   - completed → return
  //   - đã cấu hình sẵn (settings.workspacePath && có ≥1 account) → markCompleted() (user cũ) → return
  //   - else → wizardOpen = true
  // completeOnboarding(): completed=true + persist + (tuỳ) startTour('intro') nếu chưa seen
  // resetOnboarding(): xoá cờ → để replay wizard
}
```

> **Quyết định:** persist **chỉ localStorage** (theo tiền lệ `useWhatsNew`, `useTheme`, project-colors). Cờ này không nhạy cảm, không cần đồng bộ máy. Workspace path đi qua `settings` store (localStorage + payload IPC khi tạo session/task); account đi qua sidecar keychain. Wizard chỉ **điều phối gọi flow có sẵn**, không tự lưu secret (invariant #1).

> **"Đã cấu hình sẵn" check** quan trọng để không phiền user cũ: `maybeStart()` khi `!completed` mà đã có `workspacePath` + ≥1 account → silent `markCompleted()`. Chỉ user thật sự trắng mới thấy wizard.

### B. Onboarding Wizard

**Component:** `components/onboarding/` (group mới)

| File | Vai trò |
|---|---|
| `OnboardingHost.vue` | Mount ở layout §9. `Teleport to="body"`, `.ovl on` full-screen, `z-index: 250`. `v-if="wizardOpen"`. |
| `OnboardingWizard.vue` | Container: step index, progress dots `① ② ③…`, nút Back / Next / Skip-all. Render panel theo step. < 250 dòng → logic vào composable nếu phình. |
| `steps/StepWelcome.vue` | Brand + value prop ngắn (3 gạch đầu dòng: orchestrate agents / sessions+tasks / local-first). CTA "Bắt đầu" + "Bỏ qua". |
| ~~`steps/StepWorkspace.vue`~~ | **ĐÃ GỠ (2026-06-28).** Config home `~/.awog` cố định theo kiến trúc (`awogHome()` = `resolve(homedir(),'.awog')`, không env/param override; mọi credential/agent/skill/setting/task key theo nó). Một màn read-only không-chọn-được không xứng 1 bước wizard → bỏ. Việc chọn folder làm việc thật là bước Project. Đổi vị trí config home = feature riêng cần ADR (sidecar đọc `AWOG_HOME` + restart + migrate). |
| `steps/StepAccount.vue` | **API-key quick-connect tự chứa** (đã implement): provider chọn bằng **segmented control** (KHÔNG `AppSelect` — menu teleport z-130 chui xuống dưới overlay z-250 nên không hiện) + key input → `settings.addApiKeyAccount` (key đi thẳng sidecar, không vào onboarding state). OAuth/Codex để ở Settings → Models (tránh nest dialog dưới overlay). Hiện chip "đã kết nối ✓". Skippable. |
| `steps/StepAppearance.vue` | Theme dark/light + accent + ngôn ngữ en/vi — reuse `useTheme()` + `useI18n()`. Tuỳ chọn, default giữ nguyên. |
| `steps/StepSampleProject.vue` | "Mở folder có sẵn làm project đầu tiên" — fs folder picker → tạo project trỏ vào folder đó. **Không** generate nội dung mẫu (OQ-4). Skippable. |
| `steps/StepFinish.vue` | Tóm tắt đã cấu hình gì + CTA chính "Xem hướng dẫn giao diện" (→ start tour) + phụ "Tạo session đầu tiên" (→ `/sessions`). |

**Quy tắc:**
- Mọi bước **Skippable**; "Bỏ qua tất cả" ở header → `completeOnboarding()` ngay.
- Progress dots + đếm "Bước n/N". Back/Next điều hướng step state (không phải router).
- `Esc` = bỏ qua tất cả (confirm nhẹ nếu đang dở account flow).
- Reduced-motion: tắt transition slide khi `settings.sessions.reducedMotion` hoặc `prefers-reduced-motion`.

### C. Spotlight Tour engine

**Component:** `components/onboarding/TourHost.vue` (mount layout §9) + **composable** `composables/useTour.ts`.

**Engine (`useTour.ts`):**

```ts
type TourStep = {
  id: string
  target: string            // CSS selector → '[data-tour="nav-sessions"]'
  route?: string            // nếu cần điều hướng trước khi hiện step
  titleKey: string; bodyKey: string
  placement?: 'auto' | 'right' | 'bottom' | 'left' | 'top'
}
// startTour(id) / next() / prev() / end()
// - mỗi step: nếu step.route ≠ route hiện tại → navigateTo(step.route),
//   rồi poll RAF tới khi querySelector(target) tồn tại (timeout → skip step + log)
// - định vị: getBoundingClientRect(target) + flip theo viewport (port từ AppSelect)
// - recompute on scroll/resize (throttled rAF) như AppSelect
```

**TourHost render:**
- **Spotlight:** 1 box `position:fixed` khớp rect của target + `box-shadow: 0 0 0 9999px var(--scrim)` (kỹ thuật "khoét lỗ" dep-free) + viền `2px solid var(--accent)` bo góc. `z-index: 250`.
- **Coachmark popover:** card neo cạnh target (port định vị AppSelect), chứa title + body + "Bước n/N" + dots + `[Bỏ qua] [‹ Trước] [Tiếp ›]`. `z-index: 251`.
- **Keyboard:** `→`/`Enter` next, `←` prev, `Esc` end.
- Theme token toàn bộ; reduced-motion tắt transition.

**Anchoring — convention `data-tour`:** thêm attribute vào component shell có sẵn (thay đổi nhỏ, không đụng logic):

| `data-tour` | File | Step |
|---|---|---|
| `nav-rail` | [`NavRail.vue`](../../apps/desktop/ui-next/components/shell/NavRail.vue) `<aside class="side">` | Giới thiệu thanh điều hướng |
| `nav-sessions` | NavRail item `/sessions` | "Chat với agent ở đây" |
| `nav-tasks` | NavRail item `/tasks` | "Việc chạy nền, có gate duyệt" |
| `new-btn` | `components/shell/AppTopBar.vue` nút New | "Tạo session/task mới" |
| `cmdk-hint` | AppTopBar (hoặc search box) | "⌘K mở Command Palette" |
| `settings-btn` | NavRail footer nút settings | "Account, theme, git cấu hình ở đây" |
| `whatsnew-btn` | NavRail footer nút tag | "Xem có gì mới mỗi bản" |
| `composer` | `components/session/SessionComposer.vue` (step cross-route `/sessions`) | "Gõ yêu cầu, Enter để gửi" |
| `workspace-toggle` | nút mở Workspace Panel trong session | "Diff/Files/Terminal ngay trong session" |

> Selector là **hằng số hardcode (L3 trust)** — không có user input vào `querySelector`, không SSRF/injection.

**Tour mặc định `'intro'` (v1 = 6 bước cấp shell — đã chốt):** `nav-rail → nav-sessions → new-btn → cmdk-hint → settings-btn → whatsnew-btn`. Tất cả luôn hiện diện ở mọi route → **không** cần `navigateTo`, không có rủi ro wait-for-element. Bước cross-route (`composer`, `workspace-toggle`) **hoãn sang v2** (OQ-2). Ở compact, bước neo nav item gọi mở drawer (`navOpen=true`) ở `beforeShow` (OQ-3).

### D. Trigger / activation

1. **First run:** [`app.vue`](../../apps/desktop/ui-next/app.vue) `onMounted` → sau `applyAll(...)` gọi `useOnboarding().maybeStart()`.
2. **Sau wizard finish:** `StepFinish` CTA chính gọi `startTour('intro')`.
3. **Replay — Command Palette:** thêm `PaletteCommand { id:'onboarding', label: t('onboarding.cmd.start'), section:'navigate', run: () => startTour('intro') }` vào list ở [`CommandPalette.vue`](../../apps/desktop/ui-next/components/common/CommandPalette.vue). (Thêm cả "Chạy lại setup" → mở wizard.)
4. **Replay — Settings:** thêm block "Trợ giúp" trong [`SettingsAbout.vue`](../../apps/desktop/ui-next/components/settings/SettingsAbout.vue): 2 nút "Chạy lại setup wizard" + "Xem lại tour giao diện". (Giữ trong section `about` cho gọn, không thêm section mới — xem OQ-5.)

### E. i18n

Thêm `i18n/locales/en/onboarding.json` + `i18n/locales/vi/onboarding.json` (glob-merge tự nhặt — [`useI18n.ts`](../../apps/desktop/ui-next/composables/useI18n.ts) dòng 17–35). Key phẳng dotted: `onboarding.welcome.title`, `onboarding.step.workspace.title`, `onboarding.tour.navRail.body`, `onboarding.cmd.start`… **Mọi string qua `t()`**, không hardcode, không lẫn ngôn ngữ.

### F. z-index

Theo band ui-next (modal 100–300, command palette 200, mermaid tooltip 300): **wizard `.ovl` = 250, spotlight = 250, coachmark popover = 251** (đỉnh band modal, dưới mermaid 300). Ghi comment band ở component để tránh drift.

### G. Responsive (compact ≤1100px)

NavRail thành drawer off-canvas ([`useResponsiveShell.ts`](../../apps/desktop/ui-next/composables/useResponsiveShell.ts)). Bước tour neo vào nav item phải `navOpen=true` trước khi định vị (engine gọi mở drawer ở `beforeShow`). Cân nhắc rút gọn tour ở compact — xem OQ-3.

---

## Security (8 invariant)

- **#1 API key không rời sidecar:** wizard account step chỉ mở dialog auth có sẵn (keychain/sidecar). Tuyệt đối **không** ghi key vào `awog:onboarding:*` hay bất kỳ localStorage nào.
- **#8 No eval/dynamic require:** `data-tour` selector là hằng số L3; không nhận selector từ payload.
- **#5 No telemetry:** không gửi tiến trình onboarding đi đâu.
- **#4 IPC boundary:** UI gọi fs picker / accounts qua `window.awog` có sẵn, không import `fs`/SDK.

## Acceptance Criteria

- **AC-1** — *Given* user mới (no `awog:onboarding:completed`, no workspace, no account), *When* mở app, *Then* wizard tự hiện ở bước Welcome.
- **AC-2** — *Given* user cũ (có workspacePath + ≥1 account, no completed flag), *When* mở app, *Then* **không** thấy wizard và cờ completed được set silent.
- **AC-3** — *Given* đang ở wizard, *When* bấm "Bỏ qua tất cả" hoặc `Esc`, *Then* wizard đóng, completed=true, không hỏi lại ở lần mở sau.
- **AC-4** — *Given* hoàn tất wizard, *When* bấm "Xem hướng dẫn", *Then* spotlight tour bắt đầu ở bước `nav-rail`, highlight đúng `<aside class="side">`.
- **AC-5** — *Given* đang ở tour, *When* `→`/`Tiếp`, *Then* sang step kế, spotlight + popover di chuyển khớp target; `Esc` kết thúc tour.
- **AC-6** — *Given* tour đã chạy xong, *When* mở ⌘K gõ "hướng dẫn" hoặc vào Settings → Help, *Then* chạy lại được tour/wizard.
- **AC-7** — *Given* `reducedMotion` bật, *When* chuyển step/bước, *Then* không có animation slide.
- **AC-8** — *Restart-safe:* sau khi completed, reload/restart app **không** bật lại wizard.
- **AC-9** — *Browser-dev (no `window.awog`):* không crash; bước cần fs/account hiển thị trạng thái "cần Electron" thay vì lỗi.
- **AC-10** — Mọi chuỗi hiển thị có ở cả `en` và `vi`; đổi locale đổi ngay ngôn ngữ wizard/tour.

## Quyết định đã chốt (2026-06-28)

- **OQ-1 → Wizard 5 bước:** Welcome → Account → **Appearance** → **Project** (mở folder) → Finish. (Bước Workspace dự kiến ban đầu đã GỠ ngày 2026-06-28: config home `~/.awog` cố định theo kiến trúc nên không có gì để "chọn" — xem bảng component. Giữ Appearance + Project.)
- **OQ-2 → Tour v1 chỉ anchor cấp shell** (6 bước, không cross-route). `composer`/`workspace-toggle` hoãn v2.
- **OQ-3 → Compact tự mở drawer** (`navOpen=true` ở `beforeShow`) cho bước neo nav item — không rút gọn tour.
- **OQ-4 → Sample project = "mở folder có sẵn làm project"** (fs picker → tạo project trỏ folder). KHÔNG generate nội dung mẫu.
- **OQ-5 → Replay nhét vào Settings section `about`** (block "Trợ giúp", 2 nút). Không thêm section mới.
- **OQ-6 → Tour chạy một lần đời** (`KEY_TOUR_SEEN` chỉ là marker, không re-show theo version). What's New lo phần giới thiệu bản mới.

## Task breakdown (nháp cho PM)

1. `useOnboarding.ts` + `useTour.ts` (state, persist, engine định vị) — *dev, M*
2. `OnboardingHost` + `OnboardingWizard` + step container/dots/nav — *dev, M*
3. Step components (Welcome/Workspace/Account/Appearance/SampleProject/Finish) — reuse settings components — *dev, L*
4. `TourHost` (spotlight box-shadow + coachmark popover, port định vị AppSelect) — *dev, M*
5. Thêm `data-tour` vào NavRail/AppTopBar/SessionComposer/workspace toggle — *dev, S*
6. Wire trigger: `app.vue maybeStart`, CommandPalette command, SettingsAbout Help block — *dev, S*
7. i18n `onboarding.json` en/vi — *dev, S*
8. QA: AC-1..AC-10 (đặc biệt restart-safe + user-cũ-không-bị-phiền + reduced-motion) — *qa*
9. infosec quick-scan: không leak key vào localStorage, selector hằng số — *infosec*

## Risk

- **Cross-route tour** (`navigateTo` + chờ element render) là phần dễ flaky nhất → cô lập sau `data-tour` + timeout-skip có log; v1 ưu tiên anchor shell-level.
- **Drift `data-tour`:** nếu dev sau xoá attribute, step im lặng skip → cần ghi convention vào [README ui-next](../../apps/desktop/ui-next/README.md) (hoặc CLAUDE.md) + log warning khi target không tìm thấy.
