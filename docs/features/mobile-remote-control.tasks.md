# Plan: Mobile Remote Control — P1 (View + Send + Approve + Pairing)

> Spec: [mobile-remote-control.md](./mobile-remote-control.md) · ADR transport: [0067](../decisions/0067-mobile-remote-control-transport.md)
>
> **Trạng thái:** Draft plan (chưa bắt đầu). **Post-MVP** vì feature thêm auth + listening
> surface (lý do độc lập). **KHÔNG phụ thuộc VPN Manager (ADR 0065)** — feature đó là OpenVPN,
> khác hẳn; Mobile Remote chỉ cần user tự cài Tailscale + AWOG detect interface (self-contained).
> Kick-off được bất cứ lúc nào; sequencing là lựa chọn tự do.
>
> **Quy tắc chia:** F1–F5 là fix **đan vào task gateway** (không gom cuối thành 1 task
> "security"). F6–F8 = fix-trước-release, task riêng. Mọi task chạm biên mạng/IPC/exec →
> re-audit infosec là **release gate bắt buộc** (T21), không optional.

---

## Chú giải

- **Ước lượng:** S (< 0.5d) · M (0.5–2d) · L (2–5d) · XL (> 5d, đã tách nhỏ).
- **Owner:** `main-dev` (gateway/Electron main) · `ui-dev` (PWA + Settings→Devices) ·
  `tech-lead` (ADR + contract) · `infosec` (audit) · `qa-tester` (test).
