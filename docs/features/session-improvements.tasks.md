# Plan: Cải thiện Session (UI + Annotation) — plan gộp

> **Gộp từ** [`session-ui-improvements.tasks.md`](./session-ui-improvements.tasks.md) + [`session-annotation-improvements.tasks.md`](./session-annotation-improvements.tasks.md) (cả hai **đã superseded** bởi file này).
> Spec: [session-improvements.md](./session-improvements.md) (spec gộp — điều phối viên đang tạo song song).
> Vai trò tạo: Project Manager. Tài liệu **chỉ chia task + dependency + ước lượng + owner**, KHÔNG chứa code.
> Phạm vi: **8 issue** — 5 issue UI (SessionTabBar/SessionList/SessionMessageItem/composer) + 3 issue Annotation (đều trên `SessionDetail.vue`).

## Trạng thái triển khai (cập nhật)

**✅ Đã triển khai code toàn bộ 8 issue** (Wave 0 TL đã chốt; Wave 1–3 implement xong; Wave 4 Z.1 lint + typecheck pass 0 lỗi).

| Issue | Task implement | File chính | Trạng thái |
|---|---|---|---|
| UI-4 | U4.1 | `SessionComposer.vue` | ✅ code xong |
| UI-1 | U1.1, U1.2 | `SessionTabBar.vue` + `sessions-tabs.json` | ✅ code xong |
| UI-2 | U2.1, U2.2 | `SessionTabBar.vue` + `stores/sessions.ts` | ✅ code xong |
| UI-3 | U3.1, U3.2 | `SessionMessageItem.vue` + **`SessionTurnFullscreen.vue`** (mới) + `sessions.json` | ✅ code xong |
| UI-5 | U5.1, U5.2, U5.3 | `SessionList.vue` + `sessions.json` | ✅ code xong |
| AN-1 | AN-A.1 | `SessionDetail.vue` | ✅ code xong |
| AN-3 | AN-C.1 | `SessionDetail.vue` | ✅ code xong |
| AN-2 | AN-B.1, AN-B.2 | `SessionDetail.vue` | ✅ code xong |

- **Z.1 (lint + typecheck):** ✅ `pnpm lint` = 0 error, `pnpm typecheck` (vue-tsc strict) = 0 error.
- **Còn lại:** các task QA verify (U4.2/U1.3/U3.3/U5.4/AN-A.2/AN-C.2/AN-B.3) + Z.3 code review — **chưa chạy**.
- **Component mới:** `components/session/SessionTurnFullscreen.vue` (overlay fullscreen toàn bộ turn, Teleport to body, nhận `grouped` prop — không duplicate logic grouping).

## Cách đọc plan

- **Effort**: S (< 0.5d) / M (0.5–2d) / L (2–5d). Không task nào XL.
- **Role**: `tech-lead` (quyết định kiến trúc/OQ/scope), `developer` (implement), `qa-tester` (verify AC), `code-reviewer` (review).
- **Depends on**: task upstream phải xong trước.
- **Đánh số task lại** để tránh trùng id giữa 2 nhóm gốc: nhóm UI giữ tiền tố theo issue (`U4`, `U1`, `U3`, `U2`, `U5`), nhóm Annotation dùng (`AN-A`, `AN-C`, `AN-B`). Task đóng chung dùng `Z*`.
- Không thêm dependency mới; không backend/DB; mọi màu qua `useTheme()`/CSS var; label mới có key en/vi.

---

## ⚠ RỦI RO CÙNG-FILE (đọc trước khi chia người)

Đây là rủi ro quy trình **lớn nhất** của plan gộp. Có **hai cụm đụng cùng file** độc lập nhau:

### Cụm 1 — `SessionDetail.vue` (nhóm Annotation: A / C / B)
Cả **3 issue Annotation đều sửa cùng một file** `apps/desktop/ui-next/components/session/SessionDetail.vue` (đụng cùng `<template>` `.notepop`/`.selquote`, cùng `<script setup>` handler, cùng `<style>`).
- **Khuyến nghị: 1 developer làm TUẦN TỰ `A → C → B`** (mỗi issue một commit riêng). B lớn nhất → làm sau.
- Nếu bắt buộc chia người → **serialize theo dependency** và rebase liên tục sau mỗi merge.
- Làm song song 3 nhánh trên file này = **conflict merge gần như chắc chắn** → tránh.

### Cụm 2 — `SessionTabBar.vue` (nhóm UI: Issue 1 + Issue 2)
**Issue 1** (search project khi "+") và **Issue 2** (kéo-thả sắp xếp tab) **cùng sửa** `SessionTabBar.vue`.
- **Khuyến nghị: làm Issue 1 XONG rồi mới mở Issue 2** (xem `U2.2` depends on `U1.2`). Serialize để tránh conflict.

### Issue ĐỘC LẬP — có thể chạy song song
- **Issue 4** (composer max-height, sửa composer trong `SessionDetail`/composer area) và **Issue 1** (`SessionTabBar.vue`) — độc lập → song song được trong Wave 1.
  - *Lưu ý:* Issue 4 chạm composer trong `SessionDetail.vue`; nhóm Annotation cũng chạm `SessionDetail.vue`. Hai vùng khác nhau (composer vs `.notepop`/`.selquote`), nhưng **nếu cùng lúc chạm `SessionDetail.vue`** thì vẫn nên để **cùng một dev** cầm `SessionDetail.vue` (Issue 4 + toàn bộ nhóm Annotation) hoặc serialize commit để giảm rủi ro merge.
- **Issue 3** (fullscreen turn — `SessionMessageItem.vue`) độc lập với cả hai cụm → song song được.
- **Issue 5** (SessionList pagination — `SessionList.vue`) độc lập → song song được.

**Tóm tắt phân bổ an toàn nhất:**
| Người / luồng | Cầm file | Issue |
|---|---|---|
| Dev A | `SessionDetail.vue` | Issue 4 → AN-A → AN-C → AN-B (tuần tự) |
| Dev B | `SessionTabBar.vue` | Issue 1 → Issue 2 (tuần tự) |
| Dev C | `SessionMessageItem.vue` + `SessionList.vue` | Issue 3 ∥ Issue 5 (2 file khác nhau) |

---

## Thứ tự triển khai đề xuất (roadmap)

```
Wave 0 (chốt trước khi code)
  ├─ TL-A. Xác nhận phạm vi kỹ thuật UI (Issue 5 scope + Issue 3 mount)      [gộp T0b+T0c]
  └─ TL-B. Chốt OQ kỹ thuật Annotation nhóm B/C (+ OQ-0 chung)              [từ T0-BC]

Wave 1 (Cao)
  ├─ Issue 4:  U4.1 → U4.2(QA)                       (SessionDetail composer)
  ├─ Issue 1:  U1.1 → U1.2 → U1.3(QA)                (SessionTabBar)
  └─ Issue A:  AN-A.1 → AN-A.2(QA)                   (SessionDetail — KHÔNG chờ Wave 0)

Wave 2 (TB)
  ├─ Issue 3:  U3.1 → U3.2 → U3.3(QA)                (SessionMessageItem)
  └─ Issue C:  AN-C.1 → AN-C.2(QA)                   (SessionDetail — chờ TL-B)

Wave 3 (TB)
  ├─ Issue 2:  U2.1 → U2.2 → U2.3(QA)                (SessionTabBar — sau Issue 1)
  ├─ Issue 5:  U5.1 → U5.2 → U5.3 → U5.4(QA)         (SessionList)
  └─ Issue B:  AN-B.1 → AN-B.2 → AN-B.3(QA)          (SessionDetail — chờ TL-B, sau A/C)

Wave 4 (đóng, áp cho cả 8 issue)
  Z.1 (lint/typecheck) → Z.2 (docs) → Z.3 (review PR)
```

