# 0096 — `suggest_followups` gọi TRƯỚC câu trả lời cuối; chip luôn vẽ ở cuối message, chỉ khi lượt đã kết thúc

- **Trạng thái:** Accepted (2026-10-06)
- **Ngày:** 2026-10-06
- **Người quyết định:** Tech Lead
- **Quan hệ:** chốt OQ-FU-4 của [spec #34 — Hợp đồng thứ tự](../features/session-model-surfaces.md#hợp-đồng-thứ-tự-gọi-suggest_followups-trước-câu-trả-lời-cuối); không supersede ADR nào. Dựa trên mô hình render turn/activity của [ADR 0061](./0061-session-craft-parity-render-model.md) (`finalResponseIndex` / `blockRole`) và nguyên tắc "tool description mang chính sách" của [ADR 0071](./0071-senior-engineer-prompt-core.md). Plan: [session-model-surfaces-followups-order.tasks.md](../features/session-model-surfaces-followups-order.tasks.md).

## Bối cảnh

Model viết câu trả lời → gọi `suggest_followups` → viết lại TOÀN BỘ câu trả lời lần hai (đo trên phiên `261006-coral-dune-kol`, nhánh Claude SDK, `claude-opus-5-5`; baseline đầy đủ ở spec). Spec đã nêu hai cơ chế:

1. **Prompt tự mâu thuẫn.** Mô tả tool bảo gọi *"as the LAST tool call of your reply"* ([surface-tools.ts:145](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts)) nên model viết câu trả lời trước; kết quả tool *"Offered N follow-up prompt(s) under your answer. Do not list them again in your text."* ([surface-tools.ts:560](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts)) vừa gieo cụm "under your answer" (nguồn của 18/30 câu đuôi "Bên dưới có gợi ý…") vừa ngụ ý sắp có thêm text.
2. **CLI ép viết tiếp.** Binary CLI của Agent SDK chứa hằng `[Your previous response had no visible output. Please continue and produce a user-visible response.]`; tái hiện được 1 lần: trả lời → tool → kết thúc không text ⇒ CLI chèn lời nhắc ⇒ model viết lại. Từ lần tái hiện đó suy ra: **text đứng TRƯỚC tool call không được CLI tính là "visible output" của lượt** — lượt phải có text SAU tool result cuối.

**Đính chính chẩn đoán về `COMMUNICATION_PROMPT`.** Chẩn đoán và spec xếp `COMMUNICATION_PROMPT` ([prompts.ts:166-170](../../apps/desktop/sidecar/src/runtime/prompts.ts)) vào cơ chế 1. Nhưng block này **chỉ có ở nhánh Pi** ([prompts.ts:147](../../apps/desktop/sidecar/src/runtime/prompts.ts), [run-stream.ts:245](../../apps/desktop/sidecar/src/runtime/run-stream.ts)); nhánh Claude SDK cố ý KHÔNG gửi nó vì preset `claude_code` đã có hợp đồng output riêng ([claude-sdk/run-stream.ts:461-466](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts), danh sách append ở dòng 481+). Phiên lỗi chạy trên nhánh SDK ⇒ ở đó cơ chế 1 chỉ gồm mô tả tool + kết quả tool (cộng với preset, nằm ngoài tầm AWOG). Điều này quyết định mục D2 bên dưới.

Ba việc cần chốt: câu chữ chính xác của mô tả + kết quả tool (OQ-FU-4), có sửa `COMMUNICATION_PROMPT` không, và logic "đưa chip xuống cuối + chỉ hiện khi lượt kết thúc" đặt ở đâu trong UI.

## Quyết định

### D1 — Câu chữ chốt (OQ-FU-4)

Cả hai chuỗi là hằng trong `SURFACE_TOOL_TEXT.suggestFollowups` ([surface-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts)) — chuỗi kết quả chuyển từ literal trong `runSuggestFollowups` thành key mới **`recorded`**, để Pi (`createSuggestFollowupsTool`) và SDK server (`surface-sdk-server.ts`) cùng đọc một nguồn và unit test đọc thẳng hằng (AC-FU-8). Developer áp **nguyên văn từng ký tự** (dấu gạch là em dash `—` U+2014, dấu ngoặc kép thẳng `"`); cách nối chuỗi `+` trong TS tuỳ ý miễn kết quả ghép ra đúng như dưới.

**`description`:**

```text
Give the user 2–3 short next prompts they can click instead of typing. Call it AT MOST ONCE per reply, when your work is done and you know what you will conclude — right BEFORE you write your final answer, never after it. Offer only next steps that are concrete and specific to that conclusion; skip it when your answer stands on its own or when the options would be generic filler ("Tell me more") — no prompts at all are better than three useless ones. The user sees them without your help: never mention, list or point to them in your text.
```

**`recorded`** (text kết quả khi gọi hợp lệ — không còn đếm số option):

```text
Recorded. Now write your final answer to the user, as the last thing in this reply. If you already wrote the full answer earlier in this reply, do not write it a second time — end with one short closing sentence instead.
```

`options` (mô tả tham số) và hai chuỗi từ chối (`already offered in this reply`, `no follow-up text was given`) **giữ nguyên** (AC-FU-9).

**Lý do từng lựa chọn câu chữ:**

- **Mô tả tool là nơi duy nhất nói về chip.** Nó đọc một lần như chính sách (ADR 0071), nên là chỗ đúng cho lệnh *"never mention, list or point to them"*. Bỏ mọi từ vị trí (`under your answer`, `shown`) khỏi cả mô tả: model chép câu đuôi "Bên dưới có gợi ý…" từ chính chữ "under" mà AWOG đưa cho nó.
- **Kết quả tool không có một chữ nào về chip** — không `suggest`, `follow-up`, `option`, `chip`, `below`, `under`, `shown`. Câu gợi ý ban đầu *"…do not mention these suggestions"* bị loại vì chính nó nhắc tới gợi ý ngay trước lúc model viết (PO siết: cấm cả *nhắc tới*). "Recorded." là xác nhận trung tính, không có gì để chép lại.
- **"as the last thing in this reply"** khoá hai điều: câu trả lời là text SAU tool result (khớp định nghĩa "final message" của CLI và của `finalResponseIndex`), và không gọi thêm tool sau đó (giảm nhẹ rủi ro chip lỗi thời mà spec đã chấp nhận).
- **Ca "đã lỡ viết câu trả lời trước khi gọi" — chọn phương án (c), không phải (a) hay (b):** cấm viết lần hai **nhưng bắt buộc kết bằng một câu ngắn**. Câu ngắn đó là thứ giữ cho lượt có "visible output" sau tool result ⇒ CLI không chèn lời nhắc. Từ ngữ cố ý không dùng `rewrite`/`repeat`/`summarise`/`restate` (kể cả ở dạng phủ định) để không gieo các động từ đó, và để test cấm cụm từ đơn giản.
- **Không dùng nhánh có điều kiện tính ở sidecar** (trả câu A khi model chưa viết, câu B khi đã viết): handler MCP trên nhánh SDK chỉ thấy tham số của lời gọi, không thấy transcript của lượt, nên phải thêm đường ống riêng cho từng runtime và phá AC-FU-8. Câu điều kiện đặt trong prompt để model tự phân xử — model nhìn thấy text của chính nó.

**Đánh đổi đã chấp nhận:** ở ca thói quen cũ, message sẽ có `[A dài, followups, C một câu]`. C là câu kết hơi thừa nhưng không lặp nội dung và (theo cách phân loại mới của OQ-FU-3) chỉ bị tính là *đuôi thừa* nếu nó nhắc tới chip. Đổi lấy: không còn viết lại 9k ký tự, và không có lượt rỗng để CLI ép.

### D2 — KHÔNG sửa `COMMUNICATION_PROMPT`

1. Nó không có mặt trên nhánh xảy ra lỗi (xem đính chính ở Bối cảnh) ⇒ sửa nó không đụng tới hiện tượng đã đo.
2. Trên nhánh Pi, hợp đồng mới đi **xuôi** với nó: "THE FINAL MESSAGE" = text sau tool call cuối = text sau `suggest_followups`. Không còn mâu thuẫn để vá.
3. Luật riêng của một tool thuộc về mô tả của tool đó (ADR 0071), dùng chung cho cả hai runtime. Viết luật followups vào `COMMUNICATION_PROMPT` sẽ tạo một bản chỉ-Pi, đúng loại trôi lệch mà `SURFACE_TOOL_TEXT` sinh ra để chặn.
4. Blast radius: block này chạy trên mọi lượt Pi và cả Tasks; đổi câu chữ ở đó ảnh hưởng hành vi chung, không chỉ followups.

Điều kiện mở lại: T8 cho thấy riêng nhánh Pi trượt M1/M2 trong khi nhánh SDK đạt.

### D3 — UI: một hàm thứ tự hiển thị dùng chung + cổng streaming đặt ở lớp gom nhóm

**Quy tắc:** block `kind: 'followups'` hợp lệ luôn hiển thị sau mọi block khác của message; chỉ là thứ tự **hiển thị**, tính lại từ `blocks` mỗi lần render; `parts` trên đĩa không đổi, không ghi lại JSONL.

1. **[`utils/session-turns.ts`](../../apps/desktop/ui-next/utils/session-turns.ts) — hàm mới `displayBlockOrder(blocks: readonly AssistantBlock[]): number[]`.** Trả về **chỉ số gốc** theo thứ tự hiển thị: mọi chỉ số không phải `followups` giữ nguyên thứ tự, rồi tới **chỉ một** chỉ số `followups` — block followups **CUỐI** của message; các block followups trước đó bị bỏ khỏi hiển thị và export (bổ sung sau QA, Bug #1: 88/375 lượt có chip mang 2–6 block, gần hết là `prompt_suggestion` của SDK phát theo từng `result` nội bộ — dồn hết xuống cuối thành chồng hàng chip mà các hàng đầu đã lỗi thời; `parts` trên đĩa vẫn giữ đủ). Hàm thuần, không biết gì về streaming. Trả **chỉ số** chứ không trả mảng block đã sắp lại: đó là cách giữ `blockIndex` gốc (rủi ro PM nêu về `highlightsForBlock`). Chỉ khớp `kind === 'followups'`: lời gọi bị từ chối không có surface nên đã là block `step` (tool row lỗi), tự đứng yên tại chỗ (AC-FU-9). Gợi ý `prompt_suggestion` của SDK cũng ra block `followups` ([stores/sessions.ts:1162](../../apps/desktop/ui-next/stores/sessions.ts)) nên đi cùng quy tắc (AC-FU-10).
2. **[`SessionMessageItem.vue`](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue) — computed `grouped` (dòng 345-426).** Thay `blocks.forEach((b, bi) => …)` bằng vòng lặp trên `displayBlockOrder(blocks)` với `b = blocks[bi]` (các `return` trong callback thành `continue`). Vì `bi` vẫn là chỉ số gốc nên `blockIndex`, `blockKey(b, bi)`, key `text-${bi}` và `blockRole(b, bi, finalIdx)` không đổi; `finalIdx` và `phase` vẫn tính trên `blocks` gốc. **Cổng streaming ở đầu vòng lặp:** `followups` + `props.message.streaming` ⇒ `continue` (không phát group). Vì `followups` được duyệt cuối nên `blockRole` = `gate` ⇒ `flush()` rồi push ⇒ chip đứng sau mọi group, kể cả thẻ lỗi (OQ-FU-2). Hệ quả phụ có lợi: chip không còn chẻ đôi một chuỗi activity (`[step, followups, step]` thành một nhóm activities thay vì hai).
3. **Vì sao cổng streaming đặt ở `grouped` mà KHÔNG ở prop `isLast` của `SessionFollowupSuggestions`** (khác gợi ý của plan): nếu chip vẫn là group cuối và chỉ bị component ẩn đi, thì (a) caret `streaming && gi === grouped.length - 1` (SessionMessageItem.vue:123) không còn rơi vào text đang stream, và (b) watcher autoscroll của fullscreen đọc độ dài text của group cuối (SessionTurnFullscreen.vue:115-128) sẽ đọc phải chip ⇒ ngừng cuộn — đúng trong lúc câu trả lời cuối đang stream, tức thời điểm hợp đồng mới tạo ra. Không phát group là cách duy nhất giữ hai giả định đó đúng.
4. **[`SessionTurnFullscreen.vue`](../../apps/desktop/ui-next/components/session/SessionTurnFullscreen.vue)** — không đổi code: nó dùng lại `grouped` (prop), giữ `is-last="false"` (OQ-FU-1). AC-FU-2 thoả nhờ bước 2.
5. **[`SessionFollowupSuggestions.vue`](../../apps/desktop/ui-next/components/session/SessionFollowupSuggestions.vue)** — không đổi logic (`isLast` + draft rỗng giữ nguyên, AC-FU-10). Chỉ sửa comment đầu file cho khớp ("vẽ ở cuối message, chỉ khi lượt đã kết thúc — cổng nằm ở `grouped`").
6. **[`useSessionExport.ts`](../../apps/desktop/ui-next/composables/useSessionExport.ts) — `buildMarkdown` (dòng 136-139).** Map qua `displayBlockOrder(m.blocks)` thay vì `m.blocks` trực tiếp ⇒ dòng `_Suggested next:_ …` là dòng cuối của message cho cả markdown lẫn HTML (HTML dựng từ markdown). Export **không** có cổng streaming: nó là bản ghi, không phải affordance.
7. **Không đổi:** `finalResponseIndex` / `responseIndex` / `deriveTurnPhase` / `blockRole` (block `followups` vốn không nằm trong danh sách "việc chặn phía sau" của `finalResponseIndex`), `plainText` (copy/fullscreen-response), store, step-mapper, `sawFollowups`.

**Rủi ro heuristic dán text bị chẻ (SessionMessageItem.vue:368-386) — đã kiểm, không phát sinh hồi quy.** `midWordTail` tìm `out.findLast((g) => g.type === 'text')`, tức là nó **vốn đã nhìn xuyên qua** group gate. Đưa chip ra khỏi luồng chỉ đổi vị trí của một block không phải text; thứ tự duyệt các block text giữ nguyên ⇒ cặp text nào được dán trước bản vá thì vẫn được dán sau bản vá, và ngược lại. Ca `[A kết thúc giữa từ, followups, B mở bằng chữ thường]` vốn đã bị dán từ trước — không thuộc phạm vi gói này, nhưng QA chạy lại ca này ở T6 để xác nhận "không đổi".

## Phương án đã cân nhắc

**Câu chữ kết quả tool:**

- **(a) "Đã viết rồi thì đừng viết nữa"** (cho phép kết thúc lượt không text) — loại: tạo đúng điều kiện CLI chèn `no visible output` (cơ chế 2) và lời nhắc đó bảo *"produce a user-visible response"* ⇒ model viết lại; lỗi chỉ chuyển từ prompt sang CLI. Chỉ số bắt được nếu chọn sai: **M3**.
- **(b) Chỉ "viết câu trả lời cuối ngay"**, không nhắc ca đã viết — loại: ở ca thói quen cũ (model đã viết xong trước khi gọi), câu lệnh này đọc đúng như yêu cầu viết lại; mục tiêu M1 là **0** lần viết lại nên không chịu được dù tỉ lệ nhỏ. Chỉ số bắt được: **M1** (đếm viết lại).
- **(c) Cấm viết lần hai + bắt kết bằng một câu ngắn** — **chọn** (D1). Rủi ro còn lại: câu kết nhắc tới chip ⇒ bắt bằng **M1** (đuôi thừa ≤ 5%); model bỏ qua vế "end with one short closing sentence" và kết thúc rỗng ⇒ bắt bằng **M3**.
- **Câu kết theo điều kiện tính ở sidecar** — loại: handler SDK không thấy transcript; cần đường ống riêng mỗi runtime, phá một-nguồn-text (AC-FU-8).

**`COMMUNICATION_PROMPT`:** sửa để nói rõ "text trước `suggest_followups` cũng là final message" — loại (D2: không có mặt ở nhánh lỗi, ngược hợp đồng mới, tạo bản chỉ-Pi).

**Vị trí logic UI:**

- **Sắp lại `blocks` trước khi gom** (trả mảng block mới) — loại: lệch `blockIndex` ⇒ highlight trích dẫn §8 tô nhầm khối, key `text-${bi}` đổi ⇒ component bị dựng lại giữa stream.
- **Dời group gate ở đầu ra của `grouped`** (gom xong mới nhặt group chip ra cuối) — loại: chip ở giữa đã kịp `flush()` chẻ activity thành hai nhóm, nhặt nó ra để lại hai nhóm activities kề nhau; và export vẫn cần logic thứ hai.
- **Hoist ở store** (`toBlocks` trong `stores/sessions.ts`) — loại: store là bản phản chiếu `parts`, thứ tự của nó được các chỗ khác dựa vào (rewind/bookmark đếm theo message, stream upsert theo vị trí); trộn quy tắc hiển thị vào đó là sai lớp.
- **Cổng streaming ở `SessionFollowupSuggestions`** — loại (D3 mục 3: làm hỏng caret + autoscroll fullscreen).

## Hệ quả

- **Tích cực:** một nguồn text cho hai runtime; một hàm thứ tự hiển thị cho cả transcript, fullscreen, export; không đổi schema JSONL, RPC, entity, dependency; không migration; phiên cũ hiện chip ở cuối ngay khi mở lại (AC-FU-5).
- **Tiêu cực / Trade-off:**
  - Ca thói quen cũ sinh một câu kết ngắn sau chip (D1, đã chấp nhận).
  - Phiên cũ khi resume vẫn mang trong lịch sử các tool result cũ ("…under your answer…"); có thể còn gieo câu đuôi trong vài lượt đầu của phiên cũ. Chấp nhận — tự nhạt dần, và T8 chỉ đo message mới.
  - Câu chữ là biến số duy nhất quyết định M1/M3. Nếu trượt, sửa bằng ADR mới supersede D1, **không** vá bằng heuristic UI (dedupe phía client đã bị loại ở spec).
  - `ui-next` không có test runner (`package.json` không có script `test`) ⇒ `displayBlockOrder` chỉ được kiểm qua QA tay ở T6.
- **Việc cần làm tiếp:**
  - **T2 (developer):** áp D1 vào `SURFACE_TOOL_TEXT.suggestFollowups` (`description` mới + key mới `recorded`), `runSuggestFollowups` trả `SURFACE_TOOL_TEXT.suggestFollowups.recorded`; sửa comment cùng ý ở [surface-tools.ts:7](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts) và [types/shared.ts:881](../../apps/desktop/sidecar/src/types/shared.ts) ("under the last reply" → "at the end of the last reply"). Không đụng `COMMUNICATION_PROMPT`, `event-adapter.ts` `sawFollowups`, chuỗi từ chối.
  - **T3 (qa-tester):** test trên hằng, không snapshot. Kết quả (`recorded`, so khớp không phân biệt hoa thường) — **cấm:** `under`, `below`, `shown`, `chip`, `suggest`, `follow-up`, `option`, `rewrite`, `repeat`, `restate`, `summar`; **bắt buộc:** `final answer`. Mô tả — **cấm:** `LAST tool call`, `after your answer`, `under your answer`, `below`, `shown`; **bắt buộc:** `BEFORE you write your final answer`. Cộng các ca AC-FU-8/9 như plan.
  - **T4 (developer):** D3 mục 1, 2, 5, 6.
  - **T6 (qa-tester):** thêm hai ca vào danh sách verify tay: caret còn trên text cuối khi lượt `[step…, followups, B]` đang stream; fullscreen mở giữa lúc stream vẫn tự cuộn.

## Cách đo lại

Dùng đúng cách quét + cách phân loại của OQ-FU-3 (chạy ở T6a, lặp lại ở T8). Bảng tra khi trượt:

| Triệu chứng | Chỉ số | Nghĩa là | Hướng sửa (ADR mới supersede D1) |
|---|---|---|---|
| Còn message viết lại cả bài | **M1** (viết lại > 0) | Model đọc `recorded` như lời mời viết, hoặc bỏ qua vế điều kiện | Siết vế điều kiện (đưa lên đầu câu) |
| Câu đuôi nhắc tới chip > 5% | **M1** (đuôi thừa) | Câu kết ngắn bị dùng để chỉ vào chip | Nói rõ nội dung câu kết, hoặc chuyển câu cấm-nhắc-chip sang cuối mô tả |
| Có `[Your previous response had no visible output` | **M3** | Model kết thúc rỗng sau tool, vế "end with one short closing sentence" không đủ | Bỏ vế điều kiện, chấp nhận (b) |
| Tỉ lệ lượt có chip giảm > 20% | **M4** | Gọi-trước buộc quyết định sớm nên model bỏ qua tool | Tăng độ phủ bằng prompt — việc mới, ngoài ADR này |

Đo thêm (không phải tiêu chí, để đọc bảng trên): tỉ lệ message có text dài **trước** surface `followups` — tức tần suất ca "thói quen cũ" mà vế điều kiện của `recorded` phải gánh.

## Tham chiếu

- Spec: [session-model-surfaces.md § #34](../features/session-model-surfaces.md#34--gợi-ý-follow-up-đánh-đổi) (Hợp đồng thứ tự, AC-FU-1…10, AC-FU-M1…M5, Edge case, OQ-FU-1…4)
- Plan: [session-model-surfaces-followups-order.tasks.md](../features/session-model-surfaces-followups-order.tasks.md)
- [ADR 0061](./0061-session-craft-parity-render-model.md) — `finalResponseIndex` / `blockRole`
- [ADR 0071](./0071-senior-engineer-prompt-core.md) — tool description mức chính sách; `COMMUNICATION_PROMPT` chỉ ở nhánh Pi
- [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) — runtime chọn theo provider (nhánh SDK vs Pi)
