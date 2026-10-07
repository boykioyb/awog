# Plan: #34 — Hợp đồng thứ tự `suggest_followups` (vá lỗi lặp câu trả lời)

> **Spec:** [session-model-surfaces.md § #34 — Hợp đồng thứ tự](./session-model-surfaces.md#hợp-đồng-thứ-tự-gọi-suggest_followups-trước-câu-trả-lời-cuối) · **ADR:** [0096](../decisions/0096-followups-before-final-answer.md) · **Nhánh:** `fix/followups-duplicate-answer` · **Ưu tiên:** P1, bản vá kế tiếp.
> Vai trò tạo: Project Manager. Tài liệu **chỉ chia task + dependency + ước lượng + owner + acceptance**, KHÔNG chứa code.
> Hướng đã chốt (PO, 2026-10-06): **đảo thứ tự** — model gọi `suggest_followups` NGAY TRƯỚC câu trả lời cuối; UI luôn vẽ chip ở CUỐI message. Ngoài phạm vi: sửa CLI Claude, `prompt_suggestion`/`sawFollowups`, dedupe heuristic phía client, viết lại transcript cũ.

## Quyết định cho open question (chốt 2026-10-06)

| OQ | Quyết định | Hệ quả cho plan |
|---|---|---|
| **OQ-FU-1** — fullscreen có hiện chip không | **GIỮ ẩn** như hiện tại (`SessionTurnFullscreen` vẫn truyền `is-last="false"`). Chỉ cần bảo đảm không có chip nào nằm giữa/trên khối text. | T4 không đụng logic hiển thị của fullscreen; AC-FU-2 được thoả bằng việc hoist ở lớp gom nhóm dùng chung. |
| **OQ-FU-2** — lượt bị huỷ/lỗi có hiện chip không | **VẪN hiện** khi lượt đã kết thúc (`streaming` = false). Lượt lỗi: chip nằm **sau** thẻ lỗi. | KHÔNG thêm cờ "kết thúc bình thường", KHÔNG đọc `stopReason`. Điều kiện duy nhất mới là `!streaming`. |
| **OQ-FU-3** — đo đạc | Dùng **cách phân loại mới BA đề xuất**: *viết lại* = ≥ 2 khối text dài cùng nội dung (một trước, một sau surface); *đuôi thừa* = có câu nhắc tới chip/gợi ý ở bất kỳ đâu trong message; còn lại = *sạch*. QA đo baseline độ phủ (M4) **trước khi merge**, trên `~/.awog/sessions/*` của máy đo, chỉ tính message tạo trước ngày merge. | T6 (baseline, chặn merge) và T8 (đo sau merge). |
| **OQ-FU-4** — câu chữ kết quả tool | **Đã chốt** trong [ADR 0096](../decisions/0096-followups-before-final-answer.md) D1: phương án (c) — cấm viết lần hai nhưng bắt kết bằng một câu ngắn; câu chữ nguyên văn của mô tả + kết quả nằm trong ADR. `COMMUNICATION_PROMPT` **không** sửa (D2). | T1 xong ⇒ T2 mở khoá. |

## Cách đọc plan

- **Effort:** XS (< 2h) · S (< 0.5d) · M (0.5–2d). Không task nào L/XL.
- **Owner:** `tech-lead` · `developer` · `qa-tester` · `code-reviewer`.
- **Acceptance** trỏ thẳng tới AC trong spec: **AC-FU-1…10** (hành vi, chặn merge) và **AC-FU-M1…M5** (đo thủ công, KHÔNG chặn merge — trừ baseline của M4).
- **DoD chung cho task code:** UI `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint && pnpm typecheck` — 0 error; sidecar: typecheck + test của package `@awog/sidecar` xanh.
- Không RPC mới, không đổi schema JSONL, không entity mới, không dependency mới, không migration. Thứ tự `parts` trên đĩa **không đổi**.

## DAG phụ thuộc

```
T1 (ADR 0096) ──→ T2 (sidecar text) ──→ T3 (unit test) ──┐
T4 (UI hoist + gate) ─────────────────────────────────────┼─→ T6 (QA trước merge) ─→ T7 (review) ─→ merge ─→ T8 (đo sau merge)
T6a (baseline M4, trong T6 — bắt đầu ngay, không phụ thuộc) ┘
T5 (docs) ← T1, T2, T4  ──────────────────────────────────────────────────────────→ T7
```

T4 **độc lập** với T1/T2 (lớp hiển thị) ⇒ chạy song song ngay từ đầu.

---

## MVP scope (chặn merge)

- [x] **T1. Viết ADR 0096 — hợp đồng thứ tự `suggest_followups` + câu chữ kết quả tool** — **S**
  - **Role:** tech-lead
  - **Depends on:** none
  - **Mô tả:** Tạo [`docs/decisions/0096-followups-before-final-answer.md`](../decisions/0096-followups-before-final-answer.md). Nội dung: bối cảnh (2 cơ chế trong spec), quyết định "đảo thứ tự", phương án bị loại ("bảo model dừng hẳn sau tool" — 3 lý do a/b/c của spec), và **chốt OQ-FU-4**: câu chữ chính xác của (1) mô tả tool, (2) kết quả tool khi thành công. Ghi rõ đánh đổi đã chọn giữa (a) có câu "đã viết rồi thì đừng viết lại" (rủi ro lượt rỗng ⇒ kích hoạt cơ chế 2 của CLI) và (b) chỉ "viết câu trả lời cuối ngay" (rủi ro model theo thói quen cũ viết lại), và chỉ số nào bắt được nếu chọn sai (M1 cho (b), M3 cho (a)). Thêm dòng vào `docs/decisions/README.md`.
  - **Acceptance:** ADR có trạng thái Accepted; câu chữ chốt thoả **AC-FU-6** (không còn "as the LAST tool call of your reply", nói gọi ngay trước câu trả lời cuối khi đã biết sẽ kết luận gì) và **AC-FU-7** (a/b/c: không nhắc chip/gợi ý/vị trí — không "under your answer", "below", "shown"; không mời viết lại/tóm tắt lại; bảo model viết câu trả lời cuối). Có mục "Cách đo lại" trỏ M1/M3.
  - **Risk:** câu chữ là biến số duy nhất quyết định M1/M3; nếu sau T8 không đạt thì quay lại ADR này (supersede câu chữ), không vá ở UI.
  - **Kết quả (2026-10-06):** chọn phương án (c) — kết quả tool cấm viết lần hai **và** bắt kết bằng một câu ngắn (giữ lượt có text sau tool ⇒ không kích hoạt cơ chế 2). Câu chữ nguyên văn + danh sách cụm từ cấm/bắt buộc cho T3 ở ADR 0096 D1 / "Việc cần làm tiếp". Đính chính chẩn đoán: `COMMUNICATION_PROMPT` chỉ có ở nhánh Pi ⇒ không sửa (D2). Thiết kế UI cho T4 ở D3.

- [x] **T2. Sửa mô tả + kết quả tool `suggest_followups` ở sidecar (một nguồn cho 2 runtime)** — **XS**
  - **Role:** developer
  - **Depends on:** T1
  - **Mô tả:** Áp đúng câu chữ ADR 0096 D1 vào `SURFACE_TOOL_TEXT.suggestFollowups.description` và key mới `SURFACE_TOOL_TEXT.suggestFollowups.recorded` (chuỗi thành công), rồi cho `runSuggestFollowups` trả hằng đó thay cho literal, trong `apps/desktop/sidecar/src/runtime/tools/surface-tools.ts`. Rà comment/chuỗi cùng ý còn sót (`surface-tools.ts` đầu file "under the last reply", `types/shared.ts:881`, `surface-sdk-server.ts`) để không còn mô tả nào nói "gọi sau câu trả lời". **Không** sửa `COMMUNICATION_PROMPT` (ADR 0096 D2), **không** đụng `event-adapter.ts` `sawFollowups`, **không** đổi chuỗi từ chối lần 2 / `options` rỗng.
  - **Acceptance:** **AC-FU-6**, **AC-FU-7** (theo câu chữ ADR), **AC-FU-8** (Pi `createSuggestFollowupsTool` và SDK server cùng đọc một hằng — grep không thấy chuỗi thứ hai), **AC-FU-9** (chuỗi từ chối giữ nguyên). Phiên cũ khi resume nhận mô tả mới (spec điểm 7 — không cần thay đổi gì thêm, chỉ xác nhận mô tả không nằm trong `systemPrompt.append`).
  - **Kết quả (2026-10-06):** `description` + key mới `recorded` khớp từng byte hai khối `text` của ADR 0096 D1 (đã so bằng script đọc thẳng file ADR); `runSuggestFollowups` trả `SURFACE_TOOL_TEXT.suggestFollowups.recorded`, chuỗi từ chối giữ nguyên. Comment "under the last reply" → "at the end of the last reply" ở `surface-tools.ts` và `types/shared.ts`. `surface-sdk-server.ts` vốn đã đọc `SURFACE_TOOL_TEXT` (không có chuỗi riêng) nên không đổi. Không test cũ nào assert chuỗi cũ.

- [x] **T3. Unit test cho text + hành vi `suggest_followups`** — **S**
  - **Role:** qa-tester
  - **Depends on:** T2
  - **Mô tả:** Thêm test trong `apps/desktop/sidecar/src/runtime/tools/__tests__/` (cùng chỗ `report-findings.test.ts`). Kiểm trên **chuỗi thật** trả về từ `runSuggestFollowups` và trên mô tả tool, không chụp snapshot nguyên văn (để đổi câu chữ sau này không phải sửa test vô nghĩa) — kiểm bằng danh sách cụm từ CẤM + cụm từ BẮT BUỘC (danh sách cụ thể ở ADR 0096, mục "Việc cần làm tiếp").
  - **Acceptance:** test xanh và phủ: **AC-FU-6** (mô tả không chứa "LAST tool call"/"after your answer"); **AC-FU-7** (kết quả thành công không chứa `under your answer`/`below`/`shown`/`chip`/`suggestion` theo nghĩa vị trí, không chứa lời mời viết lại/tóm tắt lại; có yêu cầu viết câu trả lời cuối); **AC-FU-8** (mô tả lấy từ Pi tool và từ SDK server giống từng byte); **AC-FU-9** (gọi lần 2 trong cùng lượt ⇒ `isError`, câu "already offered in this reply", không sinh surface thứ hai; `options` rỗng ⇒ từ chối).
  - **Kết quả (2026-10-06, qa-tester):** file mới [`apps/desktop/sidecar/src/runtime/tools/__tests__/suggest-followups.test.ts`](../../apps/desktop/sidecar/src/runtime/tools/__tests__/suggest-followups.test.ts) — **39 test**, xanh. Phủ:
    - **AC-FU-6** — mô tả không chứa (không phân biệt hoa thường) `LAST tool call` / `after your answer` / `under your answer` / `below` / `shown`; có `BEFORE you write your final answer`, `you know what you will conclude`, `never after it`, `AT MOST ONCE`, `never mention, list or point to them`.
    - **AC-FU-7** — `runSuggestFollowups` hợp lệ trả đúng `SURFACE_TOOL_TEXT.suggestFollowups.recorded`; chuỗi đó không chứa 11 từ cấm của ADR 0096 (`under`, `below`, `shown`, `chip`, `suggest`, `follow-up`, `option`, `rewrite`, `repeat`, `restate`, `summar`); có `final answer`, `do not write it a second time`, `one short closing sentence` (2 vế của phương án (c)); 1/2/3 option ra cùng một chuỗi, không có chữ số.
    - **AC-FU-8** — nhánh Pi (`createSurfaceTools` → AgentTool `suggest_followups`) và nhánh Claude SDK (`buildSurfaceToolsSdkServer`, `tool()`/`createSdkMcpServer` được `vi.mock` để ghi lại tham số, handler vẫn là closure thật) cho mô tả + kết quả hợp lệ + kết quả từ chối **giống từng byte**.
    - **AC-FU-9** — lần 2 trong lượt ⇒ `Rejected: follow-up suggestions were already offered in this reply.`, không surface, bộ đếm giữ 1; Pi ⇒ `details: { isError: true }`, SDK ⇒ `isError: true`. `options` rỗng / chỉ khoảng trắng / không phải mảng / thiếu ⇒ `Rejected: no follow-up text was given.` và **không** tiêu ngân sách lượt. Cắt còn 3 option. Step-mapper: lời gọi bị từ chối (cả tên trần lẫn `mcp__awogsurfaces__suggest_followups`) ⇒ step `kind: 'tool'`, `status: 'error'`, không có `surface` (nửa sidecar của "render thành tool row lỗi"); lời gọi hợp lệ ⇒ `surface` running → done.
    - **Kiểm đột biến:** chạy file test trên `surface-tools.ts` bản HEAD (trước vá) ⇒ 22/35 đỏ; giữ key `recorded` nhưng gán lại câu cũ `"…under your answer. Do not list them again…"` ⇒ 4 đỏ (`under`, `follow-up`, `final answer`, phương án (c)). Đã khôi phục file sau khi kiểm.
    - Câu chữ trong code so với 2 khối `text` của ADR 0096 D1 (script đọc thẳng file ADR): **khớp từng byte** cả `description` lẫn `recorded`.
    - Lệnh: `cd apps/desktop/sidecar && env -u ENABLE_TOOL_SEARCH npx vitest run` ⇒ **125 file / 2493 test xanh**; `pnpm typecheck` ⇒ exit 0.

- [x] **T4. UI: hoist chip `followups` xuống cuối message + chỉ hiện khi lượt đã kết thúc (transcript, fullscreen, export)** — **M**
  - **Role:** developer
  - **Depends on:** none (song song T1–T3)
  - **Mô tả:** Ba bề mặt, một quy tắc: **surface `followups` hợp lệ luôn là phần tử cuối của thân message**, bất kể vị trí trong `parts`; thuần hiển thị, tính lại từ `parts`, không ghi JSONL. Thiết kế chi tiết (tên hàm/file): **ADR 0096 D3**.
    1. **Hàm dùng chung:** `displayBlockOrder(blocks): number[]` mới trong `utils/session-turns.ts` — trả **chỉ số gốc** theo thứ tự hiển thị (`followups` dồn cuối), không sắp lại mảng `blocks`.
    2. **Transcript + fullscreen:** computed `grouped` của `SessionMessageItem.vue` duyệt theo `displayBlockOrder(blocks)` (fullscreen tái dùng `grouped`) ⇒ một chỗ sửa phủ cả hai. Fullscreen **giữ** `is-last="false"` (OQ-FU-1).
    3. **Gate theo lượt kết thúc:** chip chỉ hiện + bấm được khi `streaming` = false. Theo ADR 0096 D3 mục 3, cổng đặt **trong `grouped`** (không phát group `followups` khi `message.streaming`), KHÔNG ở prop `isLast` của `SessionFollowupSuggestions.vue` — để caret của text cuối và autoscroll của fullscreen không bị group chip ẩn chiếm vị trí cuối. Lượt huỷ/lỗi vẫn hiện (OQ-FU-2), chip đứng **sau** thẻ lỗi.
    4. **Export:** `composables/useSessionExport.ts` `buildMarkdown` map qua `displayBlockOrder(m.blocks)` — dòng `_Suggested next:_ …` là dòng cuối phần nội dung message (markdown + HTML).
    5. Gợi ý `prompt_suggestion` của SDK (gate tạo ở `stores/sessions.ts` ~1162, cùng kind `followups`) đi chung quy tắc trên.
  - **Acceptance:** **AC-FU-1** (parts = [step…, followups, text B] ⇒ chip sau B, B là câu trả lời chính, không bị gom vào activities) · **AC-FU-2** (fullscreen: không chip nào giữa/trên text) · **AC-FU-3** (export: dòng gợi ý là dòng cuối) · **AC-FU-4** (đang stream text cuối / đang chạy tool khác / đang dừng chờ AskUserQuestion hoặc permission ⇒ chip ẩn; kết thúc ⇒ hiện) · **AC-FU-5** (JSONL cũ [A, followups, B] ⇒ chip sau B, file không bị ghi lại, B vẫn hiển thị) · **AC-FU-9** (lời gọi bị từ chối render thành tool row lỗi TẠI CHỖ, không bị đưa xuống cuối) · **AC-FU-10** (chỉ message cuối, ẩn khi gõ, bấm chỉ seed composer đúng phiên ở chế độ lưới, không tự gửi).
  - **Risk:**
    - `highlightsForBlock(g.blockIndex)` dùng **index gốc** của block ⇒ nếu đổi thứ tự mảng `blocks` trước khi gom thì highlight trích dẫn (§8) lệch chỗ. ADR 0096 D3 xử lý bằng cách duyệt theo **chỉ số gốc**, không sắp lại `blocks`.
    - Heuristic "dán text bị chẻ qua surface" (`SessionMessageItem.vue` ~368–386): ADR 0096 D3 đã kiểm — `midWordTail` vốn nhìn xuyên qua group gate (`out.findLast(type === 'text')`), nên hoist không đổi cặp text nào được dán. Vẫn kiểm ca [A, followups, B] với AC-FU-5 để xác nhận "không đổi".
    - Cùng file `SessionMessageItem.vue` với nhiều plan khác ⇒ rebase trước khi mở PR.
  - **Kết quả (2026-10-06):** `displayBlockOrder` ở `utils/session-turns.ts`; `grouped` duyệt theo nó (`bi` vẫn là chỉ số gốc ⇒ `blockIndex`/`blockKey`/`text-${bi}`/`blockRole` không đổi, `finalIdx`/`phase` tính trên `blocks` gốc) + cổng `followups && message.streaming ⇒ continue`; `buildMarkdown` đi qua cùng thứ tự (không cổng streaming); comment đầu `SessionFollowupSuggestions.vue` cập nhật. `SessionTurnFullscreen.vue`, store, `finalResponseIndex` không đổi.

- [x] **T5. Cập nhật tài liệu** — **XS**
  - **Role:** developer
  - **Depends on:** T1, T2, T4
  - **Mô tả:** `docs/features/session-model-surfaces.md` § #34: đánh dấu OQ-FU-1…4 đã chốt (theo bảng đầu file này), trỏ ADR 0096, cập nhật bảng Edge case cho ca huỷ/lỗi (bỏ "Chưa chốt"), ghi rõ fullscreen giữ ẩn. Sửa câu ở cơ chế 1 cho khớp đính chính của ADR 0096 (`COMMUNICATION_PROMPT` chỉ ở nhánh Pi) và câu "Câu chữ cụ thể do developer chọn" ở hợp đồng mới điểm 3. Nếu `CHANGELOG` của bản vá kế tiếp có mục Fixed thì thêm một dòng. Không đụng `CLAUDE.md` (không đổi kiến trúc).
  - **Acceptance:** spec không còn câu "Chưa chốt"/"xem OQ-FU-x" cho 4 OQ trên; link ADR 0096 đúng; ghi chú phân loại đo dưới AC-FU-M5 nói "đã xác nhận" thay vì "cần PO xác nhận".
  - **Kết quả (2026-10-06):** spec § #34 đã đóng OQ-FU-1…4, sửa cơ chế 1 (đính chính `COMMUNICATION_PROMPT` chỉ ở nhánh Pi) + hợp đồng mới điểm 2/3/5 + lý do (b) + Edge case huỷ/lỗi. CHANGELOG: repo chưa có mục cho bản vá kế tiếp (release notes nằm ở `ui-next/utils/changelog.ts`, theo từng version đã phát hành) ⇒ không thêm dòng; thêm khi cắt release.

- [ ] **T6. QA trước merge: baseline độ phủ + verify hành vi trên app thật** — **M**
  - **Role:** qa-tester
  - **Depends on:** **T6a: none** (bắt đầu ngay) · phần verify: T2, T3, T4
  - **Mô tả:**
    - **T6a — Baseline M4 (chặn merge):** trên `~/.awog/sessions/*`, chỉ message tạo trước ngày merge, đo tỉ lệ lượt assistant có `followups` theo từng model (`claude-opus-5-5`, `claude-opus-4-8`). Ghi script/cách quét + con số + ngày đo vào PR (để T8 chạy lại đúng cách). Đồng thời phân loại lại baseline 30 / 342 message bằng **cách phân loại mới** (OQ-FU-3) để có mốc so sánh cùng thước đo.
    - **Verify tay:** dựng/tìm các ca: (1) parts mới [step…, followups, B]; (2) JSONL cũ [A, followups, B] (dùng `261006-coral-dune-kol`) — reload, restart app, popout; (3) lượt đang stream có chip đã tới — xác nhận chip ẩn trong lúc stream text, trong lúc tool khác chạy, trong lúc chờ AskUserQuestion/permission; (4) huỷ giữa lượt và lượt lỗi ⇒ chip hiện, sau thẻ lỗi; (5) mở fullscreen ⇒ không chip giữa/trên text; (6) export markdown + HTML; (7) gọi lần 2 ⇒ tool row lỗi tại chỗ; (8) phiên provider khác `anthropic` (Pi) có chip ở cuối; (9) highlight trích dẫn trên message có chip vẫn đúng chỗ; (10) caret còn trên text cuối khi lượt [step…, followups, B] đang stream; (11) fullscreen mở giữa lúc stream vẫn tự cuộn khi đang ở đáy.
  - **Acceptance:** baseline M4 có số và cách đo ghi lại; **AC-FU-1…AC-FU-5, AC-FU-9, AC-FU-10** PASS trên app thật, ghi kết quả từng AC; **AC-FU-8** xác nhận ở cả nhánh Pi lẫn Claude SDK.
  - **Kết quả T6a — baseline M4 (đo 2026-10-06, qa-tester, máy `huanvu201203`):**
    - **Cách quét** (T8 chạy lại đúng như vậy): mọi `~/.awog/sessions/*/session.jsonl`; một message `role: 'agent'` = một lượt; "có chip" = có part `{ kind: 'surface', surface: { kind: 'followups' } }`; model = `modelUsed` của message, thiếu thì `settings.modelId` ở header (dòng 0). Cửa sổ: từ followups sớm nhất trên máy (`2026-09-14T03:47Z`, trước đó tool chưa tồn tại nên không tính vào mẫu số) tới **trước 2026-10-06 00:00 (giờ máy, UTC+7)**. Cắt ở 10-06 để chắc chắn mọi message đều sinh trước bản vá. Phân biệt nguồn bằng id part: `suggest-<uuid>` = `prompt_suggestion` của Claude SDK ([event-adapter.ts:632-638](../../apps/desktop/sidecar/src/runtime/claude-sdk/event-adapter.ts), chỉ phát khi model KHÔNG gọi tool), id khác (`toolu_…`) = model tự gọi `suggest_followups`. Script tạm: `.awog/scratch/followups-order/m4-baseline.mjs --before=2026-10-06` (thư mục gitignored; logic như mô tả ở đây).
    - **Số đo:**

      | Model | Lượt agent | Có chip (mọi nguồn) | Chỉ từ tool `suggest_followups` | Chỉ `prompt_suggestion` SDK |
      |---|---:|---:|---:|---:|
      | `claude-opus-4-8` | 532 | 349 (65.6%) | 43 (8.1%) | 313 (58.8%) |
      | `claude-opus-5-5` | 13 | 13 (100%) | 11 (84.6%) | 5 (38.5%) |
      | `claude-sonnet-4-6` | 17 | 13 (76.5%) | 6 (35.3%) | 7 (41.2%) |
      | **Tổng** | 563 | 375 (66.6%) | 60 (10.7%) | 325 (57.7%) |

      Tham khảo, tính cả ngày 2026-10-06 (có thể lẫn message sinh trên bản dev đã vá): `claude-opus-5-5` 42 lượt, 35 có chip (83.3%), 25 từ tool (59.5%). Chỉ tính lượt kết thúc bình thường (bỏ `canceled`/`error`): `claude-opus-4-8` 343/520 (66.0%). Mọi lượt trong cửa sổ đều là provider `anthropic` (nhánh Claude SDK) ⇒ **chưa có baseline cho nhánh Pi**.
    - **Đọc số, quan trọng cho T8:**
      1. **Chip "mọi nguồn" KHÔNG đo được rủi ro M4.** 86% part followups (470/544) là `prompt_suggestion` của SDK, và nó tự lấp chỗ khi model không gọi tool (`sawFollowups`). Nếu model bỏ tool vì phải quyết định sớm (đúng rủi ro ADR 0096 nêu), tỉ lệ "mọi nguồn" gần như không đổi. ⇒ M4 phải so trên cột **"chỉ từ tool"**: mốc opus-4-8 = **8.1%**, opus-5-5 = **84.6% (n = 13, quá nhỏ để ngưỡng −20% tương đối có ý nghĩa thống kê; nên đo lại khi có ≥ 30 lượt)**.
      2. **Baseline 342 message của opus-4-8 trong spec phần lớn là chip của SDK**, không phải chip của tool (342 khớp đúng con số đếm theo header `settings.modelId`: 342 có chip). Chip SDK tới SAU `result` nên gần như không bao giờ có text sau nó ⇒ dễ được tính là "sạch". ⇒ **M1/M2 ở T8 nên lọc chỉ message có followups từ tool**, nếu không thì M2 (≥ 86% sạch) gần như đạt sẵn bất kể bản vá.
      3. **88/375 lượt có chip (23%) mang ≥ 2 block followups** (tối đa 6/lượt; 78 lượt chỉ toàn chip SDK — mỗi `result` nội bộ của một lượt dài phát một `prompt_suggestion`). Xem Bug #1 bên dưới.
    - Chưa làm: phân loại lại 30/342 message bằng cách phân loại mới (OQ-FU-3: "viết lại" / "đuôi thừa" / "sạch") — việc này cần đọc nội dung text, và theo điểm 2 thì nên làm trên tập lọc theo nguồn tool (60 lượt trước 10-06).
  - **Kết quả verify (2026-10-06, qa-tester) — phần đã làm được KHÔNG cần app:** `ui-next` không có test runner ⇒ script tạm `.awog/scratch/followups-order/` (`build.mjs` cắt **nguyên văn** computed `grouped` của `SessionMessageItem.vue` + `blockToMd`/`buildMarkdown` của `useSessionExport.ts` ra module chạy được, một bản từ working tree, một bản từ `HEAD` để đối chứng hồi quy; `check.mts` import `displayBlockOrder` thật). `npx tsx check.mts` ⇒ **30/30 PASS**.

    | AC / ca | Kết quả | Bằng chứng |
    |---|---|---|
    | `displayBlockOrder`: không có followups ⇒ giữ nguyên; `[text, followups, text]` ⇒ `[0,2,1]`; chỉ followups ⇒ `[0]`; nhiều followups ⇒ chỉ giữ block CUỐI, đặt ở cuối (sau sửa Bug #1); bị từ chối (block `step`) ⇒ đứng yên; rỗng ⇒ `[]`; giữ mọi block không phải followups, không mutate input | PASS (chạy) | `check.mts` DBO-1…7 |
    | AC-FU-1 `[step,step,followups,B]` đã xong ⇒ `acts, text#3, gate:followups` | PASS (chạy) | HEAD cho `acts, gate, text#3` |
    | AC-FU-2 fullscreen | PASS (đọc code) | `SessionTurnFullscreen` render chính prop `grouped` (đã sắp) với `is-last="false"` ⇒ không có chip nào; nếu có thì là phần tử cuối |
    | AC-FU-3 export: dòng `_Suggested next:_` là dòng cuối (thứ tự mới, JSONL cũ, đang stream, lượt lỗi) | PASS (chạy) | HEAD: dòng cuối là text B |
    | AC-FU-4 đang stream text cuối / tool khác đang chạy / chờ AskUserQuestion ⇒ không có group chip; kết thúc ⇒ chip cuối | PASS (chạy, mức `grouped`) | Có cả ca chờ quyền (`perm`). Caret: group cuối lúc stream là text/activities, không phải chip |
    | AC-FU-5 JSONL cũ `[A, followups, B]` ⇒ `text#0, text#2, chip`; key `text-2` giống HEAD | PASS (chạy) + đọc code | Không ghi lại file: thay đổi chỉ ở computed/hàm thuần, store và persistence không đổi (diff) |
    | AC-FU-9 lời gọi bị từ chối ⇒ tool row lỗi tại chỗ | PASS (chạy: sidecar step-mapper + `grouped`) | Row `fu-2` nằm sau `s1` trong activities, chip hợp lệ xuống cuối |
    | AC-FU-10 chỉ message cuối / ẩn khi gõ / seed đúng phiên / `prompt_suggestion` cũng ở cuối | PASS (đọc code: không đổi so với HEAD) | `SessionFollowupSuggestions` chỉ đổi comment; `sawFollowups` không đổi. Xem Bug #2 (có từ trước, không do bản vá) |
    | Edge: `[A, followups]`; chỉ có chip; tool khác SAU chip; huỷ giữa chừng; lỗi ⇒ chip SAU thẻ lỗi | PASS (chạy) | `[A, followups]` giống hệt HEAD |
    | Hồi quy: message không có followups ⇒ `grouped` giống hệt HEAD (4 hình dạng); `midWordTail` `[A giữa từ, followups, "iểm…"]` ⇒ text dán giống HEAD | PASS (chạy) | Hệ quả phụ đúng như ADR: `[step, followups, step]` thành MỘT nhóm activities (HEAD: hai) |

    **CHƯA verify — cần kiểm tay trên app (giữ ô T6 mở):** render thật trong Electron (CSS/vị trí chip, dark + light, theme Cute); reload / restart app / popout với `261006-coral-dune-kol`; caret còn trên text cuối khi lượt `[step…, followups, B]` đang stream (ca 10); fullscreen mở giữa lúc stream vẫn tự cuộn (ca 11); gate quyền thật; highlight trích dẫn §8 trên message có chip (ca 9 — `blockIndex` gốc đã kiểm bằng chạy, phần tô DOM chưa); lượt Pi thật (provider khác `anthropic`, ca 8 — chưa có dữ liệu Pi trên máy đo); `prompt_suggestion` tới sau `result`; chế độ lưới (Bug #2).
  - **Bug / phát hiện (QA, 2026-10-06):**
    - **#1 — Nhiều block followups trong một message bị chồng thành nhiều hàng chip ở cuối — S3, lỗ hổng spec, cần BA/TL quyết.** Dữ liệu thật: 88/375 lượt có chip mang 2–6 block `followups`, gần hết là `prompt_suggestion` của SDK (mỗi `result` nội bộ một chip). `displayBlockOrder` dồn **tất cả** xuống cuối (đúng thiết kế ADR 0096 D3 "giữ thứ tự tương đối"), nên message cuối có thể kết bằng tới 6 hàng chip, trong đó các hàng đầu là gợi ý đã lỗi thời của các đoạn trước; export cũng ra nhiều dòng `_Suggested next:_` liên tiếp ở cuối. Trước bản vá các hàng này cũng hiện cả (cùng `isLast` theo message) nhưng nằm rải tại chỗ, nên nhìn ra được là gợi ý của đoạn nào. **Steps:** mở phiên `260921-clever-beach-eq8` (message `m-mubcb8d2-c0`, 5 block `suggest-*`) hoặc `260923-vivid-stream-cqm` (`m-muk0bqc9-ey`, 6 block) sao cho message đó là message cuối của phiên. **Expected (đề xuất):** chỉ block followups cuối cùng được hiện ở cuối message. **Actual (suy từ code + script DBO-4, chưa chụp trên app):** 5–6 hàng chip liền nhau ở cuối. Bảng Edge case của spec chưa có dòng này. **→ ĐÃ SỬA (orchestrator, sau QA):** `displayBlockOrder` chỉ giữ block followups CUỐI (ADR 0096 D3 + spec Edge case đã cập nhật); script kiểm DBO-4/DBO-7/grouped-nhiều-followups đổi kỳ vọng, chạy lại 30/30 PASS.
    - **#2 — Ở chế độ lưới, việc hiện/ẩn chip đọc phiên đang mở chứ không đọc phiên của ô — S3, có từ trước bản vá (không phải hồi quy).** `isLastMessage` ([SessionMessageItem.vue:462](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue)) so `msgIndex` với `store.active?.msgs.length`, và `visible` của `SessionFollowupSuggestions` đọc `store.active?.draft`; cả hai bỏ qua `useSessionScope()` (vốn được dùng ở chính hai file đó cho `turnAuthor` và `seedComposer`). Hệ quả dự đoán: ở ô lưới không phải phiên đang mở, chip hiện/ẩn theo độ dài transcript và draft của **phiên khác**. Chưa tái hiện trên app. AC-FU-10 "bấm chỉ seed đúng phiên" vẫn đúng (`seedComposer(text, scope.sessionId.value)`), nhưng vế "chỉ message cuối / ẩn khi gõ" sai ở ô lưới. Ngoài phạm vi gói này ⇒ đề xuất tách task riêng.

- [ ] **T7. Code review** — **S**
  - **Role:** code-reviewer
  - **Depends on:** T3, T5, T6
  - **Acceptance:** xác nhận (a) câu chữ trong code khớp từng chữ ADR 0096; (b) chỉ một nguồn text cho 2 runtime; (c) `COMMUNICATION_PROMPT`, `event-adapter.ts` `sawFollowups`, chuỗi từ chối **không đổi**; (d) không ghi lại JSONL, không đổi schema/RPC, không migration; (e) hoist không đổi thứ tự `blocks` (không lệch `blockIndex`); (f) không có dedupe/heuristic phía client; (g) lint + typecheck + test sidecar = 0 lỗi.

## Sau merge (không chặn merge)

- [ ] **T8. Đo hiệu quả trên phiên thật** — **S**
  - **Role:** qa-tester (báo PO)
  - **Depends on:** merge của T1–T7; đủ dữ liệu (≥ 30 message mới có `followups` của `claude-opus-5-5`)
  - **Mô tả:** Chạy lại đúng cách quét của T6a, phân loại theo cách mới. Đọc kết quả theo bảng "Cách đo lại" của ADR 0096.
  - **Acceptance:** **AC-FU-M1** (opus-5-5: 0 viết lại cả bài, đuôi thừa ≤ 5%) · **AC-FU-M2** (opus-4-8 sạch ≥ 86%) · **AC-FU-M3** (không có `[Your previous response had no visible output` trong `~/.claude/projects/…/*.jsonl` của các phiên đo) · **AC-FU-M4** (độ phủ không giảm > 20% tương đối so với baseline T6a) · **AC-FU-M5** (chip cuối message ở transcript + export; fullscreen theo AC-FU-2).
  - **Risk:** FAIL M1 hoặc M3 ⇒ quay lại T1 (ADR mới supersede câu chữ của ADR 0096 D1, theo bảng "Cách đo lại"), không vá bằng heuristic UI. FAIL M4 ⇒ tăng độ phủ bằng prompt (spec: ngoài phạm vi gói này, mở việc mới).

## Backlog (ngoài phạm vi, không tạo task)

Theo PO brief và spec: sửa CLI Claude; đổi `prompt_suggestion`/`sawFollowups`; dedupe câu trả lời lặp phía client; viết lại transcript cũ; guard cho ca model gọi tool khác SAU `suggest_followups` (rủi ro đã chấp nhận, YAGNI); cho chip hiện trong fullscreen (OQ-FU-1 phương án b).

## Open questions

Không còn. OQ-FU-1…3 đã chốt ở bảng đầu file; OQ-FU-4 đã chốt ở ADR 0096 (T1). T1 xác nhận **không** cần sửa `COMMUNICATION_PROMPT` (ADR 0096 D2) ⇒ phạm vi T2 giữ nguyên.