Ghi chú thứ tự:
- **Issue 4 + Issue 1 + Issue A** đều là ưu tiên Cao / quick win → Wave 1.
- **Issue A không phụ thuộc OQ nào** → triển khai ngay, không chờ Wave 0.
- **Issue C** chờ `TL-B` (OQ-C1/C2/C5). **Issue B** chờ `TL-B` (OQ-B3/B4) và đứng sau A/C trên cùng file `SessionDetail.vue`.
- **Issue 2** đứng sau **Issue 1** (cùng `SessionTabBar.vue`).

---

## Wave 0 — Chốt trước khi code

- [ ] **TL-A. Xác nhận phạm vi kỹ thuật UI: scope Issue 5 + mount overlay Issue 3** — S
  - **Role:** tech-lead
  - **Depends on:** none
  - **Acceptance (Issue 5 scope):** xác nhận thay đổi **chỉ trong `SessionList.vue`** (thay `useLoadMore`/`useGroupLoadMore`/`LoadMoreSentinel` bằng pagination); **KHÔNG** sửa `composables/useLoadMore.ts` hay `LoadMoreSentinel.vue` (dùng chung ở library và nơi khác). Chốt shape state phân trang **per-group** (5.a): page index **keyed by group key** (kiểu `useGroupLoadMore` — reactive map + reset clear map). Quyết định: composable mới `useGroupPagination` (file riêng) HAY reactive map cục bộ trong `SessionList`. Flat mode = một "group" duy nhất.
  - **Acceptance (Issue 3 mount):** quyết định overlay `SessionTurnFullscreen.vue` mount **local trong `SessionMessageItem`** HAY **1 instance dùng chung ở `SessionDetail`** qua composable kiểu `usePreview`. Ghi rõ lý do SoC + realtime binding (overlay bind `props.message`, không snapshot). Xác nhận **giữ nút fullscreen-response cũ** song song (3.b đã chốt).
  - **Risk:** sửa nhầm `useLoadMore`/`LoadMoreSentinel` dùng chung sẽ vỡ list khác; mount shared cần truyền message reactive đúng để AC3.2/AC3.7 realtime hoạt động.

- [ ] **TL-B. Chốt OQ kỹ thuật Annotation nhóm B/C (+ OQ-0 chung)** — S
  - **Role:** tech-lead (+ product-owner cho OQ-0, OQ-B2, OQ-C5)
  - **Depends on:** none
  - **Acceptance:** có câu trả lời văn bản (PR/issue hoặc cập nhật spec) cho từng OQ, đánh dấu "chốt MVP" hoặc "dev quyết lúc implement (fallback = đề xuất spec)". Phân loại BLOCK / Nên chốt / Dev quyết ở bảng bên dưới.
    - **OQ-0** (chung): có thêm i18n label/tooltip ("Kéo để di chuyển", hint right-click) hay tối giản (chỉ cursor grab)? — ảnh hưởng A/B/C có cần key i18n.
    - **OQ-A1**: focus-trap hay chỉ focus khởi tạo? — đề xuất: chỉ focus khởi tạo. *Dev quyết, không block.*
    - **OQ-B1**: recompute clamp realtime khi window resize hay clamp lần tương tác kế? — đề xuất: lần kế. *Dev quyết, không block.*
    - **OQ-B2**: xác nhận **không persist** vị trí/size popover? — đề xuất: không persist. *Nên chốt (persist = đụng settings store, out of MVP).*
    - **OQ-B3**: resize handle chỉ góc dưới-phải hay đủ 4 cạnh? — **BLOCK AN-B.2** + ảnh hưởng AC-B3.
    - **OQ-B4**: con số min/max width/height cụ thể (tham chiếu `WP_SIDE {min:240,max:560}`, height min ~160)? — **BLOCK AN-B.1/AN-B.2** (clamp) + AC-B3.
    - **OQ-C1**: Electron production có cần menu mặc định ở vùng không-selection? xác nhận `preventDefault` có điều kiện an toàn. — **BLOCK AN-C.1** (verify hiện trạng Electron main).
    - **OQ-C2**: đổi `@mousedown="quoteSel = null"` thành "chỉ reset khi `button===0`"? — đề xuất: có. *Nên chốt (hành vi cốt lõi Issue C; xác nhận thứ tự event Chromium/Electron).*
    - **OQ-C3**: verify Chromium giữ selection khi right-click trên vùng đã chọn. — *verify thực tế, không block.*
    - **OQ-C4**: right-click xác định `src` theo `commonAncestorContainer` hay `elementFromPoint`? — đề xuất: dùng lại logic `onSelectQuote`. *Dev quyết, không block.*
    - **OQ-C5**: giữ cả hai trigger (mouseup + right-click)? — đề xuất: giữ cả hai. *Nên chốt (định hình AC-C4/C5).*
  - **Risk:** OQ-B3/B4/C1/C2/C5 định hình AC + effort; để mở thì AN-B/AN-C vẫn code được theo đề xuất nhưng có thể phải sửa lại clamp/handle sau.

> **Ghi chú Wave-0 (từ nhóm UI gốc):** không còn open question *hướng đi* nào cho nhóm UI (đã chốt page size = 20, Issue 3 giữ cả hai nút, Issue 5 phân trang per-group). Các câu UI còn liệt kê (1.a, 1.b, 2.a, 3.a, 3.c, 3.d, 4.b, 4.c, 5.b, 5.c) là chi tiết nhỏ, dev tự quyết lúc implement theo đề xuất spec.

### Phân loại Open Question (gộp cả hai nhóm)

| OQ | Nhóm | Phân loại | Block task | Ghi chú |
|---|---|---|---|---|
| OQ-B3 | Annotation | **BLOCK** | AN-B.2 | Handle 1 góc vs 4 cạnh |
| OQ-B4 | Annotation | **BLOCK** | AN-B.1, AN-B.2 | Con số min/max clamp |
| OQ-C1 | Annotation | **BLOCK** | AN-C.1 | Verify Electron menu mặc định |
| OQ-B2 | Annotation | Nên chốt | AN-B.1/2 | Không persist (tránh đụng settings store) |
| OQ-C2 | Annotation | Nên chốt | AN-C.1 | mousedown reset chỉ left-click |
| OQ-C5 | Annotation | Nên chốt | AN-C.1 | Giữ cả hai trigger |
| OQ-0 | Chung | Dev quyết | — | Có i18n label/tooltip hay không |
| OQ-A1 | Annotation | Dev quyết | — | Focus-trap vs focus khởi tạo |
| OQ-B1 | Annotation | Dev quyết | — | Clamp realtime vs lần kế |
| OQ-C3 | Annotation | Dev quyết | — | Verify Chromium giữ selection |
| OQ-C4 | Annotation | Dev quyết | — | src theo commonAncestor vs elementFromPoint |
| UI 1.a/1.b/2.a/3.a/3.c/3.d/4.b/4.c/5.b/5.c | UI | Dev quyết | — | Chi tiết nhỏ, có đề xuất rõ trong spec |

