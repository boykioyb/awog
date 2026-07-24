# Plan: Hydrate accounts on boot (fix false "No active account")

> Spec: [hydrate-accounts-on-boot.md](./hydrate-accounts-on-boot.md)
> Branch: `fix/hydrate-accounts-on-boot`
> Surface: `apps/desktop/ui-next/` (UI-only). Sidecar không đổi (dùng `accounts.list` sẵn có).
> Kích thước tổng: S (bug fix UX). Không cần ADR mới.

## DAG (thứ tự dependency)

```
T1 (TL chốt §9) ──► T2 (helper resolveCreatorAccount)
                     │
                     ├──► T3 (thay 7 callsite hardcode)      ─┐
                     ├──► T4 (guard lazy + wording send)      ├─► T7 (QA verify AC) ──► T8 (review)
                     └──► T5 (hydrate boot ở default.vue) ────┘
T6 (infosec: accounts.list safe view) ── song song, gate trước T8
T9 (docs update) ── sau T5/T3, song song với T7
```

Đường tới hạn: **T1 → T2 → {T3, T4, T5} → T7 → T8**.

---

## MVP scope

- [ ] **T1. Chốt 4 điểm kỹ thuật §9 (helper location, dedup in-flight, mount point, wording mapping)** — S
  - **Role:** tech-lead
  - **Depends on:** none
  - **Acceptance:** Có quyết định ghi lại (comment PR/issue hoặc note ở đầu file này) cho: (1) helper là composable `useCreatorAccount()` hay getter store, trả `{ accountId, provider, kind }` với `kind ∈ 'active'|'fallback-provider-first'|'fallback-cross-provider'|'none'`; (2) có dedup in-flight promise trong `hydrateFromSidecar` hay chấp nhận idempotent 2 call (YAGNI-check); (3) mount point = `default.vue` `onMounted`; (4) message FM2/FM3 đặt ở `usePromptCreator` dựa trên `kind`. Không mở ADR (đã xác nhận không cần).
  - **Risk:** Nếu chọn dedup in-flight → T5/T4 phụ thuộc chữ ký `hydrateFromSidecar` có thể đổi; chốt sớm để tránh rework.

- [ ] **T2. Trích helper `resolveCreatorAccount` provider-agnostic (bám `defaultsForNewSession`)** — S
  - **Role:** developer
  - **Depends on:** T1
  - **Acceptance:** Helper (composable/getter theo T1) đọc `settings.defaults.provider` + `settings.activeAccount`, resolve theo thứ tự OQ2: (1) `activeAccount(defaultProvider)` → `kind='active'`; (2) `accounts[0]` của defaultProvider → `kind='fallback-provider-first'`; (3) active/first của bất kỳ provider có account → `kind='fallback-cross-provider'`; (4) không có → `null`, `kind='none'`. Trả `{ accountId, provider, kind }`. Không import fs/SDK (SoC). Không hardcode `'anthropic'`. `pnpm typecheck` + `lint` pass.
  - **Risk:** Sai lệch thứ tự resolve so với Sessions → không nhất quán. Đối chiếu trực tiếp `sessions.ts:1094-1121`.

- [ ] **T3. Thay 7 callsite hardcode `activeAccount('anthropic')` dùng helper chung** — S
  - **Role:** developer
  - **Depends on:** T2
  - **Acceptance:** 7 file (`useSkillsPage.ts:26`, `useAgentsPage.ts:28`, `useCommandsPage.ts:33`, `useRulesPage.ts:26`, `useHooksPage.ts:25`, `useConnectionsPage.ts:32`, `useWorkflowGen.ts:139`) chuyển `computed(() => settings.activeAccount('anthropic')?.id ?? null)` sang helper. `rg "activeAccount\('anthropic'\)"` trả 0 kết quả trong `composables/`. `AgentEditor.vue:349` (`activeAccount(draft.value.provider)`) KHÔNG đụng. `accountId` giữ tính reactive (EC4/EC7). Satisfies AC-FM4.1.
  - **Risk:** Có callsite cần cả `provider` (không chỉ `accountId`) — kiểm tra khi refactor, helper trả cả `provider`.

- [ ] **T4. Guard lazy + tách wording FM2/FM3 trong `usePromptCreator.send()`** — S
  - **Role:** developer
  - **Depends on:** T2
  - **Acceptance:** Trong `send()` (`usePromptCreator.ts:146-152`): khi `sc.available && !accountId` → `await hydrateFromSidecar()` rồi re-check `config.accountId()`; nếu có account tiếp tục gửi (AC-GUARD.1). Nếu vẫn null → chọn message theo `kind`: `kind='none'` → `"No account connected. Connect a provider in Settings."` (FM2); provider có account chưa active → `"No active account for <Provider>. Set one active in Settings."` (FM3). Offline giữ nguyên `"Engine offline — chat unavailable. Run the desktop app."`, KHÔNG gọi hydrate (AC-GUARD.3). Hard-block chỉ ở `kind='none'`. Satisfies AC-GUARD.1/.2/.3, AC-FM2.1, AC-FM3.1.
  - **Risk:** Wording phải là single source (§9.4) — không duplicate string; `<Provider>` cần map tên hiển thị đúng.

