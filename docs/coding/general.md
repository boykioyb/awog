# Coding Guide — General

Nguyên tắc và quy ước **cross-stack**, áp dụng cho mọi lớp của AWOG (frontend, sidecar, shell, tài liệu).

Quy ước riêng cho từng lớp: xem [nuxt-frontend.md](./nuxt-frontend.md) và các file sắp có (node-sidecar, tauri-shell).

## Nguyên tắc

Các nguyên tắc dưới đây là **kim chỉ nam**, không phải luật bất biến. Khi cần vi phạm, ghi rõ *why* trong comment hoặc ADR. Khi nguyên tắc xung đột nhau (rất hay xảy ra giữa DRY và KISS), ưu tiên **KISS + YAGNI** — chấp nhận trùng lặp tạm thời thay vì abstract sớm.

### KISS — Keep It Simple, Stupid
Giải pháp đơn giản nhất *giải được vấn đề thật* là giải pháp đúng. Phức tạp phải được biện minh bằng yêu cầu cụ thể, không phải bằng "tương lai có thể cần". Đo độ phức tạp bằng số khái niệm người đọc phải giữ trong đầu để hiểu code.

### YAGNI — You Aren't Gonna Need It
Đừng viết code cho nhu cầu chưa tồn tại. Tham số "phòng hờ", config "biết đâu cần", abstraction "để mở rộng sau" — phần lớn không bao giờ dùng, nhưng vẫn phải đọc, test và maintain mãi mãi.

### DRY — Don't Repeat Yourself
Mỗi **tri thức** (rule nghiệp vụ, công thức, hằng số) chỉ nên có **một nguồn sự thật**. Nhưng cẩn thận với **trùng lặp ngẫu nhiên**: hai đoạn code trông giống nhau nhưng đại diện cho hai khái niệm khác nhau thì **không** được gộp — chúng sẽ tiến hóa khác hướng.

### Rule of Three (đi kèm DRY)
1 lần: viết. 2 lần: chấp nhận copy. **3 lần mới refactor thành abstraction.** Abstract ở lần 1–2 thường sai vì chưa đủ mẫu để biết phần nào *thực sự* chung.

### SRP — Single Responsibility Principle
Một module / component / function chỉ nên có **một lý do để thay đổi**. Nếu phải mô tả nó bằng câu có "và" ("xử lý task **và** format ngày **và** ghi log"), gần như chắc chắn đang đa nhiệm. Tách ra.

### SoC — Separation of Concerns
Tách theo trách nhiệm rõ ràng:
- **UI (Vue)** không biết về filesystem hay API key.
- **Sidecar** không biết về DOM.
- **Model adapter** không biết về workflow logic.
- **Store** chứa state, không chứa logic format trình bày.

### OCP — Open/Closed
Module **mở** cho mở rộng, **đóng** với sửa đổi: thêm provider mới (Anthropic/OpenAI/Gemini) → thêm adapter mới, **không** sửa code dùng adapter. Áp dụng đặc biệt cho `ModelAdapter`, `ContextProvider`, `Skill`.

### Composition over Inheritance
Trong TypeScript/Vue, ưu tiên **composable + function thuần** thay vì class hierarchy. Vue 3 Composition API gần như loại bỏ nhu cầu kế thừa component. Khi cần share behavior: tách composable.

### Fail Fast
Lỗi phải xuất hiện càng gần nguyên nhân càng tốt. Validate input tại biên, throw ngay khi state bất khả thi. **Không** trả giá trị mặc định "an toàn" để che dấu bug. Crash sớm dễ debug hơn corrupt state âm thầm.

### Least Astonishment
Tên phải khớp hành vi:
- `getX` không được mutate.
- `useXxx` không throw đồng bộ trừ lỗi lập trình.
- Hàm async phải trả `Promise`, không "fire and forget" ẩn.
- Side effect đi qua tên có động từ rõ (`save`, `delete`, `commit`), không núp trong getter.

### Law of Demeter — "chỉ nói chuyện với hàng xóm"
Đừng truy cập chuỗi sâu xuyên qua nhiều lớp (`task.project.workflow.nodes[0].config.skill.name`). Yêu cầu lớp trung gian expose method/computed phù hợp. Ngoại lệ: data shape phẳng đã được model hóa rõ ràng (vd. type entity), không phải behavior đi mượn.

### Encapsulation
- Pinia store: state expose readonly, mutation đi qua action.
- Composable: trả interface tối thiểu, ẩn ref nội bộ.
- Module: chỉ export những gì người ngoài thật sự cần.

### Boy Scout Rule
Để code chỗ bạn đi qua **sạch hơn lúc đến**. Không phải refactor toàn bộ — sửa cái nhỏ thấy được: tên dở, comment lỗi thời, dead code, magic number. Tích lũy nhỏ chống được entropy lớn.

### Tin code nội bộ, validate ở biên
Type system + framework đã đảm bảo phần lớn. Chỉ validate runtime ở **biên hệ thống**: user input, file đọc lên, response API ngoài, IPC payload từ sidecar. Bên trong, tin type.

### Sửa root cause, không dán băng
Không `--no-verify`, không tắt rule lint để qua, không try/catch nuốt lỗi. Khi gặp obstacle: hiểu nguyên nhân, sửa nguyên nhân. Workaround có thể chấp nhận tạm thời, nhưng phải có comment `// WORKAROUND: <issue> — <điều kiện gỡ>` và ticket theo dõi.