---

## Wave 1

### Issue 4 (Cao): Composer max-height + manual resize > auto-grow — `SessionDetail.vue` (composer)

- [ ] **U4.1. Implement Phương án B: cờ manual override + max 40vh một nguồn** — S–M
  - **Role:** developer
  - **Depends on:** none (OQ 4.b/4.c dev quyết theo đề xuất: seed reset auto, có listener resize)
  - **Acceptance:**
    - Thêm cờ `userSizedManually`; `grow()` khi manual=true giữ đúng `composerH` (clamp `[MIN, MAX]`), cho cuộn nội bộ; manual=false auto-grow `clamp(MIN, scrollHeight, MAX)` (AC4.1–4.4).
    - Bỏ hằng rời rạc 640/560; JS clamp và CSS `textarea.ci { max-height }` cùng tham chiếu **40vh** (một nguồn, DRY) — AC4.5.
    - Reset cờ manual về false khi gửi message / clear draft; seed draft reset về auto (AC4.6, 4.b).
    - Thêm listener `window resize` re-clamp `composerH` theo max mới (4.c). Reduced-motion không animate.
    - `pnpm typecheck` + `pnpm lint` pass ở file chạm.
  - **Risk:** đồng bộ 40vh giữa JS (px runtime) và CSS (vh); `.cbox` (follow-up quotes/queued chips/budget banner) không đẩy transcript quá mức.

- [ ] **U4.2. Verify AC Issue 4** — S
  - **Role:** qa-tester
  - **Depends on:** U4.1
  - **Acceptance:** AC4.1–AC4.6 + edge (paste lớn inline, seed draft, window resize, reduced-motion). Xác nhận kéo tay thu nhỏ giữ được (bug gốc), toolbar/Send không bị đẩy khỏi màn hình.

### Issue 1 (Cao): SessionTabBar search project khi "+" — `SessionTabBar.vue`

- [ ] **U1.1. i18n key cho search dropdown** — S
  - **Role:** developer
  - **Depends on:** none
  - **Acceptance:** thêm `sessions.tabs.searchPlaceholder`, `sessions.tabs.noMatch` vào `i18n/locales/en/sessions-tabs.json` + `vi/sessions-tabs.json`. Giữ nguyên `noProjects` (phân biệt 2 empty state).

- [ ] **U1.2. Implement input search trong dropdown "+"** — S
  - **Role:** developer
  - **Depends on:** U1.1 (OQ 1.a/1.b dev quyết theo đề xuất: hiện path khi trùng tên; arrow-nav để sau, MVP Enter-chọn-item-đầu)
  - **Acceptance:**
    - Input sticky trên cùng `.stabs-drop`, autofocus khi mở (nextTick) — AC1.1.
    - Filter `openableProjects` substring case-insensitive; Default so khớp theo nhãn i18n (AC1.2).
    - Enter chọn item highlight (mặc định item đầu); Esc đóng + clear query; click ngoài đóng + clear (AC1.3, AC1.4, AC1.6).
    - Empty state "không khớp" (`noMatch`) khác "không còn project" (`noProjects`) — AC1.5.
    - (Đề xuất) hiển thị path rút gọn khi trùng tên (1.a); arrow-nav để sau (1.b).
    - Màu qua CSS var; `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** autofocus cần nextTick sau khi dropdown render; không đụng logic overflow menu.

- [ ] **U1.3. Verify AC Issue 1** — S
  - **Role:** qa-tester
  - **Depends on:** U1.2
  - **Acceptance:** AC1.1–AC1.6 + edge (0 project openable → noProjects; query khớp 0 → noMatch; trùng tên; click ra ngoài clear).

### Issue A (Cao, quick win): Auto-focus textarea khi mở note popover — `SessionDetail.vue` (KHÔNG chờ Wave 0)

- [ ] **AN-A.1. Focus textarea khi popover mount (nextTick + template ref) + gỡ `autofocus`** — S
  - **Role:** developer
  - **Depends on:** none (OQ-A1 dev theo đề xuất: chỉ focus khởi tạo)
  - **Acceptance:**
    - Sau khi `notePop` set + popover mount, chủ động `focus()` textarea qua `nextTick` + template ref (hoặc directive `v-focus`). Gỡ attribute HTML `autofocus` (dòng ~273) vì vô hiệu + gây hiểu lầm (AC-A1).
    - Focus hoạt động **mỗi lần** mở lại popover (AC-A2).
    - Caret ở **cuối** nội dung, không select-all, không xoá nội dung (AC-A3).
    - Esc vẫn đóng popover (`notePop = null`) — không phá hành vi Esc (AC-A4).
    - `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** không rely vào lần mount đầu; nếu dùng `v-focus` phải chạy lại mỗi lần element chèn động.

- [ ] **AN-A.2. Verify AC Issue A** — S
  - **Role:** qa-tester
  - **Depends on:** AN-A.1
  - **Acceptance:** AC-A1..AC-A4 + edge (mở→đóng→mở nhiều lần đều focus; reduced-motion/theme không ảnh hưởng; focus được kể cả sau right-click Issue C nếu C đã merge; Esc đóng bình thường).

---

## Wave 2

### Issue 3 (TB): Fullscreen TOÀN BỘ assistant turn (GIỮ CẢ HAI nút) — `SessionMessageItem.vue`

- [ ] **U3.1. i18n + tạo component overlay `SessionTurnFullscreen.vue`** — M
  - **Role:** developer
  - **Depends on:** TL-A (nơi mount)
  - **Acceptance:**
    - Component overlay `Teleport to body`, nhận `message` reactive; render lại cây `.abody` bằng cách **tái dùng** `SessionTurnActivities` / `SessionTextBlock` / `SessionStepItem` / `SessionGateCard` dựa trên `grouped` — KHÔNG duplicate logic grouping (DRY).
    - Vùng cuộn nội bộ; header có nút `x`; Esc + click nền ngoài card đóng (AC3.3, AC3.4).
    - Dev quyết theo đề xuất: activities giữ state collapse như transcript (3.a); auto-scroll khi ở đáy stream (3.c); gate read-only trong overlay (3.d).
    - Thêm i18n `sessions.message.fullscreenTurn` (en/vi). Reduced-motion không animation nặng.
  - **Risk:** binding `props.message` reactive để realtime (AC3.2/3.7); `grouped` là computed trong SessionMessageItem → mount shared cần expose/tính lại grouping không copy logic.

