# Feature: Nhập profile browser vào trình duyệt của agent

Nhập cookie + Local Storage + IndexedDB từ **profile browser thật của người dùng** (Chrome, Edge, Brave, Arc, Vivaldi, Chromium) vào partition `persist:awog-browser`, để agent duyệt web ở trạng thái **đã đăng nhập**. Quyết định: [ADR 0086](../decisions/0086-embedded-browser-panel.md) phần B. Bề mặt: nút ⬇ trong toolbar của [tab Browser](session-browser-panel.md).

## Mở ở đâu

Tab **Browser** của Workspace Panel → nút ⬇ (bên cạnh nút pop out) → modal: chọn **browser** → chọn **profile** → tick phần muốn nhập → **Nhập**.

Picker profile hiện tên người dùng đặt trong browser kèm email đã đăng nhập (`Work · work@example.com`), lấy từ `profile.info_cache` trong file `Local State` cấp browser — không có nó thì rơi về quét thư mục `Default` / `Profile N`.

## Nhập gì, và KHÔNG nhập gì

| Nhập | Vì sao |
|---|---|
| `Cookies` | chỗ phiên đăng nhập cổ điển nằm |
| `Local Storage` | rất nhiều SPA giữ token ở đây, không phải cookie |
| `IndexedDB` | một số app giữ session/refresh token ở đây |

| **Không** nhập | Vì sao |
|---|---|
| `Login Data` (mật khẩu đã lưu) | không giúp gì cho việc "agent đọc được trang tôi đã đăng nhập", và là thứ tệ nhất có thể trao cho một tiến trình đọc web không đáng tin |
| `Web Data` (autofill, thẻ thanh toán) | như trên |
| `History`, `Bookmarks` | không liên quan tới phiên đăng nhập |

Đây là **thiết kế**, không phải chưa làm tới: xem `browser-import.ts` phần đầu file.

## Bức tường: app-bound encryption

Chromium mã hoá **giá trị cookie**. Nhãn phiên bản nằm ở 3 byte đầu của `encrypted_value`:

| Nhãn | Khoá ở đâu | Nhập được? |
|---|---|---|
| `v10` / `v11` | Keychain macOS (`<Tên> Safe Storage`) — app nào cũng xin được, tốn một prompt | ✅ |
| `v20`+ | **gắn với binary browser đã ký** (Chrome 127+) | ❌ không app ngoài nào giải mã được |

Nên **không thể hứa** import cookie thành công — nó phụ thuộc browser của người dùng đã ghi kiểu nào. Vì thế module **đo nhãn theo từng dòng** và **báo cáo đủ mọi ô**: nhập được / app-bound / không có khoá / bỏ qua. Một jar nhập được 0 trên 4127 cookie **trông giống hệt** một profile mới cho tới lúc agent đụng trang đăng nhập — nên báo cáo là phần quan trọng nhất của tính năng này, không phải dấu tick xanh.

Local Storage và IndexedDB **không** bị mã hoá, nên chúng sang được kể cả khi cookie thất bại. Đó chính là lý do nhập-cả-profile vẫn có ích trên máy đã lên `v20`.

Giải mã (nhánh `v10`, macOS/Linux): PBKDF2-HMAC-SHA1(password, `saltysalt`, 1003, 16 byte) → AES-128-CBC với IV = 16 dấu cách. Chromium bản mới **thêm SHA-256 của `host_key` vào đầu plaintext**; code so đúng hash đó rồi mới cắt 32 byte — cắt theo độ dài sẽ phá giá trị dài hợp lệ.

## Hai pha, vì file lock

| Phần | Cách vào | Hiệu lực |
|---|---|---|
| Cookie | giải mã từng dòng → `session.cookies.set` | **ngay** |
| Local Storage · IndexedDB | copy vào `pending-browser-import/` rồi `applyPendingImport()` dời vào partition **lúc boot** | **sau khi khởi động lại** |

