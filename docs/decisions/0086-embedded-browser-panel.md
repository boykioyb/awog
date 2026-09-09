# 0086 — Trình duyệt nhúng thành một view của Session (tab = WebContentsView)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-09
- **Người quyết định:** developer (nhánh `feature/claude-desktop-parity`)

Revisit **phần window-model** của [ADR 0043](0043-browser-tool-embedded-chromium.md). Mọi phần khác của 0043 (14 action, SSRF, hàng rào nonce, khử header bí mật, cầu sang nhánh Claude SDK) **giữ nguyên**.

## Bối cảnh

`browser_tool` đã chạy đủ trên cả hai runtime từ 2026-09-08, nhưng **chưa một phiên nào trên máy người dùng gọi tới nó**: grep toàn bộ 793 session trong `~/.awog/sessions` cho **0** lời gọi `browser_tool` và **0** chuỗi `awogbrowser`. Không phải nó lỗi — đo lại thì navigate/snapshot/console/network/viewport đều chạy. Nó **không có bề mặt nào để thấy**:

- cửa sổ tab **ẩn mặc định**, chỗ duy nhất mở được là tray → *"Toggle browser window"*;
- trong transcript, `browser_tool` chỉ là một step một dòng (`step-mapper.ts` map sang icon `search`);
- `screenshot` trả về **đường dẫn file**, không phải ảnh trong luồng đọc.

Chính 0043 đã dự trù lối ra: *"Nếu sau này cần UI tab thật thì đó là lúc đổi sang `WebContentsView`."* Đây là lúc đó — yêu cầu là **một nút trong Session mở trình duyệt ra thành một tab ngay trong app**, tương tác được như Claude.

Ràng buộc không được phá:

- **Agent phải duyệt web được khi không có UI nào mở** — task chạy không người trông ([ADR 0024](0024-task-execution-engine-ipc-contract.md) D-7), subagent, panel đóng.
- Invariant #4 (IPC boundary): renderer không chạm Node/webContents, chỉ đi qua `window.awog`.
- Invariant #7 (SSRF): mọi URL — kể cả URL người dùng gõ trong panel — qua cùng một cổng.
- Invariant #1: partition `persist:awog-browser` cô lập khỏi session của app.

## Quyết định

**Một tab = một `WebContentsView`** do Electron main sở hữu, sống ở đúng một trong ba chỗ:

| Chỗ | Khi nào | Ai đặt kích thước |
|---|---|---|
| `holder` — cửa sổ **vô hình** (`opacity: 0`, `focusable: false`, ignore-mouse, `hide()`) | mặc định, và mọi lúc không hiển thị | main |
| **nhúng** trong cửa sổ gọi `attach()` | tab "Browser" của Workspace Panel đang mở | **renderer** (rect của một div placeholder) |
| **popout** — cửa sổ riêng | tray toggle, hoặc nút ⧉ trong panel | main |

Sáu điểm chốt kèm theo:

1. **`ensurePainted` bù đúng thứ mà việc đổi model làm mất.** Một `WebContentsView` chưa từng lên màn hình **không có compositor surface** nên `capturePage` ném `"Current display surface not available for capture"` — chỗ mà `BrowserWindow` ẩn chụp tốt. `screenshot` vì thế gọi `ensurePainted` trước: `showInactive()` cửa sổ vô hình đúng một frame (250 ms), chụp, `hide()`. Surface sống sót qua `hide()` và qua reparent, nên việc này xảy ra **nhiều nhất một lần mỗi tab**.
2. **`backgroundThrottling: false`** trên mỗi view: Chromium đóng băng timer trong compositor ẩn (đo: 0 tick khi park, 14 tick khi tắt throttle).
3. **Renderer sở hữu rect, main sở hữu cửa sổ.** `attach`/`bounds`/`detach` nhận cửa sổ đích từ `event.sender`, **không** từ payload — một renderer chỉ lấp được cửa sổ của chính nó, không bao giờ addressing được cửa sổ khác. Rect là L1 → `clampRect` ghim mọi field thành số nguyên trong `±10000`.
4. **`shown` tính theo từng cửa sổ nhận.** `listTabs(forWindow)` trả `shown` = "đang ở rect CỦA BẠN" và `shownElsewhere` = "ai khác đang giữ". Nhờ vậy renderer biết chính xác nên vẽ trang hay vẽ placeholder, mà **không** cần biết window id nào.
5. **Một chủ cho mỗi cửa sổ.** Hai dock (phải + dưới) có thể cùng mở tab Browser, nhưng một `webContents` không ở hai rect được → `useEmbeddedBrowser` có trọng tài cấp module: instance đầu tiên giữ view, các instance khác vẽ "đang hiển thị ở chỗ khác" + nút giành lại. Cùng mô hình hand-off với session popout.
6. **Đóng cửa sổ chủ không giết tab của agent.** View là con của cửa sổ, nên cửa sổ bị destroy sẽ kéo `webContents` đi theo. `attachTo` vì thế hook `close` của cửa sổ chủ (WeakSet, không stack listener) để park view về holder trước.