- [ ] **U3.2. Wire nút trigger mới vào `msgActions` (GIỮ nút cũ) + state mở/đóng + unmount an toàn** — S–M
  - **Role:** developer
  - **Depends on:** U3.1
  - **Acceptance:**
    - **GIỮ nút fullscreen-response cũ** (`openFullscreen` → PreviewModal, icon `maximize`) — KHÔNG gỡ (3.b đã chốt).
    - **THÊM entry nút mới** "fullscreen turn" (icon riêng, tooltip "Toàn màn hình toàn bộ phản hồi") vào computed `msgActions`. Hai nút icon + tooltip phân biệt rõ (AC3.8).
    - Nút cũ giữ điều kiện ẩn khi không có prose; nút mới **luôn hiển thị** cho assistant turn kể cả tool-only (AC3.9 + AC3.1).
    - Overlay tự đóng an toàn khi message bị xóa/rewind/fork lúc đang mở (edge case).
    - Đóng overlay giữ nguyên vị trí cuộn transcript (AC3.5).
    - `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** mở nút này không ảnh hưởng nút kia; không conflict với Issue 1 (khác component).

- [ ] **U3.3. Verify AC Issue 3** — M
  - **Role:** qa-tester
  - **Depends on:** U3.2
  - **Acceptance:** AC3.1–AC3.9 + edge. Đặc biệt: **AC3.8** turn có final response → footer CẢ HAI nút, tooltip phân biệt, nút cũ vẫn chỉ mở final response (PreviewModal); **AC3.9** turn tool-only → nút cũ ẩn, nút mới vẫn hiện + mở overlay (activities + gates); **AC3.2/AC3.7** realtime khi streaming + stream xong lúc overlay mở; turn rỗng lúc mới stream, gate pending read-only, turn dài cuộn nội bộ, Esc ưu tiên overlay, unmount khi rewind/fork, reduced-motion.

### Issue C (TB): Right-click hiện nút Quote tại con trỏ — `SessionDetail.vue`

- [ ] **AN-C.1. Bổ sung `@contextmenu` handler + điều chỉnh `@mousedown` reset theo left-click** — S–M
  - **Role:** developer
  - **Depends on:** TL-B (OQ-C1 verify Electron menu; OQ-C2 chốt mousedown reset chỉ left-click; OQ-C5 chốt giữ cả hai trigger)
  - **Acceptance:**
    - Thêm listener `@contextmenu` trên `.chat` **song song**, KHÔNG bỏ `@mouseup="onSelectQuote"` (giữ cả hai — OQ-C5, AC-C4).
    - Handler: kiểm tra selection hợp lệ trong `[data-mi]` (dùng lại logic `onSelectQuote` / `commonAncestorContainer` — OQ-C4). Hợp lệ → `preventDefault()` + set `quoteSel` với `x=clientX`, `y=clientY` (AC-C1). Không hợp lệ → **không** `preventDefault`, để menu mặc định (AC-C2).
    - Điều chỉnh `@mousedown="quoteSel = null"` → **chỉ reset khi `button===0`** (left-click) để right-click không xoá `quoteSel` trước khi `contextmenu` set (OQ-C2, AC-C5).
    - Nút hiện tại con trỏ (cân nhắc điều chỉnh `translate(-50%,-100%)` — theo TL). Click nút → `openNote` như luồng cũ (AC-C3).
    - Right-click nhiều lần chỉ dời nút, không nhân đôi (AC-C5); right-click khi popover đang mở → bỏ qua (edge case).
    - Label/hint mới (nếu OQ-0 chốt cần) có key en/vi. `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** thứ tự event `mousedown`(button=2) → `contextmenu` trong Chromium/Electron (OQ-C2); `preventDefault` có điều kiện không nuốt menu tuỳ biến nơi khác (OQ-C1).

- [ ] **AN-C.2. Verify AC Issue C** — S
  - **Role:** qa-tester
  - **Depends on:** AN-C.1
  - **Acceptance:** AC-C1..AC-C5 + edge (right-click ngoài `[data-mi]` giữ menu mặc định; selection qua nhiều message; right-click trong composer textarea không hiện nút; macOS Ctrl+click/two-finger; **không regression mouseup**).

---

## Wave 3

### Issue 2 (TB): Kéo-thả sắp xếp tab — `SessionTabBar.vue` (SAU Issue 1)

- [ ] **U2.1. Store: action `reorderTabs` + đảm bảo persist/index-consistency** — S
  - **Role:** developer
  - **Depends on:** none (OQ 2.a — Default kéo/ghim — dev quyết theo đề xuất)
  - **Acceptance:**
    - Thêm action `reorderTabs(fromId, toIndex)` trong `stores/sessions.ts`: reassign `openProjectTabs` theo thứ tự mới → tự persist qua watch `awog.sessions.tabs` (AC2.2).
    - Tôn trọng quyết định 2.a về Default (`id === ''`).
    - Thả về đúng vị trí cũ = no-op (không phát action thừa).
    - `closeTabsToRight` (index-based) vẫn đúng sau reorder (AC2.5) — verify.
  - **Risk:** SoC — logic reorder ở store, component chỉ phát sự kiện. Đừng để component mutate `openProjectTabs` trực tiếp.

- [ ] **U2.2. SessionTabBar: native pointer DnD + insertion indicator + auto-scroll mép** — M
  - **Role:** developer
  - **Depends on:** U2.1, **U1.2** (cùng sửa `SessionTabBar.vue` → làm sau Issue 1 để tránh conflict)
  - **Acceptance:**
    - Native pointer events (`pointerdown/move/up` + `setPointerCapture`) nhất quán `onResize` composer — KHÔNG thêm dependency (AC2.1).
    - Phân biệt click vs drag bằng ngưỡng px: dưới ngưỡng = `setActiveTab` (AC2.3); vượt = drag reorder.
    - Insertion indicator (đường accent `var(--accent)`) tại vị trí thả (AC2.4); tab nhấc opacity giảm.
    - Active tab bị kéo vẫn giữ active sau thả (AC2.6).
    - Auto-scroll strip khi pointer gần mép lúc overflow (AC2.7).
    - Đóng context/overflow menu khi bắt đầu kéo; 1 tab duy nhất → drag vô hiệu; keyboard reorder để sau (2.b).
    - Reduced-motion: bỏ animation, giữ indicator tĩnh. `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** threshold click/drag không phá roving-tabindex keyboard nav; auto-scroll cần rAF/interval clean-up khi thả.

- [ ] **U2.3. Verify AC Issue 2** — S
  - **Role:** qa-tester
  - **Depends on:** U2.2
  - **Acceptance:** AC2.1–AC2.7 + edge (thả về chỗ cũ no-op, 1 tab, overflow auto-scroll, live session mới không nhảy vị trí đang kéo, persist qua reload). Xác nhận "Close tabs to the right" đúng theo thứ tự MỚI.

### Issue 5 (TB): SessionList phân trang PER-GROUP (page size 20) — `SessionList.vue`

- [ ] **U5.1. i18n + hằng `SESSIONS_PAGE_SIZE = 20` + logic phân trang per-group** — M
  - **Role:** developer
  - **Depends on:** TL-A (scope gỡ + shape state per-group)
  - **Acceptance:**
    - Thêm i18n `sessions.list.pagePrev`, `sessions.list.pageNext`, `sessions.list.pageOf` (en/vi).
    - Hằng `SESSIONS_PAGE_SIZE = 20` (đã chốt) — áp cho cả flat và từng group.
    - Logic phân trang **per-group** (5.a): page index keyed by group key (reactive map); flat = một "group". Composable mới `useGroupPagination` hoặc reactive map cục bộ (theo TL-A).
    - **Chỉ đổi trong `SessionList.vue`**, KHÔNG sửa `useLoadMore.ts`/`LoadMoreSentinel.vue` (TL-A).
    - Reset **mọi group** về trang 1 (clear map) khi đổi search/sort/group/tab (AC5.3).
  - **Risk:** giữ SoC theo TL-A; page index per group key phải reset đúng.

- [ ] **U5.2. Thay render flat + grouped bằng phân trang per-group, gỡ LoadMoreSentinel ở SessionList** — M
  - **Role:** developer
  - **Depends on:** U5.1
  - **Acceptance:**
    - Flat: một control trang trên `filtered` phẳng (AC5.1, AC5.4).
    - Grouped: **mỗi group control trang RIÊNG** (prev/next + "trang X / Y") ở đáy group, page size 20/group, state độc lập (AC5.7). Group header count = **tổng item của group**.
    - Bấm next/prev group này không đổi trang group khác (AC5.7).
    - Gỡ `LoadMoreSentinel auto` (flat) + nút "load more" per-group **trong SessionList**; thay bằng control trang.
    - Next chặn vượt trang cuối, prev chặn dưới trang 1 (AC5.2). Kiểu control theo 5.c.
    - `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** nhiều control trang cần layout gọn; đếm tổng trang mỗi group đúng theo tổng item (AC5.7).

