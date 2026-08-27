# Plan: Chặn thao tác phá huỷ transcript trong Sessions (B1 + B2)

> **Spec:** [session-destructive-action-guard.md](./session-destructive-action-guard.md) · **Brief:** [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md)
> **Spec anh em (dependency cứng):** [session-transcript-navigation.md](./session-transcript-navigation.md) — plan tại [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md)
> Vai trò tạo: Project Manager. Tài liệu **chỉ chia task + dependency + ước lượng + owner + acceptance**, KHÔNG chứa code.
> **Spec đã chốt hoàn toàn — 0 open question** (Q1/Q2/Q3 + TL-1 chốt ở §12). **Không cần ADR mới. Không cần infosec** (§11).

## Cách đọc plan

- **Effort:** S (< 0.5d) · M (0.5–2d) · L (2–5d). Không task nào XL.
- **Owner:** `developer` · `qa-tester` · `code-reviewer` · `tech-lead` (chỉ 1 điểm dừng có điều kiện ở B2.0).
- **Acceptance** trỏ thẳng tới AC trong [spec §8](./session-destructive-action-guard.md): tiền tố **AC-G** (lát B1) và **AC-R** (lát B2).
- **DoD chung cho MỌI task code:** `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint && pnpm typecheck` — **0 error** trước khi báo xong (`.claude/rules/lint-format.md`, và spec §14 nhắc lại).
- Không component mới, không modal mới, không RPC mới, không entity mới, không token theme mới, không dependency mới.

---

## Hai lát ship (chốt TL-1, spec §12.2)

| Lát | Nội dung | Phụ thuộc | AC |
|---|---|---|---|
| **B1** | Gate confirm **4 hành động** + danger hover **5 hành động / 6 điểm bấm** + 12 khoá i18n × 2 ngôn ngữ + §4.6 so lại + toast + Boy Scout | **KHÔNG** — độc lập hoàn toàn, ship ngay, chạy **song song** T0a/T0b/T0c của feature anh em | AC-G1…AC-G36 |
| **B2** | §4.8 vá persist `rewind` ("neo vào `eid` gần nhất phía trước") + thêm câu "Không thể hoàn tác" vào hộp thoại `rewind` | **DEPENDENCY CỨNG → T0c** | AC-R1…AC-R9 |

### ⚠ DEPENDENCY CỨNG chéo feature: `B2 → T0c`

**Lát B2 KHÔNG được bắt đầu trước khi `T0c` merge.**