**Điều hướng do người dùng** (`openFromUser`) đi qua **đúng `hostBlocked` mà agent đi qua**, cộng `normalizeUserUrl` để "example.com" thành `https://example.com` — không có cửa sau nào quanh invariant #7. Mọi hành động **ĐỌC** trang (snapshot/extract/console/network/screenshot) **vẫn chỉ đi đường sidecar**, nơi có hàng rào nonce + khử bí mật: bề mặt IPC mới chỉ có điều hướng + hình học, nên nội dung trang vẫn chỉ có một cửa vào app.

## Phần B — nhập profile browser thật ([spec](../features/browser-profile-import.md))

Panel giải quyết "không thấy được", nhưng còn một nửa nữa: jar của agent **rỗng**, nên nó bắt đầu mọi site ở trạng thái đăng xuất trong khi người dùng đã đăng nhập ở cửa sổ bên cạnh. Quyết định: **cho nhập cả profile, có picker browser → picker profile** (người dùng chốt hai lần, sau khi tôi nêu rủi ro).

- **Nhập:** `Cookies` + `Local Storage` + `IndexedDB`. **Không nhập:** `Login Data` (mật khẩu đã lưu), `Web Data` (autofill/thẻ), `History`, `Bookmarks` — chúng không giúp gì cho mục tiêu và là thứ tệ nhất để trao cho tiến trình đọc web không đáng tin.
- **Bức tường app-bound encryption:** cookie `v10`/`v11` giải mã được bằng khoá Keychain; `v20`+ (Chrome 127+) gắn khoá vào **binary browser đã ký** ⇒ **không app ngoài nào đọc được**. Nên tính năng này **không thể hứa** thành công: nó đo nhãn theo từng dòng và **báo cáo đủ mọi ô** (imported/appBound/keyUnavailable/expired/rejected/undecryptable). Local Storage + IndexedDB **không** bị mã hoá nên vẫn sang được — đó là lý do nhập-cả-profile vẫn có ích trên máy đã lên `v20`.
- **Hai pha vì LevelDB:** cookie vào ngay qua `cookies.set`; Local Storage/IndexedDB **staging** rồi `applyPendingImport()` dời vào partition **lúc boot, trước `engine.start()`** — thời điểm duy nhất thay được một store mà Chromium giữ mở suốt đời `Session`. Hệ quả người dùng thấy: "cần khởi động lại".
- **Zero dependency mới:** `sqlite3` CLI hệ thống + `node:crypto` + `security` CLI cho Keychain (main không có binding keyring). Hệ quả: hiện chỉ chạy nơi có `/usr/bin/sqlite3`.
- **Đường lùi bắt buộc:** nút *Xoá dữ liệu trình duyệt của agent* (`clearStorageData()` cả partition) — vì hành động này trao đi nhiều thứ một lúc.

Một dữ kiện đo được đáng ghi: cookie đã hết hạn thì **Chromium nhận rồi bỏ ngay**, nên nếu đếm là "đã nhập" thì báo cáo nói jar đầy hơn thực tế. Bản đầu tôi viết đúng lỗi đó và test round-trip lộ ra (set xong đọc lại ra rỗng) ⇒ có thêm ô `expired` và bỏ qua tường minh.

⚠ **Đây là bước leo thang bảo mật lớn nhất của cả ADR này**, và người dùng đã chốt sau khi tôi nêu: nhập cả profile là trao cho agent **mọi phiên đăng nhập trong profile đó**, trong khi nội dung trang là L1 và hàng rào nonce chỉ chặn agent *tin lời* trang, không chặn được *confused deputy*. Bán kính nổ do người dùng chọn qua việc chọn profile. Hạng mục đầu tiên của infosec re-audit.

## Phần C — bấm link thì mở ở đâu ([spec](../features/link-open-choice.md))