- [ ] **U5.3. Xử lý edge: live append không reset trang, xóa giảm trang (per-group clamp), select-all mọi trang** — S
  - **Role:** developer
  - **Depends on:** U5.2
  - **Acceptance:**
    - Session mới live KHÔNG reset trang group nào; chỉ cập nhật tổng trang group tương ứng.
    - Xóa session làm rỗng trang cuối group → tự lùi **group đó** về trang hợp lệ (clamp per-group).
    - Bulk-select / "select all" thao tác trên **toàn bộ filtered** (mọi trang, mọi group) — AC5.5 (5.b); UI làm rõ phạm vi.
    - Empty state `sessions.list.noMatch` khi khớp 0, ẩn control trang (AC5.6).
    - Fold-all/collapse group: state trang group giữ nguyên, mở lại thấy đúng trang cũ.
  - **Risk:** `allFilteredSelected`/`selectAllFiltered` đọc `filtered` (mọi trang) → giữ nguyên; render per-group không phá logic đó.

- [ ] **U5.4. Verify AC Issue 5** — M
  - **Role:** qa-tester
  - **Depends on:** U5.3
  - **Acceptance:** AC5.1–AC5.7 + edge. Đặc biệt **AC5.7**: grouped → mỗi group control trang riêng, state độc lập (đổi trang A không ảnh hưởng B), header count = tổng item group; page size = **20**/group. Còn lại: live append giữ trang, xóa lùi trang per-group, pinned ở trang 1 group, fold-all giữ trang, rename/ctx menu trong trang, select-all mọi trang.

### Issue B (TB, lớn nhất): Kéo-thả di chuyển + resize note popover — `SessionDetail.vue` (SAU A/C, chờ TL-B)

