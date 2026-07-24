# QA Test Cases — Hydrate accounts on boot

> Feature spec: [hydrate-accounts-on-boot.md](./hydrate-accounts-on-boot.md) (§6 AC, §7 edge cases, §12 design)
> Plan: [hydrate-accounts-on-boot.tasks.md](./hydrate-accounts-on-boot.tasks.md) — task **T7**.
> Surface: `apps/desktop/ui-next/` only. UI cũ `apps/desktop/ui/` là known-issue (§10) — không test.
> Stack: không có test runner (không vitest/jest trong `ui-next`) → **manual only**. Static verify qua `pnpm typecheck` + `pnpm lint`.

## Cách chuẩn bị state cho test

- **Có account thật:** kết nối 1 account ở Settings → Accounts (ghi vào `~/.awog/credentials.json`). Không mở lại Settings sau khi restart để giữ store rỗng lúc boot.
- **Trắng account:** xoá hết account ở Settings, hoặc rename `credentials.json` tạm.
- **Offline / browser-dev:** chạy `pnpm dev` và mở `http://localhost:3030` trong browser thường (không qua Electron) → `useSidecar().available === false`.
- **Đổi default provider:** Settings → LLM defaults → provider (state `settings.defaults.provider`).
- **Mô phỏng hydrate chậm (EC2/AC-GUARD.4):** DevTools → Network throttle, hoặc tạm thêm `await new Promise(r=>setTimeout(r,3000))` đầu `hydrateFromSidecar` cục bộ (revert sau) để mở creator + Send trước khi boot-hydrate xong.

---

## Golden path

- **TC-G1 (AC-FM1.4).** Có 1 account Anthropic connected trên đĩa, KHÔNG mở Settings. Restart app → điều hướng thẳng `/skills` → Create-by-chat → gõ prompt → Send.
  - Expected: KHÔNG hiện "No active account"/"No account connected". Turn chạy (stream chunk/step). Nếu boot-hydrate xong trước Send → chạy ngay; nếu chưa → guard lazy hydrate rồi chạy, user không thấy error giả.
- **TC-G2 (AC-FM1.1).** Restart app, sidecar available. Quan sát first paint + Network.
  - Expected: layout render ngay (không chờ RPC). `accounts.list` được gọi async đúng 1 lần lúc mount, không block UI.

## FM4 — helper provider-agnostic

- **TC-FM4-1 (AC-FM4.1, static).** `rg "activeAccount\('anthropic'\)" apps/desktop/ui-next/composables/` → 0 kết quả. `AgentEditor.vue:349` vẫn `activeAccount(draft.value.provider)`.
- **TC-FM4-2 (AC-FM4.2).** Chỉ kết nối 1 account **OpenAI**, `settings.defaults.provider === 'anthropic'`. Vào `/skills` → Create-by-chat → Send.
  - Expected: resolver trả account OpenAI (kind `fallback-cross-provider`). Turn chạy. KHÔNG "No active account".
- **TC-FM4-3 (AC-FM4.3, bám Sessions).** default provider = anthropic, có account anthropic active. So account resolver dùng vs account New Session (global) chọn.
  - Expected: cùng account = `settings.activeAccount('anthropic')`. kind = `active`.
- **TC-FM4-4 (EC3).** Nhiều provider có account, default=anthropic, anthropic KHÔNG active nhưng có account.
  - Expected: dùng `providers.anthropic.accounts[0]` (kind `fallback-provider-first`), KHÔNG nhảy sang provider khác dù provider khác active. (provider-first trước cross-provider.)
- **TC-FM4-5 (Workflow-gen).** `/workflows` gen bằng chat, chỉ có account OpenAI.
  - Expected: `useWorkflowGen` dùng account OpenAI id; không fallback mock (mock chỉ khi thật sự null).

## FM3 — có account chưa active

- **TC-FM3-1 (AC-FM3.1).** default provider có ≥1 account nhưng `activeAccountId==null`, không provider nào khác có account. Create-by-chat → Send.
  - Expected: resolver trả account fallback (kind `fallback-provider-first`) → `accountId != null` → **creator VẪN chạy** (không hard-block). FM3 wording chỉ hiện khi `accountId` cuối vẫn null.
- **TC-FM3-2 (wording, khó tái hiện tự nhiên).** Nếu buộc `accountId===null` mà `kind !== 'none'`: message = `"No active account for <Provider>. Set one active in Settings."` với `<Provider>` map qua `PROVIDER_DISPLAY` (Anthropic/OpenAI/Google). Khác hẳn message FM2.