Local Storage/IndexedDB là **store LevelDB**, và Chromium giữ nó mở suốt đời một `Session` — ghi đè lúc app đang chạy là đường ngắn nhất tới store hỏng. `applyPendingImport()` chạy trong `app.whenReady()` **trước** `engine.start()` và trước mọi thứ chạm partition; đó là thời điểm duy nhất thay được. Modal có nút **Khởi động lại ngay** (qua `confirm()` — nó dừng mọi lượt đang chạy).

Cũng vì LevelDB: modal nhắc **đóng browser nguồn trước khi nhập**. Copy một store đang được ghi cho ra bản torn, và bản torn thì nạp lên rỗng.

## Ô báo cáo

| Ô | Nghĩa |
|---|---|
`imported` | đã vào jar
`appBound` | `v20`+ — không giải mã được, không phải bug sửa được ở đây
`keyUnavailable` | prompt Keychain bị từ chối, hoặc không có item
`expired` | đã hết hạn trong profile nguồn. Chromium **nhận rồi bỏ** loại này, nên đếm là "đã nhập" sẽ báo jar đầy hơn thực tế (đo được trong lúc test: set xong đọc lại ra rỗng) → bỏ qua tường minh
`rejected` | Chromium từ chối (`__Host-`/`__Secure-` không thoả điều kiện, dòng lỗi)
`undecryptable` | nhãn `v10` nhưng giải mã ra rác (padding sai / scheme lạ)

## Bảo mật

- **Không có path nào đi từ renderer.** UI gửi `browserId` + `profileDir`; main so lại với danh sách nó tự liệt kê rồi mới dựng path (invariant #2).
- **Khoá Keychain đọc qua `security` CLI**, vào một biến local, đi thẳng vào PBKDF2, **không log, không ghi đĩa**. macOS hỏi người dùng một lần.
- **Đọc bản snapshot**, không đọc file live của browser (kể cả `-wal`/`-shm`), rồi xoá thư mục tạm ở `finally`.
- **Không thêm dependency**: `sqlite3` CLI của hệ thống + `node:crypto`. Hệ quả: hiện chỉ chạy trên máy có `/usr/bin/sqlite3` (mọi macOS).
- **Có đường lùi**: nút *Xoá dữ liệu trình duyệt của agent* → `clearStorageData()` toàn partition.

⚠ **Cái giá, nói thẳng:** nhập cả profile là trao cho agent **mọi phiên đăng nhập trong profile đó**. Agent thì đọc trang web — dữ liệu L1 tuyệt đối. Hàng rào nonce chặn agent **tin lời** trang; nó **không** chặn được việc agent bị dụ đi tới một URL mang theo phiên của bạn (*confused deputy*). Người dùng chọn profile nào là chọn bán kính nổ; modal nói câu đó trước khi có picker. Đây là hạng mục **đầu tiên** của infosec re-audit còn nợ ở ADR 0086.

## File chạm

| File | Vai trò |
|---|---|
| [electron/src/browser-import.ts](../../apps/desktop/electron/src/browser-import.ts) | **Mới** — liệt kê browser/profile, giải mã cookie, staging LevelDB, `applyPendingImport`, `clearImportedData` |
| [electron/src/main.ts](../../apps/desktop/electron/src/main.ts) | `await applyPendingImport()` **trước** `engine.start()` |
| [electron/src/ipc.ts](../../apps/desktop/electron/src/ipc.ts) | `browser:listBrowsers` · `browser:importProfile` · `browser:clearData` · `browser:relaunch` |
| [electron/src/browser.ts](../../apps/desktop/electron/src/browser.ts) | export `BROWSER_PARTITION` (một nguồn sự thật cho jar) |
| [ui-next/components/session/workspace/WorkspaceBrowserImport.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceBrowserImport.vue) | **Mới** — modal picker + báo cáo |
| [ui-next/components/session/workspace/WorkspaceBrowser.vue](../../apps/desktop/ui-next/components/session/workspace/WorkspaceBrowser.vue) | nút ⬇ trong toolbar |
| i18n `sessions.json` (en/vi) | 25 key `sessions.workspace.browser.import.*` |