- [ ] **AN-B.1. Drag-move `.notepop` qua header `.npq` (native pointer + clamp viewport)** — M
  - **Role:** developer (+ tech-lead review pattern pointer + clamp)
  - **Depends on:** TL-B (OQ-B4 con số min/max/clamp; OQ-B2 xác nhận không persist), AN-C.1 (cùng file — làm sau C)
  - **Acceptance:**
    - Drag-handle = **header `.npq`** (KHÔNG toàn bộ popover — tránh xung đột select text) — AC-B6.
    - Tái dùng pattern `onWpResize` (dòng ~800): `pointerdown` → `setPointerCapture(pointerId)` → `pointermove`/`pointerup` trên handle, clamp `Math.max/min` (AC-B1).
    - Kéo cập nhật toạ độ popover, **giữ `noteText`** (không remount textarea) — AC-B1.
    - Clamp `x/y` trong viewport (`clientX/clientY` như `onWpResize`) — AC-B2. Khi kéo thủ công → bỏ `transform: translate(-50%,-100%)`, neo theo góc trên-trái.
    - Chống đóng nhầm: `mousedown` trên header không bubble lên `.notebackdrop` gây `notePop = null` (AC-B4); pointer capture đảm bảo move/up bắn trên header.
    - Cursor header `grab`/`grabbing`; textarea giữ caret bình thường (AC-B6). Cờ `wpDragging` tắt transition khi kéo.
    - Không persist: reset về mặc định (neo selection, width 280px) mỗi lần mở mới (AC-B5, OQ-B2).
    - Cleanup listener khi popover unmount giữa chừng (Esc/Save trong lúc drag). `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** `mousedown` header lọt ra backdrop đóng nhầm (AC-B4); pointer nhả ngoài cửa sổ; giữ `noteText` khi cập nhật toạ độ.

- [ ] **AN-B.2. Resize `.notepop` (handle góc dưới-phải, clamp min/max)** — M
  - **Role:** developer (+ tech-lead review)
  - **Depends on:** AN-B.1, TL-B (OQ-B3 handle 1 góc vs 4 cạnh; OQ-B4 min/max)
  - **Acceptance:**
    - Resize handle riêng (OQ-B3, đề xuất **góc dưới-phải**) — KHÔNG nhầm với `resize: vertical` textarea (AC-B3).
    - Clamp min/max theo OQ-B4 (đề xuất width `{min:240, max:min(560, vw-margin)}`, height `{min:160, max:vh-margin}`) — AC-B3.
    - `.npex` (trích dẫn) + textarea giãn theo popover (AC-B3); nội dung dài → scroll trong popover, không đẩy Save ra ngoài khi đã clamp.
    - Reset size về mặc định mỗi lần mở mới (AC-B5, không persist).
    - `pnpm typecheck` + `pnpm lint` pass.
  - **Risk:** phân biệt resize popover vs `resize: vertical` textarea; clamp khi popover đã dời sát mép; window resize (OQ-B1 — lần tương tác kế).

- [ ] **AN-B.3. Verify AC Issue B** — M
  - **Role:** qa-tester
  - **Depends on:** AN-B.2
  - **Acceptance:** AC-B1..AC-B6 + edge (kéo từ header không biến select-text thành drag; window resize clamp; nội dung dài scroll không đẩy Save khỏi viewport; multi-monitor/DPI dùng clientX/Y; pointer nhả ngoài cửa sổ cleanup; touch/pen; kéo/resize không bị backdrop đóng).

---

## Wave 4 — Đóng (áp cho toàn bộ 8 issue)

- [ ] **Z.1. Lint + typecheck toàn bộ thay đổi** — S
  - **Role:** developer
  - **Depends on:** U4.1, U1.2, U3.2, U2.2, U5.3, AN-A.1, AN-C.1, AN-B.2
  - **Acceptance:** `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint` → 0 error; `pnpm typecheck` (vue-tsc strict) pass. Không hardcode hex; type-import nhất quán; không `any`/`@ts-ignore`; cursor/màu qua CSS var/theme.

- [ ] **Z.2. Cập nhật docs/README nếu thêm route/component/directive/helper đáng kể** — S
  - **Role:** developer
  - **Depends on:** Z.1
  - **Acceptance:** nếu tạo `SessionTurnFullscreen.vue` / `useGroupPagination` / directive `v-focus` / helper pointer chung → ghi vào `apps/desktop/ui-next/README.md` (bảng component/composable). Đánh dấu spec + tasks "đã triển khai". Nếu i18n label mới (OQ-0) → xác nhận key en/vi đầy đủ. **Không cần ADR** (native pointer, không thêm dependency, thuần client-side).
  - **Risk:** nếu Issue 2/5/B phát sinh nhu cầu dependency ngoài dự kiến → dừng, mở ADR (rule: no new dep khi chưa có ADR).

- [ ] **Z.3. Code review PR** — S
  - **Role:** code-reviewer
  - **Depends on:** Z.1, Z.2
  - **Acceptance:** review SoC (state reorder ở store; popover là ephemeral UI state; component present), theme/cursor var, i18n en/vi đầy đủ, không đụng composable dùng chung `useLoadMore` (TL-A), giữ nút fullscreen cũ (3.b), không remount textarea khi drag (giữ `noteText`), `preventDefault` context menu đúng điều kiện (không regression menu nơi khác), không `import fs`/SDK trong component, không hardcode hex. Xác nhận **không cần infosec** (thuần client-side UI, không chạm filesystem/network/IPC/exec/parse; không phát event/trace mới; `addQuote` giữ nguyên).

---

## Bảng tổng quan: Wave → Task → Owner → Ghi chú/Blocker

| Wave | Task | Owner | Effort | Ghi chú / Blocker |
|---|---|---|---|---|
| 0 | TL-A. Scope Issue 5 + mount Issue 3 | TL | S | Chốt: chỉ sửa `SessionList.vue`; mount overlay local/shared |
| 0 | TL-B. OQ Annotation B/C + OQ-0 | TL (+PO) | S | **BLOCK**: OQ-B3/B4 → AN-B; OQ-C1 → AN-C |
| 1 | U4.1. Composer max-height | dev | S–M | Độc lập (∥ Issue 1). Chạm `SessionDetail.vue` |
| 1 | U4.2. Verify Issue 4 | QA | S | ← U4.1 |
| 1 | U1.1. i18n search dropdown | dev | S | `SessionTabBar.vue` |
| 1 | U1.2. Input search "+" | dev | S | ← U1.1. **Làm trước Issue 2 (cùng file)** |
| 1 | U1.3. Verify Issue 1 | QA | S | ← U1.2 |
| 1 | AN-A.1. Auto-focus textarea | dev | S | Quick win, KHÔNG chờ Wave 0. `SessionDetail.vue` |
| 1 | AN-A.2. Verify Issue A | QA | S | ← AN-A.1 |
| 2 | U3.1. Overlay `SessionTurnFullscreen.vue` | dev | M | ← TL-A. `SessionMessageItem.vue`, độc lập |
| 2 | U3.2. Wire nút + state | dev | S–M | ← U3.1. Giữ nút cũ (3.b) |
| 2 | U3.3. Verify Issue 3 | QA | M | ← U3.2 |
| 2 | AN-C.1. `@contextmenu` handler | dev | S–M | ← TL-B (OQ-C1/C2/C5). `SessionDetail.vue`, sau A |
| 2 | AN-C.2. Verify Issue C | QA | S | ← AN-C.1 |
| 3 | U2.1. Store `reorderTabs` | dev | S | `stores/sessions.ts` |
| 3 | U2.2. Native pointer DnD tab | dev | M | ← U2.1, **U1.2 (cùng file `SessionTabBar.vue`)** |
| 3 | U2.3. Verify Issue 2 | QA | S | ← U2.2 |
| 3 | U5.1. Pagination per-group + hằng 20 | dev | M | ← TL-A. `SessionList.vue`, độc lập |
| 3 | U5.2. Render per-group, gỡ Sentinel | dev | M | ← U5.1 |
| 3 | U5.3. Edge: live/xóa/select-all | dev | S | ← U5.2 |
| 3 | U5.4. Verify Issue 5 | QA | M | ← U5.3 |
| 3 | AN-B.1. Drag-move popover | dev (+TL) | M | ← TL-B (OQ-B4/B2), AN-C.1 (cùng file, sau C) |
| 3 | AN-B.2. Resize popover | dev (+TL) | M | ← AN-B.1, TL-B (OQ-B3/B4) |
| 3 | AN-B.3. Verify Issue B | QA | M | ← AN-B.2 |
| 4 | Z.1. Lint + typecheck | dev | S | ← mọi task implement |
| 4 | Z.2. Docs/README | dev | S | ← Z.1 |
| 4 | Z.3. Code review PR | reviewer | S | ← Z.1, Z.2. Không cần infosec |

---

## Blocker chính

1. **TL-B (Wave 0)** block AN-B và AN-C:
   - OQ-B3 → AN-B.2 (shape resize handle).
   - OQ-B4 → AN-B.1 + AN-B.2 (con số clamp min/max).
   - OQ-C1 → AN-C.1 (verify Electron menu mặc định).
   - *Không* block Issue A (quick win).
2. **Rủi ro cùng-file (rủi ro quy trình lớn nhất):**
   - `SessionDetail.vue`: nhóm Annotation A/C/B + Issue 4 → serialize (1 dev cầm file, thứ tự 4 → A → C → B).
   - `SessionTabBar.vue`: Issue 1 + Issue 2 → serialize (Issue 1 xong mới mở Issue 2; U2.2 depends U1.2).
3. **TL-A (Wave 0)** không hard-block nhưng nên xong trước U3.1 (mount overlay) và U5.1 (scope pagination) để tránh sửa lại.

---

## Missing from spec / cần làm rõ

- **Không có gap chặn.** Toàn bộ open question hướng đi đã có đề xuất rõ trong spec.
- **Nên chốt trước khi mở AN-B/AN-C:** OQ-B3, OQ-B4, OQ-C1, OQ-C2, OQ-C5 (xem bảng phân loại OQ).
- **Nhóm UI:** không còn OQ hướng đi (đã chốt page size 20, giữ cả hai nút fullscreen 3.b, per-group 5.a). Các câu còn lại là chi tiết dev tự quyết.
- **Issue A** không phụ thuộc OQ nào → triển khai ngay.

---

## Tổng hợp

- **Tổng số task: 28** = 2 Wave-0 (TL-A, TL-B) + 23 implement/QA + 3 Wave-4 đóng (Z.1–Z.3).
  - Nhóm UI: 17 task gốc → gộp 2 Wave-0 UI (T0b+T0c) thành TL-A và gộp 3 Wave-4 UI vào Z.* chung. Còn 12 implement/QA UI.
  - Nhóm Annotation: 11 task gốc → T0-BC thành TL-B, gộp 3 Wave-4 vào Z.* chung. Còn 7 implement/QA Annotation.
  - Wave-4 đóng: 3 task chung (thay vì 3+3 riêng lẻ → tránh trùng).
  - **Không mất task nào**: mọi implement + verify (tách riêng) + Wave-0 (chốt OQ) + lint/typecheck + docs + review đều được giữ; chỉ hợp nhất 2 bộ Wave-4 trùng lặp thành 1 bộ Z.*.
- **Số wave: 5** (Wave 0 → Wave 4).
- **Ước lượng tổng effort (8 issue):**
  - Wave 0: ~0.5 ngày (2 task S — quyết định/verify).
  - Issue 4 (S–M) + Issue 1 (2×S) + Issue A (S): ~1.5 ngày.
  - Issue 3 (M + S–M) + Issue C (S–M): ~2 ngày.
  - Issue 2 (S + M) + Issue 5 (2×M + S) + Issue B (2×M): ~3.5 ngày.
  - Wave 4 đóng: ~0.5 ngày.
  - QA verify chạy song song dev cho phần lớn.
  - **Tổng ~7–9 ngày công** cho 1 dev + QA song song (nếu chia 2–3 dev theo bảng phân bổ an toàn thì wallclock rút còn ~4–5 ngày, nhưng vẫn phải serialize theo rủi ro cùng-file ở cụm 1 và cụm 2).
- **Không** thêm dependency, **không** ADR (native pointer + không dep đã xác nhận), **không** backend/DB, thuần client-side → **không cần infosec**.

---

## Round 2 — Bugfix từ manual test (2026-07-22 từ user)

> User đã manual test 8 issue vừa implement. Kết quả: **5 pass, 3 lỗi**.
> **PASS (không cần đụng):** ① UI-1 search project tab · ③ UI-3 fullscreen turn · ④ UI-5 pagination · ⑥ AN-1 auto-focus note · ⑦ AN-2 drag+resize notePop → **giữ nguyên code, không sửa**.
> Section này chỉ chứa **3 task bugfix** cho 3 lỗi còn lại. PM đã đọc code thật để xác nhận root cause; task ghi kèm dòng/hàm + hướng sửa đề xuất.

### Bảng tóm tắt 3 lỗi

| Task | Issue gốc | File chính | Triệu chứng | Mức độ | Owner |
|---|---|---|---|---|---|
| R2-U2 | ② UI-2 kéo-thả tab | `SessionTabBar.vue` (store `reorderTabs` đã OK) | Drag **hoàn toàn không hoạt động** | **Cao** (tính năng chết) | developer |
| R2-U4 | ⑤ UI-4 composer resize | `SessionComposer.vue` | Bắt đầu kéo → height **nhảy giật về min** dù chưa kéo tới | **Cao** (UX vỡ) | developer |
| R2-AN3 | ⑧ AN-3 right-click quote | `SessionDetail.vue` | Right-click → nút hiện đúng chỗ, **nhả chuột phải thì nhảy về vị trí neo cũ** | TB | developer |

### Rủi ro cùng-file (Round 2)

**3 fix ĐỘC LẬP — chạm 3 file khác nhau → chạy song song được, KHÔNG serialize:**
- R2-U4 → `apps/desktop/ui-next/components/session/SessionComposer.vue`
- R2-U2 → `apps/desktop/ui-next/components/session/SessionTabBar.vue` (store `reorderTabs` đã đúng, **không cần sửa store**)
- R2-AN3 → `apps/desktop/ui-next/components/session/SessionDetail.vue`

Không đụng cùng file với nhau → không cần rebase serialize như Round 1. Sau cả 3: chạy **R2-Z** (lint + typecheck + re-test) trước khi đóng.

---

- [ ] **R2-U2. Sửa kéo-thả sắp xếp tab không kích hoạt** — S
  - **Role:** developer
  - **Depends on:** none (store `reorderTabs` đã verify đúng)
  - **Root cause (xác nhận qua đọc code):**
    - Store `stores/sessions.ts` `reorderTabs` (dòng 1011–1021) **ĐÚNG** (indexOf → splice → reassign persist). **Lỗi không ở store.**
    - Composable `useSessionTabs.ts` cấp `tabs` chuẩn (dòng 49–59). **Không phải nguồn lỗi.**
    - Lỗi ở handler pointer `onTabPointerDown` trong `SessionTabBar.vue` (dòng 342–385). Candidate đã đọc code, xếp theo khả năng:
      1. **`setPointerCapture` lệch element vs listener (khả năng cao nhất).** Listener `move`/`up` gắn trên `window` (dòng 382–384), còn `setPointerCapture(dragPointerId)` gọi trên `dragEl` = `.stab` (dòng 358) **chỉ sau khi vượt threshold**. Trước threshold không có capture; nếu trong Electron/Chromium mouse-drag (giữ nút + di chuyển) khởi phát native behavior hoặc `pointermove` không đến `window` trước khi threshold đạt được, nhánh `!dragStarted` (dòng 350–359) **không chạy tới** → `dragStarted` mãi `false` → `up` rơi vào nhánh click (dòng 368–370) → chỉ `setActiveTab`, "drag không hoạt động".
      2. **Threshold có thể nuốt drag:** `DRAG_THRESHOLD = 5` (dòng 285) chỉ so `Math.abs(ev.clientX - dragStartX)` trục X (dòng 352). Đúng cho strip ngang, nhưng phụ thuộc `pointermove` phát đủ trên `window`.
      3. **`pointerdown` bị chặn cục bộ:** nút close có `@pointerdown.stop` (dòng 43) — chỉ chặn khi bấm đúng nút X, **không** giải thích drag chết trên toàn thân tab → loại trừ cho vùng thân.
      4. **`touch-action`:** `.stab` đã có `touch-action: none` (dòng 610) nhưng **`.stabs-scroll` (container `overflow-x:auto`) KHÔNG có** → touch/pen: pan ngang container có thể cướp gesture (không ảnh hưởng chuột, nhưng nên vá luôn).
  - **Hướng sửa đề xuất (developer verify runtime rồi chốt):**
    - **Ưu tiên:** đổi mô hình capture — gọi `setPointerCapture(e.pointerId)` **ngay trong `pointerdown`** (không đợi threshold) và gắn `move`/`up` **trên chính `dragEl`** (element đã capture) thay vì `window`; giữ threshold **chỉ để phân biệt** click vs drag (dưới ngưỡng = `setActiveTab`, vượt = bắt đầu reorder). Đây là pattern pointer-capture chuẩn, khớp `onResize` composer (capture ngay trên handle). SoC giữ nguyên (reorder qua `store.reorderTabs`, component không mutate `openProjectTabs`).
    - Thêm `touch-action: none` cho `.stabs-scroll` (song song `.stab`).
    - Instrument tạm (`console.debug` trong `move`/nhánh threshold) để xác nhận nhánh nào không chạy → gỡ trước commit.
  - **Acceptance (verify lại):**
    - Kéo một tab (≥2 tab) vượt ngưỡng → tab nhấc (`opacity .4`), insertion indicator accent tại slot thả, nhả → thứ tự đổi đúng qua `store.reorderTabs` (AC2.1–2.4).
    - Bấm nhanh dưới ngưỡng vẫn `setActiveTab` (không biến click thành drag) — AC2.3.
    - Active tab bị kéo vẫn active sau thả (AC2.6); auto-scroll mép khi overflow (AC2.7).
    - Thả về đúng chỗ cũ = no-op; persist qua reload; "Close tabs to the right" đúng thứ tự MỚI (AC2.5).
    - Edge: 1 tab → drag vô hiệu; right-click vẫn mở context menu (không bị handler drag nuốt — giữ dòng 344 `if (e.button !== 0) return`); keyboard roving-tabindex nav (dòng 263–277) không hỏng.
    - `pnpm typecheck` + `pnpm lint` pass.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionTabBar.vue` (KHÔNG sửa `stores/sessions.ts`).
  - **Risk:** đổi capture-model không phá roving-tabindex keyboard nav; cleanup listener + `stopEdgeScroll` (dòng 386) khi thả/unmount.