## FM2 — chưa kết nối gì

- **TC-FM2-1 (AC-FM2.1).** Xoá hết account (mọi provider trắng), sidecar available. Create-by-chat → Send.
  - Expected: sau guard lazy hydrate vẫn trắng → kind `none` → message `"No account connected. Connect a provider in Settings."`. KHÁC FM3, KHÁC "Engine offline".

## Guard lazy trong send()

- **TC-GUARD-1 (AC-GUARD.1).** sidecar available, `config.account().accountId===null` (hydrate chưa xong). Send.
  - Expected: `send()` `await hydrateFromSidecar()` → re-read resolver → có account → tiếp tục gửi, KHÔNG báo lỗi.
- **TC-GUARD-2 (AC-GUARD.2).** Sau await hydrate vẫn null (thật sự trắng).
  - Expected: hiện FM2/FM3 theo kind, KHÔNG hiện "Engine offline".
- **TC-GUARD-3 (AC-GUARD.3 / EC1, offline).** Browser-dev, sidecar unavailable. Create-by-chat → Send.
  - Expected: message `"Engine offline — chat unavailable. Run the desktop app."`; KHÔNG gọi `accounts.list` (check Network trắng); không đổi wording.
- **TC-GUARD-4 (AC-GUARD.4 / EC2, dedup).** Mô phỏng hydrate chậm; ngay lúc boot-hydrate đang bay, mở creator + Send (kích guard lazy hydrate).
  - Expected: Network chỉ **1** request `accounts.list` (in-flight promise reuse). State cuối đúng, không double-merge flicker. Send hoàn tất sau khi promise resolve.

## FM1 — hydrate boot

- **TC-FM1-2 (AC-FM1.2, idempotent).** Sau boot-hydrate, mở Settings modal (gọi lại hydrate).
  - Expected: không lỗi, account không nhân đôi, state ghi đè bằng cùng data.
- **TC-FM1-3 (AC-FM1.3, offline boot).** Browser-dev boot.
  - Expected: KHÔNG gọi `accounts.list`; store giữ init (`accounts: [], activeAccountId: null`); console không lỗi.

## Edge / state / regression

- **TC-EC4 (account bị xoá khi creator mở).** Mở creator, sang Settings xoá account đang dùng, quay lại Send.
  - Expected: `account` computed reactive → thành null/đổi; Send guard re-hydrate; nếu hết account → FM2.
- **TC-EC5 (RPC lỗi/timeout lúc boot).** Ép `accounts.list` fail (kill sidecar giữa chừng hoặc throw).
  - Expected: boot không crash; `console.warn('[settings] hydrateFromSidecar failed', …)`; store rỗng; guard lazy thử lại khi Send.
- **TC-EC6 (account expired).** default provider có account `status==='expired'`.
  - Expected: resolver VẪN trả account đó (không thêm check status); false-negative không xảy ra; lỗi auth (nếu có) đến từ author RPC.
- **TC-EC7 (đổi default provider khi creator mở).** Mở creator, đổi `settings.defaults.provider`, Send.
  - Expected: `account` computed cập nhật → account theo provider mới lần Send kế.
- **TC-EC8 (2 creator concurrent).** Mở Skills creator + Agents creator trước khi hydrate xong, Send cả hai.
  - Expected: dùng chung store; hydrate 1 lần đủ (dedup); cả hai chạy đúng.
- **TC-REG-1 (AgentEditor không regress).** Agents → edit agent, đổi provider của agent, generate body.
  - Expected: `AgentEditor.vue:349` vẫn dùng `activeAccount(draft.provider)` theo provider của agent, KHÔNG dùng resolver global.
- **TC-REG-2 (Rules/Hooks/Commands creator).** Chỉ có account OpenAI, tạo Rule/Hook/Command bằng chat.
  - Expected: các creator này nhận `accountId` từ resolver (`account.value.accountId`) → provider-agnostic hoạt động; KHÔNG rơi vào offline-mock khi có account thật.
- **TC-THEME-1.** Lặp TC-FM2-1 + TC-GUARD-3 ở dark và light theme.
  - Expected: error banner đọc được, token màu qua `useTheme()`, không hardcode.

## Static gate

- `pnpm typecheck` → pass.
- `pnpm lint` → 0 error.
- Invariant #1: `accounts.list` (sidecar) map qua `toSafe()` — không có API key/OAuth blob trong safe view nạp vào store. (Xác nhận T6/infosec.)
