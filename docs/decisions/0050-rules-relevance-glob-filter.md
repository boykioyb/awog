# 0050 — Rules relevance filter theo glob

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-20
- **Người quyết định:** tech-lead + product owner

## Bối cảnh

[ADR 0033](0033-rules-system-prompt-injection.md) inject **mọi** rule enabled (global +
project) vào `systemPromptAppend` của *mỗi* turn ([rules/inject.ts](../../apps/desktop/sidecar/src/rules/inject.ts)),
cố ý hoãn việc lọc theo độ liên quan (D-5, KISS). Khi user tích nhiều rule, context
per-turn tăng tuyến tính (~200 token/rule) dù phần lớn rule không liên quan tới
việc đang làm. Đây là phần "nhẹ" đi kèm [ADR 0051](0051-mcp-tool-progressive-disclosure.md)
trong đợt giảm eager-load context.

Ràng buộc: AWOG là chat/task, **không** có "current file" rõ như editor → cần một
tín hiệu xác định để biết turn đang "đụng" file nào.

## Quyết định

Thêm trường tuỳ chọn **`globs: string[]`** vào rule frontmatter (2-tier, mirror
Skills). Quy tắc inject:

- Rule **không** có `globs` (hoặc rỗng) → **luôn inject** (giữ nguyên hành vi cũ,
  backward-compatible).
- Rule **có** `globs` → chỉ inject khi **một path được nhắc trong turn** khớp một
  glob.

**Tín hiệu "path trong turn"** (`extractTurnPaths`): trích token giống đường dẫn từ
*text của turn hiện tại* — message user (Sessions) / prompt node (Tasks). Token hợp
lệ khi chứa `/` hoặc kết thúc bằng đuôi file ngắn (vd `Button.vue`). Bảo thủ:
false-positive chỉ thừa một rule; false-negative thì tác giả bỏ `globs` để ép luôn-bật.

Glob matcher tự viết (`*`, `**`, `?` → RegExp neo theo segment) — không thêm dep.
Lọc xảy ra **sau** cache rule list (cache theo project vẫn hợp lệ; `turnPaths` không
ảnh hưởng cache).

UI: RuleEditor có ô nhập glob (comma-separated), RuleDetail hiển thị chip; round-trip
qua frontmatter YAML list. `rules.upsert` zod schema thêm `globs` (nếu thiếu, zod sẽ
strip → mất dữ liệu khi save từ UI).

## Phương án đã cân nhắc

- **Keyword theo message** — *từ chối.* Quá fuzzy, dễ miss/nhiễu; glob theo path
  khớp đúng mô hình "rule cho loại file".
- **Glob theo file dưới cwd/project** — *từ chối.* Tín hiệu quá rộng (gần như luôn
  khớp) → không phản ánh độ liên quan của turn.
- **Parse file đã touch trong history** (read/edit/write file_path) — *hoãn (mở rộng
  tương lai).* Chính xác hơn cho phiên dài nhưng cần parse history; v1 dùng text của
  turn là đủ cho ca phổ biến (user nhắc tên file).

## Hệ quả

- **Tích cực:** rule chuyên-file (vd "Vue convention" globbed `**/*.vue`) chỉ tốn
  context khi turn thật sự đụng file đó (just-in-time); rule cross-cutting (không
  globs) vẫn luôn áp.
- **Trade-off:** trích path từ text là heuristic — turn không nhắc path thì glob-rule
  không bật (đúng thiết kế JIT, nhưng có thể bất ngờ với user); chưa bắt file touch
  qua history.
- **Việc cần làm tiếp:** cân nhắc bổ sung tín hiệu "file đã touch trong history" nếu
  cần; instrument breakdown context-window (chung với ADR 0051) để đo mức giảm.

## Tham chiếu

- [ADR 0033](0033-rules-system-prompt-injection.md) — rules injection (nền)
- [ADR 0035](0035-consolidate-config-tiers-to-awog.md) — tier `.awog`
- [ADR 0051](0051-mcp-tool-progressive-disclosure.md) — đợt giảm eager-load context
