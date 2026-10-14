# Xem trước HTML trong Workbench

Mở file `.html` / `.htm` trong Workbench (doc kind `file` → `DocFile.vue`) hiện **Xem trước** như trình duyệt, chuyển qua lại với **Mã nguồn** (Monaco).

## Hành vi

- Header doc có seg **Xem trước | Mã nguồn** (mặc định *Xem trước*, nhớ theo doc khi tab còn mở), nút **nạp lại từ đĩa** (chung mọi doc file — xem [session-workbench.tasks.md](session-workbench.tasks.md) mục "Nạp lại từ đĩa"; với HTML nó vừa đọc lại Monaco vừa tăng `?v=` cho iframe, thay nút "tải lại bản xem trước" cũ) và nút **mở bằng trình duyệt mặc định** (`openFileExternal` → `file://` sau khi main validate workspace).
- Quay lại *Xem trước* từ *Mã nguồn* tự tăng `?v=` ⇒ iframe nạp lại bản đã **lưu ra đĩa**; sửa chưa lưu không hiện (preview đọc từ đĩa, giống mở file trong trình duyệt).
- Browser-dev (không có `window.awog`): khung preview hiện câu "chỉ có trong app desktop"; chế độ Mã nguồn vẫn dùng bình thường.

## Cơ chế

`<iframe sandbox="allow-scripts allow-popups allow-forms allow-modals">` — **không** `allow-same-origin` ⇒ trang chạy ở origin mờ, JS của nó không với tới app. `src` là URL kiểu đường dẫn để css/js/img tương đối resolve:

```
wspreview://<token>/<đường dẫn tương đối trong workspace>
```

- Scheme `wspreview` đăng ký privileged (`standard`, `secure`, `supportFetchAPI`, `stream`) cùng lượt `registerSchemesAsPrivileged` ở `electron/src/window.ts`.
- `<token>` = id ngẫu nhiên 128-bit do main phát qua IPC `preview:token { root }` (preload `window.awog.previewToken`, helper UI `htmlPreviewUrl` ở `composables/usePreview.ts`). Root được `realpath` + phải là thư mục; một root một token; giữ tối đa 64 token (LRU theo thứ tự chèn).
- Handler (`electron/src/html-preview.ts`): token → root, `resolveInsideWorkspace(root, rel)` (realpath ⇒ `..`/symlink ra ngoài → **403**), thư mục / không tồn tại / token lạ → **404**, còn lại stream qua `streamFileResponse` (dùng chung với `media://`, hỗ trợ Range) với MIME theo đuôi và `Cache-Control: no-cache`. Phần thuần (parse URL, MIME) ở `electron/src/preview-url.ts` + test `__tests__/html-preview.test.ts`.
- **Không thêm CSP** để script CDN (cdnjs…) chạy như trình duyệt thường.
- `will-frame-navigate` (window.ts) vẫn chặn điều hướng khung con tới http(s)/`file:`/scheme lạ; chỉ nới cho `wspreview://` (link tương đối giữa các trang workspace). `target=_blank` vẫn đi qua `setWindowOpenHandler` hiện có.

## Kiểm chứng

Đã chạy trên Electron thật (cửa sổ + iframe sandbox, `--user-data-dir` riêng): CSS áp dụng, `app.js` chạy, ảnh nạp, `marked` từ cdnjs render markdown; `localStorage` trong khung bị chặn (origin mờ); `..%2f..%2fetc/passwd` và symlink thoát root → 403; token lạ / thư mục / file thiếu → 404; Range → 206.

## Rủi ro / ghi chú cho ADR

- **Bề mặt bảo mật mới (scheme `wspreview`) ⇒ hạng mục infosec re-audit.** Tương tự `media://`, main tin `root` renderer gửi khi phát token (chỉ kiểm là thư mục thật); không có danh sách root hợp lệ ở main. Hàng rào thật là `resolveInsideWorkspace` trên mỗi request.
- Trang preview chạy JS tuỳ ý của file workspace và **được phép gọi mạng** (không CSP) — cố ý; được cô lập bằng sandbox opaque-origin chứ không bằng chặn mạng.
- Token sống suốt vòng đời app (cap 64).