- [ ] **T5. Hydrate accounts async khi boot ở `default.vue` mount** — S
  - **Role:** developer
  - **Depends on:** T1
  - **Acceptance:** `default.vue` `onMounted` gọi `settings.hydrateFromSidecar()` fire-and-forget CHỈ khi `sidecar.available` (AC-FM1.1). Không `await` chặn first paint. Offline → KHÔNG gọi RPC, không lỗi console (AC-FM1.3). Idempotent với các điểm gọi hiện có (Settings/Onboarding/Project LLM) — AC-FM1.2. Nếu T1 chọn dedup in-flight → hiện thực promise dedup trong `hydrateFromSidecar` (EC2/AC-GUARD.4).
  - **Risk:** Double-hydrate song song với guard lazy (EC2) nếu không dedup — chấp nhận idempotent HOẶC dedup theo T1.

- [ ] **T6. Infosec verify `accounts.list` chỉ trả safe view (invariant #1)** — S
  - **Role:** infosec
  - **Depends on:** none (song song; gate trước T8)
  - **Acceptance:** Xác nhận RPC `accounts.list` trả `ProviderAccount` safe view (fingerprint/label/models/baseURL/status) — KHÔNG chứa API key/token; hydrate không đưa key vào store/event/trace/IPC payload lên UI. Kiểm method sidecar `accounts.*` + type `ProviderAccount`. Ghi kết luận PASS/FAIL. Nếu FAIL → block T8.
  - **Risk:** Nếu safe view rò key → HARD BLOCK, phải sửa sidecar (mở rộng scope, quay lại BA/TL).

- [ ] **T7. QA verify toàn bộ AC + edge case** — S
  - **Role:** qa-tester
  - **Depends on:** T3, T4, T5
  - **Acceptance:** Viết & chạy test case cover AC-FM1.1–1.4, AC-FM4.1–4.3, AC-FM3.1, AC-FM2.1, AC-GUARD.1–4, và EC1–EC9. Trọng tâm: (a) account Anthropic sẵn → vào thẳng Skills không thấy false error (AC-FM1.4); (b) chỉ có OpenAI, default=anthropic → creator chạy (AC-FM4.2); (c) trắng account → FM2 message; (d) offline → "Engine offline" + không RPC (EC1); (e) hydrate boot + guard lazy song song → state cuối đúng (EC2). Verify resolve khớp Sessions (AC-FM4.3).
  - **Risk:** EC2 khó reproduce ổn định — cần cách mô phỏng hydrate chậm.

- [ ] **T8. Code review (architecture / SoC / perf)** — S
  - **Role:** code-reviewer
  - **Depends on:** T7, T6
  - **Acceptance:** Review: helper đúng SRP/SoC (không fs/SDK), 7 callsite dùng chung không còn duplicate, `send()` wording single-source, hydrate boot không block first paint, dedup/idempotent đúng T1. `pnpm lint` 0 error + `typecheck` pass. Không regress `AgentEditor.vue`.
  - **Risk:** none.

- [ ] **T9. Cập nhật docs (known-issue UI cũ + ghi chú hydrate boot)** — S
  - **Role:** developer
  - **Depends on:** T3, T5
  - **Acceptance:** Cập nhật `apps/desktop/ui-next/README.md` (nếu có mục account/boot) ghi hành vi hydrate boot + helper resolveCreatorAccount; xác nhận §10 known-issue UI cũ đã ghi (không sửa `apps/desktop/ui/`). Task tài liệu riêng, không nhồi vào task code.
  - **Risk:** none.

## Backlog (sau MVP)

- [ ] **T10. UX chọn active account trong Settings (FM3 hard UX)** — M
  - **Role:** tech-lead → developer
  - Out of scope theo PO. Hiện FM3 chỉ là hint mềm; sau MVP có thể thêm UI set active rõ ràng.

- [ ] **T11. Auto-connect / auto-select account** — M
  - Out of scope. Ghi lại nếu PO muốn xét sau.

- [ ] **T12. Port fix sang UI cũ `apps/desktop/ui/`** — M
  - Known-issue §10. Chỉ khi PO quyết định vẫn duy trì UI cũ.

## Open questions

Không còn open question sản phẩm chặn (OQ1/OQ2 đã trả lời trong spec §3). 4 điểm kỹ thuật §9 gom vào **T1** để TL chốt trước khi dev bắt đầu.

## Missing from spec

Không có gap chặn. Ghi chú nhỏ để dev lưu ý (không cần quay lại BA):

- Helper trả `provider` (không chỉ `accountId`) để callsite nào cần provider (vd Workflow-gen) dùng được — spec ngụ ý nhưng chưa liệt kê callsite nào cần `provider`. Dev xác minh khi làm T3.
- Map tên hiển thị `<Provider>` (Anthropic/OpenAI/Google) cho wording FM3 — dùng nguồn tên provider sẵn có, không hardcode chuỗi mới rời rạc.
