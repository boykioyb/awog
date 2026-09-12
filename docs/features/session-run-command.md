# Feature — Nút Run trên code block shell trong transcript

> **Trạng thái:** Đã ship · 2026-09-12

## Vấn đề

Model đề xuất lệnh trong transcript hàng chục lần một phiên. Đường đi hiện tại: bấm copy → mở khung Terminal → dán → Enter. Bốn thao tác cho một thứ vốn đã ở ngay trước mắt.

## Hành vi

Mỗi code block **ghi rõ ngôn ngữ shell** mọc thêm một nút `▶` ở thanh công cụ của block (sau nhãn ngôn ngữ · wrap · copy — ngoài cùng phải).

- **Bấm** → mở khung Terminal của phiên nếu đang đóng, ghi lệnh + `\n`.
- **⌥-bấm** → chỉ dán, KHÔNG xuống dòng. Người dùng đọc lại rồi tự Enter.
- Terminal chưa sẵn sàng sau 6s → toast báo lệnh **chưa chạy** (không im lặng nuốt).

Chạy trong **terminal của phiên** (`cwd` = project), không phải dock terminal toàn cục (`cwd` = home): lệnh model đề xuất gần như luôn nói về repo đang mở.

## Vì sao chỉ block có nhãn ngôn ngữ

`useMarkdown` tô một fence trần (```` ``` ````) **như shell** — cố ý, vì auto-detect từng đoán nhầm danh sách lệnh thành SQL. Nhưng nó **không gắn `data-lang`** cho fence trần, đúng với lý do đã ghi ở `highlightCode`: "claiming BASH on every unlabeled block would be a wrong label on the majority of them".

Nút Run ăn theo đúng thuộc tính đó, nên nó không mọc trên các khối trần — vốn phần lớn là output, nội dung file, log. Ngôn ngữ nhận: `bash` · `sh` · `shell` · `shellscript` · `zsh` · `console` · `shellsession`.

**Đo được:** Run mọc trên `bash`/`shellscript`/`zsh`; KHÔNG mọc trên `json`, `python`, và fence không nhãn.

## Guard lệnh phá huỷ

Lệnh khớp mẫu phá huỷ phải qua một hộp xác nhận **nêu đúng lệnh sắp chạy**. Mẫu: `rm -rf` · `sudo` · `dd if=` · `mkfs` · `chmod/chown -R` · `git push --force` / `reset --hard` / `clean -fd` · `docker system prune` / `volume rm` · `kubectl delete` · `npm|pnpm|yarn publish` · `curl|wget … | sh` · `> /dev/*` · `truncate -s 0` · `DROP TABLE|DATABASE`.

Cố ý để **RỘNG và chấp nhận báo nhầm**: giá của một lần hỏi thừa là một cú Enter; giá của một lần bỏ sót là mất dữ liệu. `echo "rm -rf is just text"` bị hỏi — chấp nhận được.

Đây **không phải hàng rào bảo mật**: người dùng vẫn gõ được mọi thứ trong terminal ngay bên cạnh. Nó chỉ đứng chắn giữa một cú misclick và hệ thống file, trên văn bản do **model** sinh ra. ⌥-bấm bỏ qua guard vì nó không chạy gì cả.

## Kiến trúc

| Phần | Chỗ |
|---|---|
| Nút + gate ngôn ngữ | [utils/code-block-controls.ts](../../apps/desktop/ui-next/utils/code-block-controls.ts) — thêm `onRun?` vào options; bề mặt không truyền ⇒ không có nút (markdown drawer GitHub không có terminal nào để chạy vào) |
| Registry chỗ chạy | [composables/useSessionTerminalRun.ts](../../apps/desktop/ui-next/composables/useSessionTerminalRun.ts) — module-level theo khoá PTY, cùng khuôn `useWorkspacePanel` / `useStatusConfig` |
| Đăng ký | `WorkspaceTerminal.vue` tự đăng ký `runText` theo `ptyKey` (`ses:<id>`), gỡ khi unmount |
| Nối dây | `SessionMarkdownHtml.vue` — guard + confirm + toast |

**Vì sao registry chứ không luồn ref:** nút Run nằm sâu trong DOM markdown của transcript, `runText` nằm trên instance `WorkspaceTerminal` bên trong workspace panel. Luồn ref qua `SessionDetail → SessionWorkspacePanel → WorkspaceTerminal` chỉ để gọi một hàm là không đáng.

**`runText` đổi từ `void` sang `boolean`.** PTY spawn bất đồng bộ; mở khung rồi ghi ngay thì pane chưa có `terminalId` và bản cũ nuốt im lặng — lệnh rơi vào hư không, người dùng không biết. Có giá trị trả về thì bên gọi poll được (120ms, trần 6s) rồi mới báo lỗi.

## Chưa xử lý

- **Cửa sổ < 1040px** ẩn hẳn workspace panel (`prototype.css`), nên khung Terminal mở ra mà không thấy. Lệnh vẫn chạy; người dùng chỉ thấy toast. Chấp nhận tạm — nới cửa sổ là thấy.
- **Block nhiều dòng** gửi nguyên khối: mỗi `\n` là một lần thực thi. Đúng ý nghĩa của một block shell nhiều dòng, nhưng guard chỉ soi từng dòng nên một dòng hiền + một dòng dữ vẫn hỏi (khớp trên bất kỳ dòng nào).