- `T0c` = task của [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md) (`T0c.1` → `T0c.2` → `T0c.4 infosec` → **`T0c.3`**): gắn `eid` cho **user/system message** + **mint `userMessageId` lúc gửi**.
- Lý do: quy tắc §4.8 neo vào *"message có `eid` gần nhất phía trước"*. Trước T0c, `rewind` trên turn assistant có `prev` là **user** — mà user **chưa có `eid`** (`sessions.ts:1050-1063`) ⇒ ca **phổ biến nhất** rơi vào nhánh không neo được.
- **Mốc mở khoá chính xác:** `T0c.3` (store gắn `eid` + mint `userMessageId`) đã merge. Chỉ `T0c.1/T0c.2` (sidecar) là **chưa đủ** — message user gửi **trong phiên hiện tại** vẫn thiếu `eid` cho tới lần reload (spec §12.2, lối thứ ba #3 đã loại).
- **Hệ quả bắt buộc trong cửa sổ B1 → B2:** hộp thoại `rewind` **KHÔNG được** chứa câu "Không thể hoàn tác" (**AC-G36**). Câu đó chỉ thêm ở B2 (**AC-R9**), bằng **một dòng diff** nhờ khoá riêng `sessions.guard.irreversible`.
- **Lát B1 hoàn toàn không phụ thuộc T0c.**

---

## DAG phụ thuộc

```
B1.3 (i18n 12 key × 2)
   ↓
B1.1 (gate 4 hành động + lostCount + §4.6 + toast) ──┐
B1.2 (danger hover 6 điểm bấm)                       ├─→ QA-G1 → QA-G2 → QA-G3
B1.4 (Boy Scout: sửa comment sai 3598-3599)          ┘

────────── ranh giới lát ──────────
        T0c (feature anh em)  ══DEPENDENCY CỨNG══╗
                                                 ↓
                                            B2.0 (verify AC-R7) → B2.1 (vá persist rewind) → B2.2 (thêm câu "Không thể hoàn tác") → QA-R
                                                                                                                                       ↓
                                                                                                                                      Z1 → Z2
```

Cạnh chéo feature khác cần tôn trọng: **thứ tự cắt** phải khớp [spec anh em §5.4](./session-transcript-navigation.md) —
`lostCount` → `confirm()` → so lại `msgs.length`/session → `survivingIds` → **prune bookmark** → cắt đĩa (§6).
**Huỷ hộp thoại ⇒ bookmark KHÔNG bị prune** (AC-G10 và AC-P1 của spec anh em phải cùng đúng).

---

## Lát B1 — Gate + danger hover + i18n (độc lập, ship ngay)

- [ ] **B1.3. Thêm 12 khoá i18n `sessions.guard.*` (en + vi)** — **S**
  - **Mô tả:** Thêm **12 key × 2 ngôn ngữ = 24 dòng**, key **phẳng** đúng convention file hiện có (`sessions.delete.*` ở dòng 105-108): `rewind.title/body/confirm`, `resend.title`, `editResend.title`, `resend.body`, `regen.title`, `regen.body`, **`irreversible`**, `rerun.confirm`, `costNote`, `stale` (bảng đầy đủ ở [spec §13](./session-destructive-action-guard.md)). **Không** thêm key cho nút huỷ (dùng `common.cancel`), **không** có biến thể "0 message". `irreversible` là **khoá riêng có chủ đích** để B2 thêm cho `rewind` bằng một dòng diff.
  - **File chạm:** `apps/desktop/ui-next/i18n/locales/vi/sessions.json` · `apps/desktop/ui-next/i18n/locales/en/sessions.json`
  - **Depends on:** none
  - **Owner:** developer
  - **Acceptance:** đủ 12 key ở **cả hai** file, nội dung khớp bảng §13 từng chữ; **AC-G34** (chạy app ở `en` ⇒ không còn chuỗi hardcode tiếng Việt) · **AC-G35** (nhãn xác nhận là "Cắt về đây" / "Chạy lại", **không bao giờ** "Xoá"/"Delete").

- [ ] **B1.1. Gate `await confirm()` cho 4 hành động + `lostCount` + kiểm tra lại sau confirm** — **M**
  - **Mô tả:** Trong `SessionMessageItem.vue`: `const { confirm } = useConfirm()`; hàm tính **`lostCount`** theo §4.1 (`rewind` = `msgs.length - i`; `resend`/`edit & resend` = `msgs.length - i - 1`; `regenerate` = `msgs.length - ui - 2`, với `ui` = index user turn gần nhất **trước** `i`, lùi từ `i - 1`). Bọc `rewind` / `resend` / `editMsg` / `regen` bằng `await confirm(...)` **chỉ khi `lostCount ≥ 1`**; `lostCount === 0` ⇒ chạy thẳng. `edit & resend`: confirm đặt **SAU** overlay sửa nội dung (huỷ overlay ⇒ thoát im lặng, **không** hiện confirm). Nhãn: `confirmLabel` = "Cắt về đây" (rewind) / "Chạy lại" (3 hành động chạy lại); `cancelLabel` để trống; `kind` **không truyền** (mặc định `'danger'`). `description` ghép **3 mảnh** theo §7 (`body` + `' ' + irreversible` + `'\n' + costNote`) — **`rewind` ở lát B1 KHÔNG có mảnh `irreversible`**. §4.6: chụp `lenAtOpen` + `sessionId` + `index` **trước** `confirm()`; sau khi `true` thì so lại `msgs.length === lenAtOpen` **và** session active vẫn là session đó; lệch ⇒ **không thực thi gì** + `pushActionToast(t('sessions.guard.stale'), 'error')`. Guard phòng thủ E9: `store.active == null` / `i < 0` / `i >= msgs.length` ⇒ không mở hộp thoại. E6: `regenerate` không có `ui` ⇒ **không hỏi, không gọi store**. **Đặt comment chéo** giữa chỗ tìm `ui` ở UI và chỗ tìm `ui` ở store (§4.1, chống drift).
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionMessageItem.vue`
  - **Depends on:** B1.3
  - **Owner:** developer
  - **Acceptance:** **AC-G1** (cả 4 mở hộp thoại trước khi message biến mất) · **AC-G2** (7 điểm bấm / 6 hành động còn lại **không** hỏi — gồm `retryModel`) · **AC-G3** (assistant đúng **2** điểm gate, user bubble đúng **3**) · **AC-G4** (grep `useConfirm` trong `components/session/` ⇒ **không** file modal mới) · **AC-G5…AC-G9** (`lostCount === 0` ⇒ không hỏi; **không bao giờ** render "0 tin nhắn") · **AC-G10…AC-G12** (huỷ ⇒ không mất gì, không RPC, không prune bookmark; Esc/scrim = huỷ; huỷ ở edit&resend ⇒ giữ **nội dung cũ**) · **AC-G13…AC-G18** (con số đúng: 12 / 17 / 8 / 2; divider tính 1; turn 5 block tính 1) · **AC-G22/AC-G25/AC-G26** · **AC-G32/AC-G33** (dòng chi phí: có ở 3 hành động chạy lại, **không** ở `rewind`) · **AC-G36** (**B1: hộp thoại `rewind` KHÔNG chứa "Không thể hoàn tác"**, trong khi 3 cái kia CÓ).
  - **Risk:** công thức `regenerate` **không** được rút gọn thành `msgs.length - i - 1` (sẽ giấu message giữa `ui` và `i` — AC-G16 bắt đúng chỗ này). **`SessionGateCard.vue` KHÔNG được sửa** — quy tắc `lostCount === 0` tự phủ `onRetry` (§4.4). **Rủi ro cùng-file** với A1.4/T0a.3 của feature anh em.

- [ ] **B1.2. Tô `danger` khi hover cho 5 hành động destructive (6 điểm bấm)** — **S**
  - **Mô tả:** 6 điểm bấm: user `edit` / `send` / `rewind`, assistant `refresh` / **`settings` (retryModel)** / `rewind`. Hover ⇒ nền `var(--dangerBg)` + màu `var(--danger)`. Gợi ý implement (không bắt buộc, §10): thêm cờ `danger?: boolean` cho item trong mảng `msgActions` (`SessionMessageItem.vue:503-518`) rồi bind style hover; footer user bubble là template cứng ⇒ đánh dấu trực tiếp 3 span tương ứng. Rule hover mới đặt trong `<style scoped>` của cùng file. **Không hardcode hex**, không token mới. **Không đổi `title`** của bất kỳ nút nào.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionMessageItem.vue` (`msgActions` 503-518; footer user bubble 46-63; `<style scoped>` ~617-620)
  - **Depends on:** none (song song B1.1, nhưng **cùng file** ⇒ nên cùng dev, commit sau B1.1)
  - **Owner:** developer
  - **Acceptance:** **AC-G27** (6 điểm bấm ra `--dangerBg` + `--danger`) · **AC-G28** (**`settings` / "Thử model khác" ra màu danger y như `refresh` và `rewind` — dù nó KHÔNG mở hộp thoại**; đây là điểm dễ bỏ sót nhất của Q1, phải verify riêng) · **AC-G29** (6 nút an toàn giữ hover trung tính `--bgHover` + `--text`) · **AC-G30** (theme family **Cute** vẫn ra danger, không token mới) · **AC-G31** (`title` không đổi).
  - **Risk:** quên bật cờ cho `settings`/retryModel — đây là lý do AC-G28 tồn tại như một AC độc lập.

- [ ] **B1.4. Boy Scout: sửa comment sai ở `stores/sessions.ts:3598-3599`** — **S**
  - **Mô tả:** Comment hiện viết *"same guard `resend` uses"* khi nói về `regenInFlight` — **sai**. `regenInFlight` chỉ xuất hiện ở 3593 / 3600 / 3602 / 3635, **toàn bộ nằm trong `regenerate`**; `resend` **chỉ** có guard streaming (3673). Sửa comment cho đúng sự thật. **KHÔNG** thêm `regenInFlight` vào `resend` (ngoài phạm vi — §4.6 đã chặn ca re-entry thực tế, và spec §15 liệt kê rõ là out of scope).
  - **File chạm:** `apps/desktop/ui-next/stores/sessions.ts` (3598-3599)
  - **Depends on:** none
  - **Owner:** developer
  - **Acceptance:** comment mô tả đúng phạm vi `regenInFlight`; **không** thay đổi hành vi runtime nào; **AC-G24** vẫn đúng (thay đổi logic duy nhất ở store trong cả 2 lát là phần vá persist `rewind` của B2). Commit tách riêng với message dạng `chore` hoặc gộp vào commit B1 nhưng là hunk độc lập, dễ đọc.
  - **Risk:** rủi ro cùng-file `stores/sessions.ts` với `T0c.3` / `A1.1` / `B2.1` ⇒ serialize.

---

## Lát B2 — Vá persist `rewind` (§4.8) — CHỜ `T0c` MERGE

- [ ] **B2.0. Verify điều kiện tiên quyết AC-R7 trước khi viết một dòng code** — **S**
  - **Mô tả:** Sau khi `T0c.3` merge: mở một session dài qua `ensureLoaded`, duyệt toàn bộ `s.msgs` và xác nhận **mọi** message đều có `eid`, **trừ** message hệ thống cục bộ `ENGINE_UNAVAILABLE` (store tự chèn ở `sessions.ts:2934`, `3632`, `3647` — **không bao giờ** ra sidecar ⇒ **không bao giờ** có `eid`, kể cả sau T0c). Nếu tìm thấy **bất kỳ** message **persist** nào thiếu `eid` ⇒ **DỪNG, báo tech-lead**; **không** tự ý mở rộng vòng lùi (neo sẽ nhảy qua một message có thật trên đĩa và cắt **nhiều hơn** ý định).
  - **File chạm:** không sửa file — chỉ verify (`apps/desktop/ui-next/stores/sessions.ts`, `composables/useSessionsData.ts`).
  - **Depends on:** **`T0c` (T0c.3) của [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md) — DEPENDENCY CỨNG**
  - **Owner:** developer (escalate → tech-lead nếu FAIL)
  - **Acceptance:** **AC-R7** PASS, có ghi lại danh sách nguồn message không có `eid` (kỳ vọng: **đúng 3 chỗ chèn `ENGINE_UNAVAILABLE`**, không có chỗ nào khác). FAIL ⇒ **B2.1 không được bắt đầu**.
  - **Risk:** đây là **cổng an toàn** của cả lát B2 — bỏ qua nó là chấp nhận rủi ro cắt sai/mất dữ liệu.

- [ ] **B2.1. Vá persist `rewind` — "neo vào `eid` gần nhất phía trước"** — **M**
  - **Mô tả:** `stores/sessions.ts:3651-3661`. **Một** quy tắc duy nhất: lùi dần từ `index - 1` tìm `anchorId` = `eid` của message **có `eid`** gần nhất trong `msgs[0 .. index-1]`; **có** ⇒ `sessions.rewind({ sessionId, messageId: anchorId })`; **không** ⇒ `sessions.truncate({ sessionId, keepThroughId: null })`. **Giữ `rewind` là hàm ĐỒNG BỘ** — `pushRequest` fire-and-forget như hiện tại, **không** thêm `async`/`await` (không sinh cửa sổ đua mới). Vòng lùi là O(k) in-memory, không I/O.
  - **Ràng buộc an toàn (ranh giới giữa đúng và thảm hoạ):**
    - **`keepThroughId: null` CHỈ hợp lệ khi vòng lùi không tìm được `eid` nào trong toàn bộ tiền tố.** Tuyệt đối **không** dùng `null` làm fallback cho "message ngay trước không phải assistant" — đó chính là bẫy wipe sạch transcript (`sidecar/src/sessions/store.ts:70-71`). Điều kiện `null` phải viết bằng **kết quả vòng lùi**, không bằng `role`.
    - **Không** đổi hết sang `sessions.truncate`: `sessions.rewind` làm **nhiều hơn** — `removeSdkSession` (ADR 0058) + restore file workspace từ snapshot (ADR 0038).
    - **Không** đổi ngữ nghĩa `messageId` của `sessions.rewind` (đã loại ở §12.2 — làm hỏng `restoreSnapshot`).
    - **Không** sửa `apps/desktop/sidecar/**` hay `apps/desktop/electron/**`: không RPC mới, không đổi schema.
  - **File chạm:** `apps/desktop/ui-next/stores/sessions.ts` (3651-3661) — **và chỉ file này** ở lát B2 phần store.
  - **Depends on:** B2.0
  - **Owner:** developer
  - **Acceptance:** **AC-R4** (`keepThroughId: null` **chỉ** xuất hiện khi không tìm được `eid` nào trong `msgs[0..index-1]`, không ca nào khác — verify bằng đọc payload RPC) · **AC-R6** (chữ ký vẫn **đồng bộ**) · **AC-G24** (thay đổi logic **duy nhất** ở store là phần này; `regenInFlight`, guard streaming, thứ tự `await sessions.truncate` → `sendMessage` giữ **nguyên xi**; **không** có `useConfirm`/DOM nào lọt vào store).
  - **Risk:** **cao nhất trong cả 2 spec** — sai một nhánh ⇒ wipe sạch transcript trên đĩa. QA-R phải verify bằng **restart app**, không tin state trong bộ nhớ.

- [ ] **B2.2. Thêm câu "Không thể hoàn tác" vào hộp thoại `rewind`** — **S**
  - **Mô tả:** Thêm mảnh `' ' + t('sessions.guard.irreversible')` vào `description` của **nhánh `rewind`** (§7.1). **Đúng một dòng diff**, **không** thêm khoá i18n nào (khoá đã có từ B1.3). Ba hộp thoại còn lại **không đổi**.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionMessageItem.vue`
  - **Depends on:** B2.1
  - **Owner:** developer
  - **Acceptance:** **AC-R9** (hộp thoại `rewind` **CÓ** câu "Không thể hoàn tác", và AC-R1…AC-R3 đồng thời pass ⇒ câu đó **đúng sự thật**) — đảo của **AC-G36**. Không khoá i18n nào bị sửa lần thứ hai.
  - **Risk:** merge B2.2 mà B2.1 chưa pass QA-R = hộp thoại nói dối ⇒ **không được tách PR riêng cho B2.2**, phải đi cùng B2.1.

---

## QA

- [ ] **QA-G1. Verify phạm vi gate + con số (đếm được)** — **M**
  - **Mô tả:** Chạy AC-G1…AC-G18. Ca bắt buộc:
    1. Session 30 message, thao tác ở **giữa**: bấm lần lượt `rewind` (user bubble), `send`, `edit`, `refresh` ⇒ **cả 4** mở hộp thoại.
    2. **Đếm bằng mắt** 7 điểm bấm không hỏi: `copy`, `quote`, `maximize`, `layers`, `fork`, `branch`, **`settings` (retryModel)**.
    3. Con số: `rewind@18/30` ⇒ **12**; `resend@12/30` ⇒ **17**; `regenerate@21` với `ui=20`, tổng 30 ⇒ **8**; transcript `[… user@18, assistant@19, system@20, assistant@21]` (22 message) `regenerate@21` ⇒ **2**.
    4. Turn assistant **5 block** nằm trong vùng cắt ⇒ đếm là **1**; system divider ⇒ đếm là **1**.
    5. `lostCount === 0`: "Thử lại" lượt lỗi **cuối**, `regenerate` câu trả lời **cuối**, `resend` bong bóng user **cuối** ⇒ **không hỏi, chạy thẳng**; và "Thử lại" lượt lỗi **giữa** transcript ⇒ **có hỏi**, con số đúng.
    6. Đọc mọi hộp thoại ⇒ **không bao giờ** thấy chuỗi "0 tin nhắn" / "0 messages".
    7. **Huỷ**: bấm "Hủy" / Esc / click scrim ⇒ transcript đủ 30 message, **không RPC** `sessions.rewind`/`sessions.truncate` nào được gửi, **không bookmark nào bị prune** (kiểm chứng chéo với AC-P1 của spec anh em nếu A1 đã ship).
    8. `grep useConfirm apps/desktop/ui-next/components/session/` ⇒ không file modal xác nhận mới.
  - **Depends on:** B1.1, B1.2, B1.3
  - **Owner:** qa-tester
  - **Acceptance:** **AC-G1 … AC-G18** PASS, ghi kết quả từng AC (đặc biệt 4 con số của AC-G13…AC-G16).

- [ ] **QA-G2. Verify popout + race/re-entry** — **M**
  - **Mô tả:** Chạy AC-G19…AC-G26 + edge case E1…E4, E9…E13. **Ca bắt buộc — confirm trong CỬA SỔ POPOUT:**
    1. Pop out session ra cửa sổ riêng (`/session?id=…`) → bấm `rewind` trong cửa sổ đó ⇒ hộp thoại **hiện trong chính popout**, "Cắt về đây" cắt đúng transcript — **không treo, không im lặng** (hồi quy cho `AppGlobalHosts.vue:11` + `pages/session.vue:7`).
    2. Hộp thoại đang mở trong popout ⇒ **cửa sổ chính không hiện hộp thoại nào** và vẫn ở trạng thái hand-off.
    3. Toast huỷ vì transcript đổi ⇒ toast hiện **trong popout** (`ActionToastHost` ở `AppGlobalHosts.vue:17`).
    4. **E2:** gửi tin mới trong lúc modal đang mở ⇒ xác nhận ⇒ **không cắt gì** + toast `sessions.guard.stale`.
    5. **E3:** mở hộp thoại → chuyển sang session khác → mới xác nhận ⇒ **không cắt nhầm session** + toast.
    6. **E4:** một turn đang **streaming**, bấm `rewind`/`send`/`refresh` trên bong bóng user cũ (footer user **không** bị ẩn khi streaming) rồi xác nhận ⇒ **không message nào bị cắt** + toast. (`rewind` **không có** guard streaming ở store ⇒ §4.6 là lớp bảo vệ **duy nhất**.)
    7. **E1:** double-click nút destructive ⇒ tối đa **1** hộp thoại trên màn hình, tối đa **1** hành động.
    8. Hộp thoại `rewind` đang mở → click `refresh` của message khác ⇒ hộp `rewind` biến mất **và không cắt gì**, thay bằng hộp `regenerate`.
    9. Xác nhận `regenerate` rồi bấm `refresh` lần nữa trong cửa sổ `await sessions.truncate` ⇒ **không** có lượt model thứ hai (`regenInFlight` vẫn chặn).
    10. **E10/E11:** offline/sidecar chết ⇒ hộp thoại vẫn hiện, vẫn huỷ được; crash giữa chừng ⇒ transcript nguyên vẹn.
  - **Depends on:** QA-G1
  - **Owner:** qa-tester
  - **Acceptance:** **AC-G19 … AC-G26** PASS + E1…E4, E9…E13 đúng hành vi bảng §9.

- [ ] **QA-G3. Verify tín hiệu thị giác + i18n (gồm AC-G36 của cửa sổ B1→B2)** — **S**
  - **Mô tả:** Chạy AC-G27…AC-G36.
    1. Hover **6 điểm bấm** destructive ⇒ `--dangerBg` + `--danger`; hover 6 nút an toàn ⇒ trung tính.
    2. **Hover riêng `settings` / "Thử model khác"** ⇒ ra danger **dù nó không mở hộp thoại** (AC-G28 — verify tách bạch, đây là điểm dễ sót nhất).
    3. Bật theme family **Cute** ⇒ vẫn ra danger.
    4. Đọc DOM ⇒ `title` các nút **không đổi** so với trước.
    5. Đổi app sang `en` ⇒ toàn bộ tiêu đề / nội dung / 2 nhãn nút là tiếng Anh; nhãn xác nhận là "Rewind here" / "Re-run", **không bao giờ** "Delete".
    6. **AC-G36 (chỉ đúng trong cửa sổ B1 đã ship, B2 chưa):** hộp thoại `rewind` **KHÔNG** chứa "Không thể hoàn tác" / "This cannot be undone", trong khi `resend` / `edit & resend` / `regenerate` **CÓ**.
  - **Depends on:** QA-G1
  - **Owner:** qa-tester
  - **Acceptance:** **AC-G27 … AC-G36** PASS. AC-G36 phải được chạy **trước khi B2 merge** (sau B2 thì AC-R9 thay thế).

- [ ] **QA-R. Verify persist `rewind` — 4 ca, verify bằng RESTART APP** — **M**
  - **Mô tả:** Chạy AC-R1…AC-R9. **Mọi ca đều phải kiểm chứng bằng KHỞI ĐỘNG LẠI APP** — không tin state trong bộ nhớ, vì đúng bug này là "bộ nhớ thì cắt, đĩa thì không".
    1. **Ca 1 (AC-R1):** transcript 30 message, `msgs[17]` là **assistant có `eid`** → `rewind@18` → xác nhận → **restart app** ⇒ còn **đúng 18 message**.
    2. **Ca 2 (AC-R2 — phổ biến nhất):** `msgs[17]` là **user** (rewind trên turn assistant) → `rewind@18` → xác nhận → **restart app** ⇒ còn **đúng 18 message** — **không** 30 (bug cũ) và **không** 0 (bẫy `keepThroughId: null`).
    3. **Ca 3 (AC-R3):** `rewind@0` → xác nhận → **restart app** ⇒ transcript **rỗng**.
    4. **Ca 4 (AC-R8):** có message `ENGINE_UNAVAILABLE` cục bộ **ngay trước** điểm rewind → `rewind` → xác nhận → **restart app** ⇒ neo lùi tới message có `eid` gần nhất phía trước, transcript khớp đúng phần đáng lẽ còn lại — **không wipe**, **không giữ nguyên 30**.
    5. **AC-R4:** đọc payload RPC ở cả 4 ca ⇒ `keepThroughId: null` **chỉ** xuất hiện ở ca 3.
    6. **AC-R5:** gửi payload rewind với `messageId` engine không biết ⇒ transcript trên đĩa **không đổi** (no-op), **không wipe**.
    7. **AC-R6:** đọc code ⇒ `rewind` vẫn đồng bộ.
    8. **AC-R9:** hộp thoại `rewind` giờ **CÓ** câu "Không thể hoàn tác" và các ca trên đồng thời pass ⇒ câu đó đúng sự thật.
    9. Hồi quy: `resend` / `regenerate` / edit&resend vẫn persist đúng như trước (không regression từ B2.1).
  - **Depends on:** B2.2
  - **Owner:** qa-tester
  - **Acceptance:** **AC-R1 … AC-R9** PASS, mỗi ca ghi rõ số message **sau restart**.
  - **Risk:** nếu bất kỳ ca nào ra **0 message** ⇒ **rollback ngay**, đó là bẫy wipe ở §4.8.

---

## Đóng gói

- [ ] **Z1. Cập nhật tài liệu** — **S**
  - **Mô tả:** Đánh dấu spec `Status: Draft → Implemented` (ghi rõ lát B1 / B2 và ngày ship từng lát). Nếu [sessions.md](./sessions.md) có câu mô tả `rewind` như "chỉ cắt trong phiên" thì sửa cho đúng sau B2. **Không** tạo ADR (spec §12.2 đã chốt: không cần).
  - **File chạm:** `docs/features/session-destructive-action-guard.md` (dòng Status) · `docs/features/sessions.md` (nếu có câu sai)
  - **Depends on:** QA-R
  - **Owner:** developer
  - **Acceptance:** trạng thái spec đúng; không tài liệu nào còn mô tả `rewind` theo hành vi cũ.

- [ ] **Z2. Code review tổng (2 lát)** — **S**
  - **Mô tả:** Review theo ràng buộc "KHÔNG chạm" của [spec §14](./session-destructive-action-guard.md).
  - **Depends on:** Z1
  - **Owner:** code-reviewer
  - **Acceptance:** xác nhận (a) **không** file modal xác nhận mới — chỉ dùng lại `useConfirm()` + `ConfirmDialogHost` + `LibraryConfirmDelete` **nguyên trạng**; (b) `SessionGateCard.vue` **không bị sửa**; (c) `apps/desktop/sidecar/**` + `apps/desktop/electron/**` **không bị sửa** — không RPC mới, không đổi schema; (d) `types/index.ts` không đổi, **không** state mới ở store; (e) thay đổi logic **duy nhất** ở `stores/sessions.ts` là vòng lùi `eid` của `rewind` (**AC-G24**) + comment Boy Scout; (f) **không** có `useConfirm`/DOM trong store; (g) `keepThroughId: null` viết bằng kết quả vòng lùi, **không** bằng `role`; (h) `lint` + `typecheck` = 0 error.

---

## Thứ tự ship / chia PR

| PR | Gồm task | Phụ thuộc PR | Ghi chú |
|---|---|---|---|
| **PR-B1** | B1.3 → B1.1 → B1.2 + **B1.4 (Boy Scout, hunk riêng)** + QA-G1 + QA-G2 + QA-G3 | **KHÔNG** | **Ship ngay, độc lập hoàn toàn** — chạy **song song** PR-0/PR-1/PR-2 của [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md). **Bắt buộc:** hộp thoại `rewind` **chưa có** câu "Không thể hoàn tác" (AC-G36). |
| ⏸ | — | **CHỜ `T0c.3` merge (PR-2 của feature anh em)** | **DEPENDENCY CỨNG `B2 → T0c`.** Không bắt đầu B2 trước mốc này. |
| **PR-B2** | **B2.0 (cổng AC-R7)** → B2.1 → B2.2 + QA-R | PR-B1, **T0c** | B2.1 và B2.2 **phải đi cùng một PR** — merge B2.2 mà B2.1 chưa pass = hộp thoại nói dối. |
| **PR-B3** | Z1 + Z2 | PR-B2 | Docs + review đóng. |

### Rủi ro cùng-file (đọc trước khi chia người)

| File | Task đụng (2 plan) | Khuyến nghị |
|---|---|---|
| `components/session/SessionMessageItem.vue` | **B1.1**, **B1.2**, **B2.2** · `T0a.3`, **`A1.4`** (feature anh em) | **Một dev cầm file**, tuần tự `T0a.3 → B1.1 → B1.2 → A1.4 → B2.2`. Song song = conflict gần như chắc chắn. |
| `stores/sessions.ts` | **B1.4**, **B2.1** · `T0c.3`, `A1.1` (feature anh em) | Serialize `T0c.3 → B1.4 → A1.1 → B2.1`, rebase sau mỗi merge. Đặc biệt: `A1.1` chèn prune bookmark vào cùng 4 hàm mà B1/B2 đụng ⇒ **thứ tự §6 phải giữ đúng**: `confirm()` (component) → so lại → `survivingIds` → prune → cắt (store). |
| `i18n/locales/{en,vi}/sessions.json` | B1.3 | Không đụng `sessions-transcript.json` của feature anh em ⇒ không conflict. |

---

## Ngoài phạm vi (không tạo task)

Giữ nguyên [spec §15](./session-destructive-action-guard.md): undo/khôi phục transcript đã cắt; "Đừng hỏi lại nữa"; gom 9 nút vào menu `…`; confirm cho bề mặt khác (xoá session/tab/project); cảnh báo ngân sách chi tiết (thuộc [session-cost-budget.md](./session-cost-budget.md)); đường mobile remote; **thêm `regenInFlight` cho `resend`** (chỉ sửa comment sai); lưu nháp `edit & resend` khi huỷ hộp thoại; bật `projectId` cho `sessions.rewind` để restore file; **đổi ngữ nghĩa `messageId` của `sessions.rewind` / mở rộng schema `sessions.truncate`** (đã cân nhắc và **loại** ở §12.2).

## Missing from spec

**Không có.** Q1/Q2/Q3 + TL-1 đã chốt ở §12; §11 xác nhận **không cần ADR mới, không cần infosec** cho spec này (điểm infosec duy nhất của cả 3 issue nằm ở **T0c.4** của [session-transcript-navigation.tasks.md](./session-transcript-navigation.tasks.md) — `userMessageId` L1 → path sink `sanitizeChild` tại `sidecar/src/sessions/jsonl.ts:223`). Nếu **B2.0 (AC-R7) FAIL** ⇒ đó là gap thật ⇒ **dừng, báo tech-lead**, không tự mở rộng vòng lùi trong PR.