- 🔒 **blocking-release** = fix bảo mật F1–F8 / audit — **không release nếu chưa xong**.
- ⛔ = task bị **chặn bởi một quyết định chưa chốt** (xem [§Quyết định phải chốt](#quyết-định-phải-chốt-trước)).

---

## Wave 0 — Quyết định & tiền đề (mở khoá các task sau)

Không code được cho tới khi các quyết định này chốt. Xử lý trước hoặc song song đầu sprint.

- [ ] **T1. ADR: chọn thư viện QR (generate desktop + scan PWA)** — S
  - **Role:** tech-lead
  - **Depends on:** none
  - **Acceptance:** ADR mới (`docs/decisions/NNNN-qr-lib-mobile-remote.md`) chốt 1 lib generate + 1
    lib/scan cho PWA (hoặc dùng `BarcodeDetector` API native), có mục security review dep
    (`npm view`, downloads, CVE) theo [rules/security.md](../../.claude/rules/security.md). Giải
    Q7. **Bắt buộc trước khi thêm dep** (quy tắc "không thêm dep lớn khi chưa có ADR").
  - **Risk:** dep mới cần `pnpm audit`; scanner PWA phụ thuộc `getUserMedia` + HTTPS/localhost.

- [ ] **T2. TL chốt contract `devices.*` + đường approve-plan từ remote** — S
  - **Role:** tech-lead
  - **Depends on:** none
  - **Acceptance:** Ghi rõ (trong ADR 0067 hệ quả hoặc addendum spec): (a) `devices.create-pairing`
    / `devices.list` / `devices.revoke` — **desktop-local, KHÔNG trên allowlist remote**; shape
    param/return; nơi lưu metadata (`~/.awog/remote-devices.json`, chỉ metadata, không token);
    process nào đăng ký (sidecar vì keychain wrapper ở đó, hay main). (b) **Q5** — plan approve từ
    phone đi qua RPC nào (reuse `sessions.sendMessage` resume execute-mode, hay method
    approve-plan tường minh) → để đưa **đúng tên** vào allowlist. Giải Q5 + Q8.
  - **Risk:** quyết định process đăng ký `devices.*` ảnh hưởng ai giữ device token (main vs sidecar
    — invariant #1 nghiêng main không giữ secret, nhưng keychain wrapper hiện ở sidecar).

- [ ] **T3. Chốt Q1 — Tailscale hard-dependency vs generic trusted-interface** — S
  - **Role:** tech-lead + user
  - **Depends on:** none
  - **Acceptance:** Quyết định P1 detect interface bằng **định danh Tailscale cụ thể** (utun +
    Tailscale API/CLI) hay cho user **tự đánh dấu** một interface WireGuard/LAN "trusted". Chốt
    cách phát hiện interface cho AC-BIND-1 / AC-SEC-10 (F5). Giải Q1.
  - **Risk:** nếu generic → tăng bề mặt (user tự đánh dấu sai → bind LAN); infosec cần review lại.

- [ ] **T4. Chốt Q3/F7 — destructive-tier cho remote approve** — S 🔒
  - **Role:** tech-lead + user + infosec
  - **Depends on:** none
  - **Acceptance:** Quyết định có/không **typed-confirm bậc hai** cho gate hủy hoại
    (`Bash`/`fs.delete`/`git push`) khi approve từ phone; và với origin remote có **cấm
    `updatedInput`** + **cấm/ẩn `alwaysAllow`** không. Kết quả nạp vào T7 (param gate) + T18 (card).
    Giải Q3, khoá F7.
  - **Risk:** nếu quyết định "typed-confirm" → T18 tăng scope (thêm biến thể card).

---

## Wave 1 — Remote Gateway core + security (main-dev) 🔒

Cụm này là **trái tim P1**. Mọi F1–F5 **đan vào đây** (không tách bucket security). Gateway =
**"một client nữa" của engine** (reuse `engine.request()` + `engine.onEvent()`), file mới
`apps/desktop/electron/src/remote-gateway.ts`, wire vào `main.ts` cạnh `registerIpc`.

- [ ] **T5. Gateway skeleton + bind tailnet-only + per-connection remoteAddress (F5)** — L 🔒
  - **Role:** main-dev
  - **Depends on:** T3
  - **Acceptance (AC-BIND-1..4, AC-SEC-10):** WS server (dep `ws`) bind **chỉ** IP interface
    tailnet nhận diện theo **định danh** (utun + xác nhận Tailscale, không CIDR-only); **fail-closed**
    không bind nếu không thấy tailnet; **không bao giờ** `0.0.0.0`. Mỗi kết nối kiểm
    `socket.remoteAddress ∈ CIDR tailnet` — reject nếu không. Interface up/down → re-verify + ngừng
    nhận kết nối mới (Q6). Emit trạng thái tailnet cho renderer (Settings badge). Scan từ ngoài
    tailnet không thấy port (AC-BIND-3).
  - **Risk:** race up/down interface; dual-stack IPv4/IPv6 tailnet; Q6 (WS đang mở lúc mất tailnet)
    cần chốt hành vi trong task này.

- [ ] **T6. Method allowlist exact-match + boot-validate vs registry (F4)** — M 🔒
  - **Role:** main-dev
  - **Depends on:** T5
  - **Acceptance (AC-SEC-2/3/9):** allowlist là **mảng string exact-match, default-deny**; frame
    ngoài allowlist bị **chặn tại gateway, không tới sidecar dispatch**. Thêm cơ chế introspection
    (RPC `system.listMethods` ở sidecar, hoặc export registry keys) để gateway **validate mọi entry
    vs registry thật lúc boot → fail-fast** nếu tên method không tồn tại. **Lưu ý grounding:** registry
    đang **hỗn hợp** (`sessions.sendMessage`/`sessions.answerQuestion` camelCase **nhưng**
    `sessions.permission` một-từ) → dùng đúng tên đã verify, KHÔNG suy diễn gạch-nối. Test khoá
    danh sách = T19.
  - **Risk:** gateway (main) không đọc trực tiếp Map registry của sidecar (khác process) → cần RPC
    introspection; đây là điểm thiết kế phải chốt trong task.

- [ ] **T7. Param-pick per-method + origin sanitize (F1)** — L 🔒 ⛔(T2, T4)
  - **Role:** main-dev
  - **Depends on:** T6, T2, T4
  - **Acceptance (AC-SEC-6):** với `sessions.sendMessage` origin remote: **param-pick allowlist**
    (chỉ field cho phép, **default-deny field lạ**); **ép `autoApprove=false`**; **loại bỏ**
    `workspacePath`/`contextFolders`/`systemPrompt`/`instructions`/`history`; **pin**
    `settings.accountId`/`provider`/`modelId` theo giá trị server-side của session; cwd **chỉ** qua
    `projectId` (resolve server-side). Áp param-pick cho **mọi** method trên allowlist (permission,
    answerQuestion, git.*, tasks.*…). **Chốt origin-propagation** ở đây: infosec nghiêng phương án
    **(b) sanitize hoàn toàn ở gateway/main** (KISS) thay vì truyền `origin:'remote'` xuống sidecar
    — quyết định TL trong task, ghi lý do. Áp kết quả T4 (updatedInput/alwaysAllow).
  - **Risk:** `sessions.sendMessage` có ~25 field (history/settings/systemPrompt/instructions/
    autoApprove/workspacePath/contextFolders/disabledTools/mcpServerIds/budget/pinnedContext…) — dễ
    sót; default-deny bắt buộc, không denylist. Đây là **F1 Critical** — sai = RCE + đọc/ghi file toàn máy.

- [ ] **T8. Event egress allowlist theo type + scope theo subscription (F2)** — L 🔒
  - **Role:** main-dev
  - **Depends on:** T5
  - **Acceptance (AC-SEC-7, AC-VIEW-2/4):** gateway subscribe `engine.onEvent` **riêng** (hiện main
    forward **global** xuống renderer) và **chỉ** forward xuống phone: (a) **type trong allowlist**
    (`session.chunk`/`step`/`message.done`/`permission-request`, `task.*` tối thiểu); (b) **chỉ**
    event của session/task device **đang subscribe**. **Chặn cứng** `auth.oauth-url`/`source.oauth-url`/
    `terminal.data`/`ssh:*`/`vpn:*` + event session khác. Duy trì mapping device↔subscription.
  - **Risk:** `engine.onEvent` là fan-out chung — phải lọc ở gateway, không đổi đường renderer hiện
    có; rò 1 type = lộ PKCE/secret. Cân nhắc redaction pass (F9, residual).

- [ ] **T9. Git read scope — ràng `workspaceRoot` vào project đã biết (F3)** — M 🔒
  - **Role:** main-dev
  - **Depends on:** T6
  - **Acceptance (AC-SEC-8):** `git.status`/`git.diff`/`git.log` từ phone: gateway ràng
    `workspaceRoot` vào **tập path project đã biết** (từ `projects.list` server-side) → reject path
    lạ trước khi forward. "Read-only" ≠ "scoped" — không đọc repo tùy ý trên đĩa từ 4G.
  - **Risk:** multi-repo per project (discoverRepos) → tập path hợp lệ gồm repo con; cần khớp đúng
    danh sách, không chỉ project root.

- [ ] **T10. Pairing + device-token (F6): handshake auth, hash-at-rest, one-time TTL, revoke** — L 🔒 ⛔(T2)
  - **Role:** main-dev
  - **Depends on:** T5, T2
  - **Acceptance (AC-PAIR-2/3/4, AC-SEC-5, AC-REV-1/2, F6):** `PairingChallenge` in-memory
    (`{code,nonce,expiresAt,used}`, one-time, TTL 60–120s, huỷ khi modal đóng); QR mang
    **pairing-code one-time** (KHÔNG long-lived token). Handshake: phone gửi code → gateway verify
    còn-hạn + chưa-dùng (constant-time), phát **device token ≥128-bit CSPRNG**, lưu **hash** ở
    keychain (service mới `awog-remote-devices`, tái dùng `setKeychainValue`), metadata (không token)
    ra `~/.awog/remote-devices.json`. **Auth-at-handshake** bind identity vào connection (KHÔNG
    token-mỗi-frame). Rate-limit + lockout. Revoke → xoá hash keychain + mark `revoked` + **force-close
    WS đang mở ngay** (không chờ token hết hạn). Đăng ký `devices.*` RPC theo T2.
  - **Risk:** token/hash phải zero-leak (không log, không payload xuống phone khác — AC-SEC-1);
    ai giữ keychain (main vs sidecar) tuỳ T2 → có thể phải thêm keychain-in-main.

- [ ] **T11. Resume stream qua con trỏ offset (AC-RES)** — M 🔒-adjacent
  - **Role:** main-dev
  - **Depends on:** T8
  - **Acceptance (AC-RES-1/2):** phone reconnect gửi con trỏ (turn/offset đã thấy) → gateway replay
    phần event thiếu qua `sessions.get`/`sessions.search` (JSONL event-sourced, ADR 0062/0024) rồi
    stream tiếp live. **Không sót, không trùng** (idempotent theo id/offset) sau mất mạng ~30s.
  - **Risk:** dedupe ranh giới replay↔live; giữ mapping subscription qua reconnect.

- [ ] **T12. Budget guard per-device (F8)** — M 🔒
  - **Role:** main-dev
  - **Depends on:** T7
  - **Acceptance (F8, Non-functional):** cap per-device: max concurrent turns, turns/giờ, token/ngày;
    cap kích thước message + số connection/device. Đảm bảo `cancel` luôn reachable (dù P1 UI chưa bật
    cancel — không tự spam vòng gọi model). Vượt hạn → reject frame `sendMessage`/`rerunPhase`.
  - **Risk:** chia sẻ bộ đếm budget với path desktop (nếu có) để không double-count.

---

## Wave 2 — Desktop `Settings → Devices` (ui-dev)

- [ ] **T13. Type `RemoteDevice` + mirror ui-next/types** — S
  - **Role:** ui-dev
  - **Depends on:** T2
  - **Acceptance (Data shape):** `RemoteDevice` (`id/label/platform/pairedAt/lastSeenAt?/revoked?`,
    **KHÔNG** token) ở sidecar types + mirror [ui-next/types/index.ts](../../apps/desktop/ui-next/types/index.ts).
  - **Risk:** giữ đồng bộ 2 chỗ; không để token lọt vào type xuống UI.

- [ ] **T14. Trang `Settings → Devices`: tailnet badge + pair modal + device list + revoke** — L ⛔(T1)
  - **Role:** ui-dev
  - **Depends on:** T1, T10, T13
  - **Acceptance (AC-PAIR-1/5, AC-BIND-2, AC-REV-1):** section mới trong Settings (theme
    `useTheme()`, `AppSelect`/`AppInput`, badge/count `text-[12px]`). Badge tailnet
    `connected`(+IP)/`disconnected`(banner fail-closed + CTA cài Tailscale, tái dùng pattern VPN
    Manager 0065; nút Pair **disabled**). Pair modal: **QR lớn + đồng hồ đếm ngược + mã text
    fallback + "Generate new code"**; đóng modal huỷ challenge. Device list: label + platform icon +
    pairedAt + lastSeenAt + chip online/offline + **Revoke** (icon-only destructive, confirm). Empty
    state "Chưa ghép thiết bị nào" + CTA. i18n en/vi.
  - **Risk:** live `lastSeenAt`/online cần event `device.connected/disconnected` từ gateway (T10).

---

## Wave 3 — PWA (ui-dev) — port tập con ui-next

- [ ] **T15. PWA shell: WS client + token storage + tailnet status + pairing scan + reconnect** — L ⛔(T1)
  - **Role:** ui-dev
  - **Depends on:** T1, T5, T10
  - **Acceptance (Flow A/B, AC-VIEW-1 phần kết nối, AC-RES phần reconnect UI):** PWA scaffold
    (`ssr:false` SPA đã có → tái dùng), WS transport client (frame + auth-at-handshake), lưu token
    trong storage trình duyệt phone, thanh trạng thái tailnet (`reachable`/`reconnecting…`/
    `disconnected`), màn "Scan to pair" (QR scanner lib T1 + nhập mã tay), auto-reconnect + gửi con
    trỏ offset khi mạng về. Màn "cần pair lại" khi token revoked/expired.
  - **Risk:** PWA phục vụ từ đâu (gateway serve static, hay bundle riêng) — cần chốt; HTTPS/localhost
    cho camera scanner.

- [ ] **T16. PWA session list + session view (transcript stream + todo + diff + cost)** — L
  - **Role:** ui-dev
  - **Depends on:** T15, T8, T11
  - **Acceptance (AC-VIEW-1..4):** `sessions.list` (chip turn-active / đang-chờ-gate) → chọn session
    → `sessions.get(offset)` replay + subscribe live; transcript **stream** read-only (reuse render
    message/steps ui-next), **todo banner** (`useSessionTodo` chung), **diff** read-only
    (`git.diff`/`git.status`), **cost tab** (`sessions.costBreakdown`). Cập nhật không cần refresh tay.
    Session đã kết thúc → read-only, composer disabled.
  - **Risk:** port render pipeline craft/ui-next lên màn nhỏ; diff dài cắt bớt (liên quan Q3/F7).

- [ ] **T17. PWA composer — send message / follow-up** — M
  - **Role:** ui-dev
  - **Depends on:** T16, T7
  - **Acceptance (AC-SEND-1/2):** gửi `sessions.sendMessage` (qua gateway đã param-pick); message
    rỗng/whitespace **chặn ở client** (không tạo turn rỗng); reply stream về như desktop. P1 **ẩn**
    nút steer/cancel.
  - **Risk:** đảm bảo client KHÔNG gửi field bị cấm (dù gateway đã default-deny — defense in depth).

- [ ] **T18. PWA approval cards — permission / plan / question** — L ⛔(T4)
  - **Role:** ui-dev
  - **Depends on:** T16, T7, T4
  - **Acceptance (AC-GATE-1..5):** 3 biến thể tái dùng component ui-next: `SessionInlinePermission`
    (Allow/Deny/Always — theo T4 có thể ẩn Always/thêm typed-confirm destructive), plan card
    (Approve→execute / Reject), `SessionQuestionCard` (radio/checkbox + Other + Submit →
    `sessions.answerQuestion` mid-turn). Card **luôn hiện** (không collapse). Gate đã resolve ở
    desktop → `resolved:false` → card tự dismiss như stale (idempotent). Hiển thị **đầy đủ tham số
    tool** (command/path) như desktop.
  - **Risk:** concurrent approve desktop-vs-phone; plan approve đi đúng RPC T2/Q5.

---

## Wave 4 — Test · Audit · Docs (release gate)

- [ ] **T19. QA: bộ test bảo mật gateway (khoá F1–F5)** — L 🔒
  - **Role:** qa-tester
  - **Depends on:** T6, T7, T8, T9, T10
  - **Acceptance (AC-SEC-9 unit + F1–F5):** unit test **khoá allowlist** (thêm/bớt method phải sửa
    test — F4); test param-pick **default-deny field lạ** + ép `autoApprove=false` + strip
    workspacePath/systemPrompt/history (F1); test event egress chặn oauth/terminal/ssh/vpn + session
    không subscribe (F2); test git scope reject path lạ (F3); test bind fail-closed + remoteAddress
    reject (F5); test revoke force-close + idempotent gate (AC-SEC-5, AC-GATE-5).
  - **Risk:** **chưa có test framework** trong `apps/desktop` (vitest ở backlog Pha 2B) → có thể cần
    task-con dựng vitest trước; flag với TL.

- [ ] **T20. QA: E2E verify AC trên tailnet thật + 4G** — L
  - **Role:** qa-tester
  - **Depends on:** T14, T16, T17, T18, T12
  - **Acceptance (Success criteria + AC-PAIR/VIEW/SEND/GATE/RES/REV):** kịch bản end-to-end từ phone
    4G (khác LAN, cùng tailnet): pair → view stream → send → approve 3 gate → resume sau mất mạng
    ~30s → revoke cắt ngay. Xác nhận **AC-SEC-1** bằng grep payload thực (không key/token). Đo
    round-trip approve (mục tiêu vài giây).
  - **Risk:** cần 2 thiết bị + Tailscale thật; khó tự động hoá → phần lớn manual.

- [ ] **T21. Infosec re-audit (RELEASE GATE)** — M 🔒
  - **Role:** infosec
  - **Depends on:** T5, T6, T7, T8, T9, T10, T11, T12
  - **Acceptance:** re-audit sau khi F1–F5 (+F6/F8) landed theo skill `security-audit` (8 invariant +
    21 rule). Xác nhận: no public bind, zero credential trong payload, allowlist default-deny khớp
    registry, event egress lọc, git scoped, token hash zero-leak, budget guard. **Không release nếu
    audit chưa pass.** Re-audit lại **mỗi lần mở rộng allowlist ở P2**.
  - **Risk:** audit có thể trả về must-fix mới → vòng lặp về Wave 1.

- [ ] **T22. Docs: cập nhật architecture + ADR status + index** — S
  - **Role:** tech-lead (hoặc BA)
  - **Depends on:** T5–T18 landed
  - **Acceptance:** [system-overview.md](../architecture/system-overview.md) thêm đường
    phone⇆gateway⇆engine; [data-model.md](../architecture/data-model.md) thêm `RemoteDevice`; ADR
    0067 `Proposed → Accepted`; backfill [decisions/README.md](../decisions/README.md); cập nhật
    CLAUDE.md §Trạng thái port. Tách khỏi task code (không nhồi vào task impl).
  - **Risk:** none.

---

## DAG (rút gọn — mũi tên = "chặn")

```
T3 ─→ T5 ─┬─→ T6 ─┬─→ T7(F1) ─→ T12(F8) ─┐
          │       ├─→ T9(F3)              │
          ├─→ T8(F2) ─→ T11(resume)       │
          └─→ T10(F6, cần T2)             │
T2 ─→ T7 ; T2 ─→ T10 ; T2 ─→ T13          │
T4 ─→ T7 ; T4 ─→ T18                      │
T1 ─→ T14 ; T1 ─→ T15                     │
                                          ▼
T13 ─→ T14 ; T10 ─→ T14                 (F1–F8 landed)
T5,T10 ─→ T15 ─→ T16(+T8,T11) ─┬─→ T17(+T7)     │
                               └─→ T18(+T7,T4)  │
                                          ▼
T6,T7,T8,T9,T10 ─→ T19(test)              │
T14,T16,T17,T18,T12 ─→ T20(E2E)           │
T5..T12 ─────────────────────────────→ T21(infosec re-audit = RELEASE GATE)
T5..T18 landed ──────────────────────→ T22(docs)
```

---

## Backlog (sau P1 — KHÔNG chia ở đây)

- **P2:** `sessions.steer`/`sessions.cancel`, tạo session mới, chọn agent/model, task
  approve-phase/rerun từ phone. **Mỗi lần mở rộng allowlist → re-audit infosec (T21 lặp).**
- **P3:** Web Push wake-ping (VAPID — ADR riêng, F10), audit log hành động remote (`origin:'remote'`
  + `deviceId` — Q4), device management nâng cao (đổi tên, quyền per-device), MFA lúc pair (Q2).
- Native iOS/Android app; relay/cloud tunnel (Option B ADR 0067); redaction pass egress (F9).

---

## Open questions → task bị chặn

| Q | Nội dung | Chốt bởi | Chặn task |
|---|---|---|---|
| **Q1** | Tailscale hard-dep vs generic trusted-interface (cách detect F5) | user/TL | **T5** (bind) — qua T3 |
| **Q2** | MFA/bước xác nhận lúc pair/approve? (P1: token đủ) | user | — (P3, không chặn P1) |
| **Q3/F7** | Destructive-tier / typed-confirm cho remote approve | user/TL + infosec | **T7, T18** — qua T4 |
| **Q4** | Ghi `origin:'remote'`+`deviceId` vào trace ngay P1 hay P3 | PO/infosec | — (khuyến nghị P3; option nhỏ trong T7) |
| **Q5** | Plan approve từ phone đi RPC nào (đưa đúng tên vào allowlist) | TL | **T7, T18** — qua T2 |
| **Q6** | Tailnet biến mất lúc WS đang mở: đóng ngay hay để tự chết | TL | **T5** (giải trong task) |
| **Q7** | Thư viện QR (dep mới cần ADR) | TL/infosec | **T14, T15** — qua T1 |
| **Q8** | Contract `devices.*` + vị trí/format metadata | TL | **T10, T14** — qua T2 |
| **Q9** | Vị trí QR pairing (Settings vs tray/onboarding) | PO/TL | — (P1 chọn Settings; không chặn) |
| **origin-prop** | Truyền `origin:'remote'` xuống sidecar (a) vs sanitize hoàn toàn ở main (b) | TL | **T7** (chốt trong task; infosec nghiêng **b**) |

---

## Tóm tắt

- **Tổng: 22 task** — 4 quyết định (Wave 0), 8 gateway/security (Wave 1), 2 desktop UI (Wave 2),
  4 PWA (Wave 3), 4 test/audit/docs (Wave 4).
- **blocking-release (🔒): T4, T5, T6, T7, T8, T9, T10, T12, T19, T21** — tương ứng F1–F8 + test +
  re-audit. Không release nếu bất kỳ cái nào chưa xong.
- **Critical path (dài nhất tới release gate):**
  `T3 → T5 → T6 → T7 → T12 → T21(infosec) → release`
  (song song: T2/T4 mở khoá T7; T10 mở khoá pairing; nhánh PWA T15→T16→T18 chạy song song sau khi
  gateway đủ để kết nối). **T7 (F1 param-pick)** là node đắt & rủi ro nhất — ưu tiên vào sớm ngay
  sau T5/T6.
- **Quyết định phải chốt trước (kẻo block):**
  - **T1/Q7** (ADR QR) → chặn T14 + T15.
  - **T2/Q5+Q8** (contract `devices.*` + approve-plan) → chặn T7, T10, T13, T14, T18.
  - **T3/Q1** (Tailscale hard-dep vs generic) → chặn T5 (bind F5).
  - **T4/Q3+F7** (destructive-tier) → chặn T7 (param gate), T18 (card).
  - **origin-propagation** → chốt trong T7 (infosec khuyến nghị **(b) sanitize ở main + param-pick**).
- **Grounding note (ảnh hưởng ước lượng F4/F1):** registry method-name **hỗn hợp** đã verify
  (`sessions.sendMessage`/`sessions.answerQuestion` camelCase **nhưng** `sessions.permission`
  một-từ) → **bắt buộc** validate allowlist vs registry thật (T6), không suy diễn tên. `apps/desktop`
  **chưa có** vitest/jest → T19 có thể cần dựng test infra trước (flag ở task).
