# Feature: Kiểm định skill (doctor + eval kích hoạt)

**Trạng thái:** v1 implemented (2026-09-07) — gói #45, nhánh `feature/claude-desktop-parity`

## Đã ship / chưa ship

| | Trạng thái |
|---|---|
| **Doctor** — chẩn đoán tĩnh 17 luật, không gọi model (`skills/doctor.ts` + RPC `skills.doctor`) | ✅ |
| Test cho lớp thuần của doctor (`skills/__tests__/doctor.test.ts`, 24 ca) | ✅ |
| **Eval kích hoạt** — hỏi model xem nó có chọn skill này cho từng prompt mẫu (`skills/eval.ts` + RPC `skills.eval`) | ✅ |
| Trần chi phí 3 chiều cho một lần chạy eval (calls / cost ước lượng / wallclock) | ✅ |
| Lưu bộ ca kiểm + 10 lần chạy gần nhất ra `~/.awog/skill-evals/<key>.json` (không database) | ✅ |
| UI: nút **Kiểm tra** trong `SkillDetail` → bảng doctor chạy ngay, eval chỉ chạy khi bấm | ✅ |
| Đo chi phí THẬT (usage token) thay cho ước lượng | ❌ — xem [Giới hạn đã biết](#giới-hạn-đã-biết) |
| Sinh ca kiểm tự động từ `description` | ❌ (YAGNI — tốn thêm một lượt model cho mỗi skill) |

## Vấn đề

Vòng đời skill trước gói này chỉ có CRUD + sinh bằng AI (`skills.list/upsert/delete/generate/author`). Người dùng viết xong một skill rồi **không có cách nào biết nó có kích hoạt đúng lúc không** — mà đó đúng là chỗ skill hay hỏng nhất: `description` mơ hồ thì model không bao giờ gọi tới; id trùng giữa hai tier thì chỉ một bản được nạp; link tới `scripts/run.py` gãy thì skill chết giữa chừng lúc đang chạy.

Hai câu hỏi có giá khác nhau, nên tách làm hai lớp:

| | Doctor | Eval |
|---|---|---|
| Câu hỏi | "Skill có viết đúng hình dạng không?" | "Model có chọn skill này đúng lúc không?" |
| Chi phí | 0 (đọc đĩa) | 1 lượt gọi model / ca kiểm |
| Khi nào chạy | Ngay khi mở bảng Kiểm tra | Chỉ khi người dùng bấm |

## Doctor — 17 luật

Đầu vào: `SKILL.md` đọc RAW (cố ý **không** đi qua `loadSkill`: store bỏ qua file thiếu `name`/`description`, mà đó lại đúng là file cần soi nhất) + danh sách file trong thư mục skill + danh sách skill anh em ở các tier đang mở.

| Luật | Mức | Bắt gì |
|---|---|---|
| `unreadable` | error | Không đọc được `SKILL.md` (thiếu file, không quyền, quá 512 KB) |
| `missing-name` | error | Frontmatter thiếu `name` ⇒ skill không vào được danh mục |
| `missing-description` | error | Thiếu `description` ⇒ model không có gì để quyết định |
| `invalid-id` | error | Tên thư mục không khớp `^[a-z0-9][a-z0-9-]*$` |
| `name-id-mismatch` | info | `name` slug hoá ≠ tên thư mục |
| `unknown-frontmatter-key` | info | Khoá lạ (gõ nhầm). Khoá của Claude Code CLI (`allowed-tools`, `license`, `version`, `model`, `metadata`) được tha |
| `description-too-short` | warn | < 40 ký tự |
| `description-too-long` | warn | > 500 ký tự (mô tả nằm trong danh mục của **mọi** lượt chat) |
| `description-no-trigger` | warn | Không có mệnh đề điều kiện ("use when…", "khi…", "nếu…") |
| `shadowed-id` | warn | Trùng id với skill ở tier khác ⇒ chỉ một bản được nạp |
| `duplicate-name` | warn | Trùng tên hiển thị với skill id khác ⇒ model không phân biệt được |
| `body-empty` | error | Thân bài rỗng |
| `body-thin` | warn | < 200 ký tự |
| `body-too-large` | warn | `SKILL.md` > 32 KB |
| `broken-link` | warn | Body trỏ tới file không có trong thư mục skill. Link markdown = bằng chứng mạnh, luôn kiểm; path trong backtick = bằng chứng yếu, chỉ kiểm khi bắt đầu bằng `./`, nằm dưới thư mục kèm theo có thật, hoặc dùng tên quy ước (`scripts/`, `references/`, `assets/`…) — nếu không, `` `src/index.ts` `` của repo người dùng sẽ bị báo nhảm |
| `link-outside-folder` | warn | Path `../` ra ngoài thư mục skill — gãy khi skill được chép sang máy khác |
| `oversized-asset` | info | File kèm theo > 1 MB |

Vấn đề trả về ở dạng **máy đọc được** (`{ rule, severity, params }`), không phải câu tiếng Anh: UI dựng câu qua i18n en+vi (`i18n/locales/*/skills-eval.json`, prefix `skillsEval.rule.<rule>.msg|.hint`).

**Kiến trúc:** `inspectSkillContent` là hàm **thuần** (không I/O) chứa toàn bộ luật ⇒ test không đụng HOME thật; `diagnoseSkill` chỉ lo đọc đĩa rồi gọi nó.

## Eval kích hoạt

Mỗi ca kiểm = một prompt mẫu + kỳ vọng (`activate` / `skip`). Một lần chạy:

1. Quét danh mục skill đang thấy được (`listSkills`) → dựng khối `- <id> — <name>: <description>` (cap 60 skill, mỗi mô tả cắt 300 ký tự).
2. Với **từng** ca: một lượt one-shot **không tool** qua `completePi` (đúng đường của `skills.generate` / `projects.generateDescription` — không dựng runtime thứ hai), hỏi "bạn sẽ nạp skill nào cho request này?", model trả `{"skill": "<id>|null", "reason": "…"}`.
3. Chấm: `activate` đạt khi model chọn đúng id; `skip` đạt khi model chọn **bất kỳ thứ gì khác** (kể cả không chọn gì). Model trả id không có trong danh mục ⇒ quy về `null` (bịa thì không tính là kích hoạt đúng).

Chạy **tuần tự**, không song song — để trần chi phí kịp bấm phanh giữa chừng.

### Trần chi phí (bắt buộc)

Cùng khuôn ba chiều với [`tasks/budget.ts`](../../apps/desktop/sidecar/src/tasks/budget.ts) và trần lịch chạy trong `schedules/runner.ts`. Chiều nào chạm trước thì dừng; các ca chưa chạy trả về `status: 'skipped'` kèm `stoppedBy` để UI nói rõ vì sao dừng.

| Chiều | Mặc định | Env | Ghi chú |
|---|---|---|---|
| `calls` | 20 lượt gọi model | `AWOG_SKILL_EVAL_MAX_CALLS` | Chiều **cứng nhất** — có hiệu lực kể cả khi không tra được bảng giá |
| `cost` | $0.50 | `AWOG_SKILL_EVAL_MAX_USD` | USD **ước lượng** (xem dưới) |
| `wallclock` | 5 phút | `AWOG_SKILL_EVAL_MAX_WALLCLOCK_MS` | Tính từ lúc bắt đầu một lần chạy |

Thêm hai trần cứng ở **biên IPC** (zod từ chối ngay): tối đa 20 ca/lần chạy, mỗi prompt ≤ 1.000 ký tự.

Ngoài ra `stoppedBy: 'error'` khi hai lượt gọi liên tiếp lỗi — gần như luôn là hỏng hệ thống (token hết hạn, mất mạng), chạy tiếp chỉ tốn thời gian.

### Vì sao chi phí là ƯỚC LƯỢNG

`completePi` trả về **text**, không trả usage token. Sửa nó để trả usage là đụng `runtime/complete.ts` — dùng chung với 7 method one-shot khác, ngoài phạm vi gói này. Nên chiều `cost` tính theo `ceil(số ký tự / 4)` token đầu vào + 150 token đầu ra, nhân bảng giá `pricing/catalog.ts`. Với Haiku, một ca thực tế ≪ 1 cent, nên $0.50 là trần rộng — và chiều `calls` mới là thứ chặn thật. Model không có trong bảng giá ⇒ `pricingKnown: false`, chiều `cost` vô hiệu, `calls` + `wallclock` là lưới an toàn. UI nói thẳng điều này ("ước tính" / "không tra được giá").

### Lưu trữ

`~/.awog/skill-evals/<source>__<projectId|global>__<id>.json` — một file một skill, ghi nguyên tử `.tmp` + rename + chmod 600, đọc thì validate zod (file trên đĩa là L1). Giữ **bộ ca kiểm** (để lần sau chạy lại đúng bộ đó) + **10 lần chạy gần nhất** (mới nhất đứng đầu) để so sánh. Không thêm database — đúng quy ước MVP.

Kết quả eval nằm ở `.awog` chứ không phải `.claude`: nó là dữ liệu AWOG-only, không phải config skill dùng chung với Claude Code CLI ([ADR 0070](../decisions/0070-share-claude-home-for-config.md)).

## RPC

| Method | Gọi model? | Trả về |
|---|---|---|
| `skills.doctor` `{ id, source, projectId?, projectIds? }` | ❌ | `{ report: SkillDoctorReport }` |
| `skills.eval` `{ id, source, projectId?, projectIds?, cases[], accountId?, modelId? }` | ✅ (có trần) | `{ run, record, budget }` |
| `skills.evalReport` `{ id, source, projectId? }` | ❌ | `{ record \| null, budget }` |

`skills.eval` từ chối skill **không có trong danh mục sống** (thiếu name/description ⇒ model không bao giờ thấy nó ⇒ eval vô nghĩa) và bảo chạy doctor trước.

Model mặc định: `claude-haiku-4-5` — đây là bài phân loại một dòng, không cần Opus.

## UI

Nút **Kiểm tra** (icon `scan`) trong header của `SkillDetail` bật/tắt `SkillCheckPanel`:

- Mở bảng → chạy `skills.evalReport` (nạp bộ ca + lịch sử) rồi `skills.doctor` ngay. Cả hai đều miễn phí.
- Eval **không tự chạy**: người dùng gõ prompt mẫu, bấm nút chạy. Trần được in ra **trước** khi bấm.
- Bảng remount theo `(source, projectId, id)` — đổi skill là nạp lại từ đầu, không mang state của skill cũ sang.
- State + IPC nằm ở `composables/useSkillEval.ts` (per-instance, không module-level); component chỉ dựng câu chữ.

## Giới hạn đã biết

- **Chi phí là ước lượng**, không phải hoá đơn (xem trên). Muốn đo thật thì phải cho `runtime/complete.ts` trả usage — nên làm một lần cho cả 7 method one-shot, không riêng eval.
- **Doctor không chạy tự động** khi lưu skill — người dùng phải mở bảng. Cân nhắc badge cảnh báo trong danh sách skill nếu thấy cần.
- **Eval chỉ hỏi "chọn skill nào"**, không kiểm tra thân bài có dẫn tới hành vi đúng không. Đó là bài toán khác (và đắt hơn nhiều).
- Bộ ca kiểm chỉ được lưu **khi bấm chạy**; sửa ca rồi đóng bảng mà không chạy thì mất.

## File

| Path | Vai trò |
|---|---|
| [`sidecar/src/skills/doctor.ts`](../../apps/desktop/sidecar/src/skills/doctor.ts) | 17 luật chẩn đoán tĩnh (lớp thuần + lớp I/O) |
| [`sidecar/src/skills/eval.ts`](../../apps/desktop/sidecar/src/skills/eval.ts) | Trần chi phí, prompt, chấm điểm, vòng chạy |
| [`sidecar/src/skills/eval-store.ts`](../../apps/desktop/sidecar/src/skills/eval-store.ts) | Bộ ca + lịch sử ra `~/.awog/skill-evals` |
| [`sidecar/src/methods/skills.doctor.ts`](../../apps/desktop/sidecar/src/methods/skills.doctor.ts) · [`skills.eval.ts`](../../apps/desktop/sidecar/src/methods/skills.eval.ts) · [`skills.eval-report.ts`](../../apps/desktop/sidecar/src/methods/skills.eval-report.ts) | 3 RPC |
| [`ui-next/composables/useSkillEval.ts`](../../apps/desktop/ui-next/composables/useSkillEval.ts) | State + IPC cho bảng Kiểm tra |
| [`ui-next/components/skill/SkillCheckPanel.vue`](../../apps/desktop/ui-next/components/skill/SkillCheckPanel.vue) | Bảng doctor + eval |
| [`ui-next/i18n/locales/{en,vi}/skills-eval.json`](../../apps/desktop/ui-next/i18n/locales/vi/skills-eval.json) | Chuỗi UI (prefix `skillsEval.`) |
