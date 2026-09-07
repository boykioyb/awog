# Feature: Dòng trạng thái tuỳ biến (statusline)

**Trạng thái:** đã code (issue #41). Liên quan: [settings.md](./settings.md) (phân tầng), [workspace-panel.md](./workspace-panel.md).

## Mục tiêu

Cho người dùng tự quyết định thanh trạng thái dưới cùng hiện **cái gì** — model, nhánh git, chi phí, % context, tên dự án… — thay vì chỉ dùng bộ chip cố định.

## Ràng buộc cứng: template, KHÔNG phải script

Công cụ CLI thường cho chạy một script sinh statusline. AWOG **không** làm vậy: chạy script người dùng nhập từ settings là vi phạm bất biến an ninh #8 (*no eval / dynamic require trên payload từ workspace/UI*) và mở đường cho một `settings.json` commit trong repo chạy lệnh trên máy người mở nó.

Thay vào đó: **một chuỗi mẫu với biến `{tên}`**, thay thế bằng bảng biến **cố định** trong code. Không có nhánh, không vòng lặp, không lệnh shell. Nếu sau này thật sự cần script thì phải có ADR riêng cho việc đó (sandbox, quyền, tin cậy theo tầng), không tự thêm.

## Cú pháp mẫu

- `{tên}` — thay bằng giá trị; tên lạ giữ nguyên nguyên văn (người dùng thấy chỗ gõ sai) và trình soạn cảnh báo "Biến không có".
- `|` — ngăn đoạn. Đoạn nào **có biến mà mọi biến đều rỗng** thì bị bỏ, nên khi không mở phiên nào sẽ không còn dấu ngăn cách lơ lửng. Đoạn chỉ có chữ tĩnh luôn được giữ.
- Các đoạn còn lại vẽ ra thanh trạng thái, cách nhau bằng dấu `·`.

Mẫu mặc định: `{project} | {branch} | {model} | {contextPct}`.

## Bảng biến

| Biến | Nội dung | Nguồn |
|---|---|---|
| `{project}` | Tên dự án | `useProjects().projectName` |
| `{branch}` | Nhánh git hiện tại | `useSessionBranch` (chung với chip nhánh) |
| `{dirty}` | Số file đang đổi (rỗng khi sạch) | `useGitDirtyCount` |
| `{model}` | Model của phiên | `Session.model` |
| `{account}` | Tài khoản đang dùng | `Session.account` |
| `{style}` | Kiểu trả lời | `Session.style` |
| `{mode}` | Chế độ agent | `Session.mode` |
| `{thinking}` | Mức suy luận | `Session.thinkingLevel` |
| `{cost}` | Chi phí phiên (USD) | `Session.usage.cost` |
| `{context}` | Token đã dùng / giới hạn | `utils/context-window` |
| `{contextPct}` | % context đã dùng | như trên |
| `{session}` | Tên phiên | `Session.title` |

Biến gắn với phiên trả rỗng khi không có phiên nào đang mở ⇒ đoạn chứa nó biến mất. Không có biến thời gian: nó sẽ kéo theo một bộ đếm chạy suốt vòng đời app cho một thứ đồng hồ hệ điều hành đã hiện.

## UI

- Dòng trạng thái nằm ở **cụm trái** của [`AppStatusBar.vue`](../../apps/desktop/ui-next/components/shell/AppStatusBar.vue), sau các vòng usage.
- Nút chính là chỗ hiện dòng đó; bấm mở popover soạn mẫu ngay tại chỗ (mẫu được sửa thường xuyên hơn là mở Settings): công tắc bật/tắt, ô nhập mẫu, dải chip biến (bấm để chèn), cảnh báo biến lạ, dòng xem trước, nút mẫu mặc định + Lưu.
- **Mặc định TẮT** — thanh trạng thái đã có sẵn chip chuyên dụng, dòng tuỳ biến là thứ chọn thêm.

## Phân tầng

Theo đúng mô hình ở [settings.md](./settings.md):

- Tầng **user** — `statusline.{enabled,template}` trong `~/.awog/settings.json`.
- Tầng **project** — `statusline.template` trong `{project}/.awog/settings.json`, thắng tầng user khi có.
- Popover nói rõ giá trị đang hiện đến từ tầng nào ("Đang dùng mẫu của bạn" / "Dự án này đang ghi đè") và có nút **Bỏ tuỳ chỉnh của dự án** (`settings.unset`).
- Công tắc `enabled` **chỉ ở tầng user**: một repo không được quyền bật thêm thứ vào thanh trạng thái của người mở nó; nó chỉ đề xuất nội dung khi người dùng đã bật.

## File

| File | Vai trò |
|---|---|
| [`composables/useStatusLine.ts`](../../apps/desktop/ui-next/composables/useStatusLine.ts) | Bảng biến, `renderStatusLine` (thuần), `unknownStatusLineVars`, `useStatusLineValues` |
| [`components/shell/StatusLineCustom.vue`](../../apps/desktop/ui-next/components/shell/StatusLineCustom.vue) | Đoạn hiện trên thanh + popover soạn mẫu |
| [`i18n/locales/{en,vi}/settings-statusline.json`](../../apps/desktop/ui-next/i18n/locales/en/settings-statusline.json) | Chuỗi UI (`settingsStatusline.*`) |

## Còn lại

- Chưa có mục riêng trong Settings; nếu muốn, thêm một dòng vào `components/settings/sections.ts` trỏ tới cùng phần soạn thảo (file đó thuộc chủ sở hữu khác).
- Chưa có biến cho tác vụ (task) đang chạy hay số phiên đang bận — thêm khi có người thật sự cần.