- [ ] **R2-U4. Sửa composer nhảy giật về min khi bắt đầu kéo chỉnh chiều cao** — S
  - **Role:** developer
  - **Depends on:** none
  - **Root cause (xác nhận qua đọc code `SessionComposer.vue`):**
    - Ở chế độ auto-grow (`userSizedManually = false`), `grow()` (dòng 634–645) set chiều cao textarea theo `el.scrollHeight` (dòng 644) nhưng **KHÔNG cập nhật `composerH`** — biến này giữ giá trị khởi tạo `COMPOSER_MIN_H = 40` (dòng 629). Tức chiều cao *hiển thị thực* (do scrollHeight) ≠ `composerH` (=40).
    - Khi bắt đầu kéo, `onResize` (dòng 646–669): dòng 649 bật `userSizedManually = true`, dòng 651 lấy **`startH = composerH.value` (=40, stale)** làm baseline. Move đầu tiên (dòng 654–660) tính `composerH = clamp(MIN, startH - delta, MAX)` với `startH=40` → ~40 → `grow()` (giờ manual=true, dòng 637–640) áp đúng 40px → **height sụp từ max về min ngay, giật.**
  - **Hướng sửa đề xuất:** trong `onResize`, TRƯỚC khi tính baseline, đo **chiều cao hiển thị thực** của textarea và seed baseline bằng nó: `const startH = ta.value ? ta.value.getBoundingClientRect().height : composerH.value` (hoặc `ta.value.offsetHeight`); đồng thời set `composerH.value = startH` rồi mới `userSizedManually.value = true`. Như vậy delta cộng/trừ từ đúng chiều cao đang thấy, không sụp về 40. Giữ clamp `[MIN, composerMaxH]`.
  - **Acceptance (verify lại):**
    - Paste prompt dài → box ở max-height (40vh). Bắt đầu kéo handle **thu nhỏ mượt theo con trỏ** từ max xuống tới min, **không nhảy giật** (bug gốc).
    - Kéo giãn to lại đúng max 40vh, không vượt; toolbar/Send không bị đẩy khỏi màn hình.
    - Không regression AC4.1–4.6: manual override vẫn thắng auto-grow; gửi/clear/seed draft reset `userSizedManually = false` về auto-grow; window resize re-clamp.
    - Edge: bắt đầu kéo khi box đang ở min (short draft) → không nhảy lên; auto-grow ở mức trung gian → baseline = chiều cao đang thấy; reduced-motion không animate.
    - `pnpm typecheck` + `pnpm lint` pass.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionComposer.vue` (hàm `onResize`, dòng ~646–660).
  - **Risk:** `getBoundingClientRect().height` gồm padding/border (box-sizing) — xác nhận nhất quán với cách `grow()` set `el.style.height` để baseline khớp; nếu lệch, dùng cùng metric mà `grow()` dùng.

- [ ] **R2-AN3. Sửa nút Quote nhảy về vị trí neo cũ khi nhả chuột phải** — S
  - **Role:** developer
  - **Depends on:** none
  - **Root cause (xác nhận qua đọc code `SessionDetail.vue`):**
    - `.chat` bind `@mouseup="onSelectQuote"` (dòng 178) **không có button-guard**. Chuỗi event right-click (Chromium/Electron macOS/Linux): `mousedown`(button=2) → `onChatMouseDown` (dòng 640–642) bỏ qua vì `if (e.button === 0)` → `contextmenu` → `onQuoteContextMenu` (dòng 630–636) set `quoteSel = { x: e.clientX, y: e.clientY }` (đúng, tại con trỏ) → **`mouseup` bắn → `onSelectQuote` (dòng 613–625) chạy vô điều kiện** ghi đè `quoteSel.x = rect.left + rect.width/2`, `quoteSel.y = rect.top - 8` (dòng 622–623) → nút **nhảy về neo đỉnh-giữa selection**.
    - Nút `.selquote` bind vị trí từ `quoteSel.x/y` (dòng 258) nên bị dời theo ngay.
  - **Hướng sửa đề xuất:** cho `onSelectQuote` **nhận event** + bỏ qua khi không phải left-click: `function onSelectQuote(e: MouseEvent) { if (e.button !== 0) return; ... }`; template `@mouseup="onSelectQuote"` (Vue truyền `$event` mặc định cho listener 1 tham số) hoặc `@mouseup="(e) => onSelectQuote(e)"`. Luồng left-drag bôi đen (button=0) giữ nguyên neo đỉnh-giữa (không regression).
  - **Acceptance (verify lại):**
    - Right-click trên selection → nút Quote hiện **tại con trỏ**; **nhả chuột phải → nút GIỮ nguyên vị trí con trỏ**, không nhảy (AC-C1, AC-C5).
    - Bôi đen bằng left-drag → mouseup vẫn neo đỉnh-giữa selection như cũ (AC-C4, **không regression**).
    - Edge: right-click ngoài `[data-mi]` → giữ menu mặc định (không set nút); right-click khi note popover đang mở → bỏ qua (dòng 631); right-click nhiều lần chỉ dời nút không nhân đôi; click nút → `openNote` như luồng cũ.
    - `pnpm typecheck` + `pnpm lint` pass.
  - **File chạm:** `apps/desktop/ui-next/components/session/SessionDetail.vue` (hàm `onSelectQuote` dòng ~613, template `@mouseup` dòng 178).
  - **Risk:** một số trình duyệt phát `mouseup` với `button=2` sau contextmenu, một số không — guard `e.button !== 0` an toàn cho cả hai (chỉ chạy khi chắc chắn left-click); không đụng `onQuoteContextMenu`/`onChatMouseDown` đã đúng.

### Đóng Round 2

- [ ] **R2-Z. Lint + typecheck + verify lại 3 lỗi** — S
  - **Role:** developer (+ qa-tester verify AC)
  - **Depends on:** R2-U2, R2-U4, R2-AN3
  - **Acceptance:** `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint` = 0 error; `pnpm typecheck` pass; manual re-test 3 lỗi theo AC từng task; xác nhận **5 issue pass (①③④⑥⑦) không regression**. Thuần client-side → không cần infosec.