Trước ADR này, mọi link http(s) chỉ có **một** đích: browser hệ điều hành. App không cần code cho việc đó — `<a href>` và `target="_blank"` trong renderer bị `will-navigate` / `setWindowOpenHandler` ở [window.ts](../../apps/desktop/electron/src/window.ts) bắt rồi `shell.openExternal`. Nay có **hai** đích, nên phải hỏi.

Quyết định: **một popover neo tại chỗ bấm, hai lựa chọn (Mở trong AWOG / Mở bằng browser của tôi) + "Luôn dùng cách này"**, mặc định `ask`, đổi lại được ở **Settings → Workspace → Mở link**.

- **Một listener capture ở renderer, không phải 17 chỗ gọi.** `useLinkOpen().installInterceptor()` bắt `click` capture trên `document`, lọc `a[href^=http]` + chuột trái, `preventDefault` rồi hỏi. Nhờ vậy **mọi** `<a>` trong app được phủ mà không sửa call site nào: markdown transcript, trang Project, GH drawer, session Info, office doc. Chỗ nào muốn tự lo thì đánh dấu `data-link-raw`.
- **Handler ở main giữ nguyên, thành lưới an toàn.** Renderer chặn trước nên `will-navigate` không bắn nữa; nhưng nếu một surface không mount host (tray popover), hoặc một script tự đặt `location.href`, thì main vẫn đưa ra browser ngoài — hành vi cũ, và là mặc định an toàn.
- **`⌘/Ctrl/Shift-click` = ra ngoài, không hỏi.** Quy ước sẵn có của mọi browser, và là đường thoát khi popup thành vướng.
- **Mở trong app luôn tạo TAB MỚI.** Agent có thể đang giữa lượt trên tab active; chiếm tab đó là làm hỏng việc đang chạy. Đang ở trong session thì mở view Browser của panel; không có session thì popout.
- **`setWindowOpenHandler` của trình duyệt agent đổi từ `deny` sang mở tab thật** (vẫn qua `hostBlocked`, vẫn trả `deny` để Chromium không tự tạo cửa sổ). Lúc bề mặt còn headless, chặn `target="_blank"` là đúng — không ai thấy một cú bấm không làm gì. Giờ người dùng ngồi xem trang trong panel thì cú bấm chết đọc ra như app hỏng.
- **Hai chỗ CỐ Ý không qua bộ chọn:** dialog OAuth (Claude, Codex) — luồng đăng nhập phải vào browser có phiên thật của người dùng, và auth code **không được** rơi vào jar của agent; và link tải Tailscale ở Settings → Devices — partition của agent **chặn download**, nên chào "mở trong app" là chào một ngõ cụt. Cả ba chỗ có comment ghi lý do tại dòng.
- **Mode ở localStorage, không qua IPC.** Nó chỉ chọn *bề mặt* để mở link, engine không thấy gì — cùng hình dạng với `useKeymap`.

Giới hạn có chủ đích: link **bên trong iframe** (artifact HTML trong PreviewModal, widget do model sinh) vẫn bị `will-frame-navigate` chặn thẳng, không hỏi gì. Đó là hàng rào chống exfiltrate của [window.ts](../../apps/desktop/electron/src/window.ts), không phải chỗ bỏ sót.

## Phương án đã cân nhắc

- **`<webview>` tag** — DOM-native nên được CSS clip và xếp lớp đúng, không phải sync rect. Từ chối: element sống trong renderer ⇒ **tab chỉ tồn tại khi UI mở**, phá đúng ràng buộc "agent duyệt được khi không có cửa sổ nào". Chưa kể Electron khuyến cáo không dùng.
- **Giữ `BrowserWindow` mỗi tab, `setParentWindow` + đặt đè lên rect panel** — 0 regression cho `capturePage`. Từ chối: vẫn là cửa sổ OS (xuất hiện trong danh sách cửa sổ, Mission Control, không bị bo góc/clip theo layout), phải theo cả `move` lẫn `resize` của cửa sổ cha, và jitter khi kéo. Đổi một loại jank lấy một loại jank khác, cộng thêm cửa sổ lạ.
- **Mirror bằng `capturePage` 4–8 fps + `sendInputEvent` theo toạ độ** — không đổi gì ở model tab. Từ chối: không cuộn mượt, không select text, không gõ được tử tế. Không phải "một tab như Claude".
- **Park view ở cửa sổ đặt ngoài màn hình (`x: -5000`)** thay vì `opacity: 0`. Từ chối vì **đo thấy sai**: macOS kẹp bounds về `x: 0, y: 30` — cách này đặt một cửa sổ thật lên màn hình người dùng.

