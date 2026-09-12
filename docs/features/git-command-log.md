# Feature — Git command log

**Trạng thái:** Đã land (2026-09-12) · **Spec cha:** [git-manager.md](./git-manager.md)

## Vấn đề

Mọi git client desktop đều có bảng "những lệnh vừa chạy" — Sublime Merge (Command log), Fork (Console), GitKraken. AWOG **không có gì cả**: `runGit` chạy hàng trăm subprocess mỗi phiên và không ghi lại cái nào (`git/runner.ts` chỉ có đúng một `log.warn` cho stale `index.lock`).

Hệ quả đo được ngay hôm nay: `git merge` conflict thoát ra với message `Command failed: git merge --no-edit topic` và `gitCode: UNKNOWN`. Người dùng thấy một toast đỏ vô nghĩa; **dòng `git` thật, exit code và stderr chỉ tồn tại trong một tiến trình không ai nhìn được**. Debug kiểu đó là bất khả — và đó chính là lý do lỗi conflict sống sót lâu đến vậy.

## Thiết kế

**Sidecar** — [`src/git/command-log.ts`](../../apps/desktop/sidecar/src/git/command-log.ts): ring buffer cấp process, 400 entry. Ghi tại **`execOnce`** (không phải call site) nên nhánh retry sau khi gỡ stale `index.lock` cũng vào log — một lần chạy lại mà người dùng không hề biết chính là thứ cái log này sinh ra để phơi bày. `runGitStreaming` (fetch/pull/push) ghi riêng vì nó không đi qua `runGit`.

Mỗi entry: `argv` (không có chữ `git` đứng đầu) · `exitCode` · `durationMs` · `startedAt` · head của `stdout`/`stderr` · `truncated` · `readOnly`.

Phát live qua event `git:command`; RPC `git.commandLog` để UI mới mount lấp lại phần đã bỏ lỡ (ring nằm ở sidecar, reload renderer là mất sạch), `git.commandLogClear` để xoá.

**Ba ràng buộc, mỗi cái có lý do cụ thể:**

1. **Không rò.** Entry đi thẳng ra renderer ⇒ `argv` và cả hai luồng chạy qua `redactString` (invariant #1). Token gh tới git qua **ENV**, không bao giờ qua argv (`GH_CREDENTIAL_ARGS` chỉ là dây nối credential helper) — nhưng URL remote người dùng dán vào có thể mang `https://user:token@host`, đó mới là lỗ hổng thật và là cái redact bịt.
2. **Không phình.** `runGit` cho phép stdout 16 MiB (`git diff` cây lớn). Giữ **head 4000 ký tự** mỗi luồng + cap ring 400.
3. **Không chìm.** Watcher chạy lại `status` mỗi lần file đổi, auto-fetch 5 phút một lần — chúng sẽ chôn vùi đúng cái lệnh đang tìm. Mỗi entry mang cờ `readOnly`, UI **mặc định ẩn** lệnh đọc. Subcommand lạ mặc định tính là **ghi**, để một lệnh mới không tự nhiên bị giấu.

Phân loại read/write không chỉ theo subcommand: `remote`/`stash`/`tag`/`branch` **đọc khi không có verb, ghi khi có** (`remote add`, `stash pop`, `branch -d`). Và phải nhìn xuyên qua các option `-c foo=bar` đứng trước để tìm subcommand.

**UI** — [`GitCommandLog.vue`](../../apps/desktop/ui-next/components/git/GitCommandLog.vue), mục **Log lệnh** trong sidebar git (cạnh Local changes / All commits). Mỗi hàng: giờ · `git …` · thời gian chạy · exit code; hàng lỗi tô `--danger`. Bấm để mở rộng xem đủ stdout/stderr. Có công tắc *Kèm lệnh đọc*, nút Chép và Xoá. Tự cuộn theo đuôi **chỉ khi** người dùng đang ở đáy — giật màn hình khi họ đang đọc một lỗi cũ còn tệ hơn là không tự cuộn.

**Hàng thu gọn vẫn hiện lý do lỗi**, và lấy `stderr` trước rồi mới `stdout`: `git merge` in `CONFLICT (content): …` ra **stdout** và để stderr rỗng, nên nếu chỉ đọc stderr thì lỗi phổ biến nhất của app sẽ hiện exit code đỏ mà không có dòng nào nói tại sao. Chọn dòng khớp `conflict|error|fatal|denied|refus|reject` thay vì dòng đầu, vì git in `Auto-merging f.txt` trước `CONFLICT`.

## Test

[`src/git/__tests__/command-log.test.ts`](../../apps/desktop/sidecar/src/git/__tests__/command-log.test.ts) — 19 test: redact token trong argv và trong stderr, cắt head 50k→4000 + cờ `truncated`, cap ring 450→400, lọc theo workspace, và 14 ca phân loại read/write (kể cả `remote -v` vs `remote add`, `stash list` vs `stash pop`, `branch --list` vs `branch -d`, và nhìn xuyên `-c`).

## Còn lại

- Log là **cấp process**, không persist: restart sidecar là mất. Cố ý — nó là công cụ debug phiên hiện tại, ghi xuống đĩa sẽ thành một bề mặt chứa dữ liệu nhạy cảm nữa phải canh.
- Chưa có nút "chạy lại lệnh này" — cố ý, nó sẽ thành một đường chạy git tuỳ ý từ UI, đi thẳng vào invariant #8.
- Chưa lọc theo text/exit-code; 400 dòng thì cuộn còn chịu được.