## Ngôn ngữ

- **Tài liệu (`docs/`, `README*.md`, ADR, spec) → tiếng Việt.**
- **Code, identifier, log, error message → tiếng Anh.**
- **Comment giải thích *why* → tiếng Việt OK** khi có người đọc tiếng Việt; *what* thì không cần comment.

## TypeScript

- **`strict: true` luôn bật.** Không tắt cục bộ trừ khi có lý do ghi vào ADR.
- **Cấm `any`.** Khi cần kiểu không xác định: dùng `unknown` và narrow xuống.
- **Cấm `// @ts-ignore`.** Dùng `// @ts-expect-error <lý do>` khi bắt buộc và có ghi chú.
- **Prefer `type`** cho object shape; **`interface`** chỉ khi cần extend hoặc declaration merging.
- **Discriminated union** cho state nhiều biến thể; **`as const`** cho literal/enum-like.
- **Type chia sẻ** đặt ở module type chung của package (vd. [apps/desktop/ui-next/types/index.ts](../../apps/desktop/ui-next/types/index.ts)); type nội bộ một file để tại chỗ.

```ts
// good
type TaskStatus = 'pending' | 'running' | 'awaiting-approval' | 'done' | 'failed'
type Task = { id: string; status: TaskStatus }

// avoid
type Task = { id: any; status: string }
```

## Đặt tên

| Đối tượng | Convention | Ví dụ |
|---|---|---|
| File markdown | `kebab-case.md` | `system-overview.md` |
| ADR | `NNNN-title.md` | `0006-tauri-shell-for-nuxt.md` |
| File code `.ts` (util/lib) | `kebab-case.ts` | `model-adapter.ts` |
| Type / Interface | PascalCase | `Task`, `WorkflowNode` |
| Function / variable | camelCase | `selectTask`, `currentRun` |
| Const enum-like / object const | UPPER_SNAKE_CASE | `STATUS_META`, `THEMES` |
| Boolean | tiền tố `is`/`has`/`can`/`should` | `isRunning`, `hasError` |
| Hằng môi trường | UPPER_SNAKE_CASE | `AWOG_DEV_HTTP` |

Tên framework-specific (component `.vue`, store Pinia, route handler…) xem ở file của từng lớp.

## Tài liệu

- Markdown, kebab-case filename.
- **Một file = một chủ đề.** Đừng nhồi nhiều khái niệm.
- Tiêu đề `H1` duy nhất ở đầu file.
- Liên kết chéo bằng **relative path**.
- **ADR theo template** Context → Decision → Consequences. Số tăng dần, không tái sử dụng số đã có.
- Khi viện dẫn quyết định, **link tới ADR** thay vì giải thích lại.

## Git

- **Commit nhỏ, một mục đích.** Title imperative, ≤ 72 ký tự, tiếng Anh.
- **Branch:** `feature/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- **Không commit:** `.nuxt/`, `node_modules/`, `dist/`, file chứa API key, `.env*` (trừ `.env.example`).
- **Lockfile luôn commit** (`pnpm-lock.yaml`).
- **Không force-push** vào nhánh chung. Không sửa lịch sử commit đã push.

## Xử lý lỗi & logging

- **Throw kiểu Error có message rõ ràng.** Không throw string/number/object trần.
- **Bắt lỗi ở biên** (route handler, IPC boundary, top-level effect). Không bắt lỗi rồi nuốt im lặng.
- **Log có cấu trúc** ở sidecar (key/value), tránh log câu văn dài để parse khó.
- **Không `console.log` còn sót trong code production.** Dev log → xóa hoặc đưa vào logger có level.

## Test (khi có CI)

- Stack hướng tới: **Vitest** (unit/component), **Playwright** (e2e).
- File test cạnh source: `name.spec.ts` / `name.spec.vue.ts`.
- **Không mock filesystem hoặc git** khi đã có Tauri/Node sidecar — chạy thật trên temp dir.
- **Test phải kể được câu chuyện**: `describe` mô tả đối tượng, `it` mô tả hành vi quan sát được.

## Bảo mật & local-first

- **API key chỉ ở local**, lưu vào workspace settings; **không bao giờ commit, không bao giờ gửi lên UI**.
- **Path từ user input → sanitize** trước khi đọc/ghi.
- **Không gửi telemetry ra ngoài** trừ khi user opt-in (MVP không có).
- **Auto-commit Git chỉ trong workspace người dùng**, không touch repo khác trên máy.

## Dependency

- **Đề xuất dependency mới ⇒ mở ADR/thảo luận trước**, đặc biệt với thư viện lớn (UI framework, ORM, runtime).
- **Tránh dependency chỉ vì 1 hàm tiện** — viết tay thì hơn.
- **Cập nhật dependency** chia thành commit riêng, không trộn với feature.

## Checklist trước PR (chung)

- [ ] Build / typecheck pass
- [ ] Không còn `any`, `@ts-ignore` không lý do, `console.log` thừa
- [ ] Tên file/identifier theo bảng đặt tên
- [ ] Có cập nhật tài liệu khi thay đổi public surface (route, type entity, env var, IPC contract)
- [ ] Nếu thay đổi kiến trúc → có ADR mới