## Hệ quả

**Tích cực**

- Trình duyệt của agent **thấy được**: tab strip cập nhật theo từng lần agent điều hướng, và panel **tự theo tab agent đang dùng** khi nó `tab_new`/`tab_select`.
- Người dùng lái được: URL bar, back/forward/reload, tab mới, đóng tab, pop out.
- `screenshot` headless vẫn chạy (đo: PNG 18 413 B, 1280×800, không có cửa sổ nào mở).
- Trang sống qua: đổi tab panel, đóng panel, đóng cửa sổ chủ, pop out.

**Tiêu cực / Trade-off**

- **View native vẽ TRÊN toàn bộ DOM, và không ai gỡ nó hộ.** Đã trả giá bằng một lỗi thật ngay ngày đầu: app giữ hai lớp KeepAlive (`<NuxtPage keepalive>` + `<KeepAlive :max="5">` quanh `SessionDetail`), nên đổi trang/đổi session chỉ **deactivate** chứ không unmount ⇒ bản đầu chỉ nghe `onMounted`/`onUnmounted` để lại trang web của agent đè lên UI mới. Luật rút ra: điều kiện phải là **"khung có đang thật sự hiện trong document?"** (`isConnected` + hộp ≥ 8px — một mệnh đề phủ KeepAlive, `display:none`, panel thu, minimize dock) **cộng** `onDeactivated` gỡ ngay / `onActivated` gắn lại. Và chỉ **chủ sở hữu hiện tại** được phép detach, vì Vue có thể activate instance mới trước khi deactivate instance cũ mà `detachFrom(window)` thì park mọi tab của cửa sổ đó. Chi tiết: [session-browser-panel.md](../features/session-browser-panel.md#-invariant-view-phải-bị-gỡ-khi-khung-không-còn-trên-màn-hình).
- Không CSS nào đặt modal/menu/toast lên trước nó — z-index band của app vô hiệu với nó. Nên phải có luật che: `useEmbeddedBrowser` gỡ view khỏi màn hình khi `.ovl.on, .lbox, .smenu, .pop` xuất hiện (MutationObserver trên `document.body`). Cái giá: mở một popover bất kỳ cũng làm trang biến mất một nhịp.
- **Một lúc chỉ một dock hiển thị được Browser.**
- **Người dùng gõ được vào tab ⇒ đăng nhập của họ rơi vào `persist:awog-browser`, tức partition agent đọc được.** Đây vừa là điều làm nó hữu ích (agent đọc trang sau đăng nhập), vừa là **đổi thế trận bảo mật** so với 0043 nơi partition đó chỉ có agent chạm tới. Phải nói rõ trong spec, và là hạng mục đầu tiên của infosec.
- Rect đi từ renderer là **bề mặt IPC mới** (dù đã clamp + resolve cửa sổ từ sender).

**Việc cần làm tiếp**

- **infosec re-audit bắt buộc** trên: bề mặt IPC `browser:*`, `openFromUser`, mô hình cookie chia sẻ giữa người dùng và agent, và **toàn bộ phần B** (đọc profile browser thật, khoá Keychain, staging LevelDB vào partition lúc boot).
- Nhánh `v10` của phần B **chưa verify trên dữ liệu thật** — sandbox chặn việc đọc cookie DB của người dùng, nên nó chỉ được test bằng jar tự dựng với khoá tự sinh (đủ 4 nhánh: v10 thường, v10 có tiền tố hash, v20, plaintext). Lần đầu ai đó chạy trên máy có `v10` là lần verify thật.
- Cân nhắc cho model một action `show` để nó tự mở panel khi bắt đầu duyệt (hiện chỉ người dùng mở được).
- `viewport` khi tab đang nhúng trong panel chỉ emulate qua CDP, không đổi được rect thật (rect là của layout) — chấp nhận, ghi trong spec.

## Tham chiếu

- [ADR 0043 — browser_tool: Chromium nhúng](0043-browser-tool-embedded-chromium.md) (ADR này revisit phần window model)
- [docs/features/browser-tool.md](../features/browser-tool.md) · [docs/features/session-browser-panel.md](../features/session-browser-panel.md)
- [docs/features/workspace-panel.md](../features/workspace-panel.md) — panel chứa view này
- [ADR 0024](0024-task-execution-engine-ipc-contract.md) D-7 — task chạy không người trông (ràng buộc headless)
