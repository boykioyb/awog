# 0084 — Đánh thức khi không còn cửa sổ + phạm vi "push notification"

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-07
- **Người quyết định:** developer (gói #22 + #20, nhánh `feature/claude-desktop-parity`)

## Bối cảnh

Hai lỗ hổng cùng một chủ đề: **việc chạy xong nhưng không tới được người dùng.**

**(A) Wake do renderer lái.** [ADR 0066](0066-session-background-exec-and-wake.md) P2 chốt rằng
reactive wake là việc của renderer: `sessions/bg-registry.ts` phát `session.background-done`, còn
`stores/sessions.ts` xếp vào `pendingWakes` rồi hoặc auto-continue (toggle `autoContinueOnBackground`,
mặc định TẮT) hoặc hiện card "Tiếp tục". Lý do khi đó vẫn đúng: sidecar **không có primitive "bắt đầu
một lượt"** — mọi lượt đều do renderer gọi `sessions.sendMessage`.

Hệ quả không ai tính: **đóng cửa sổ UI là hết wake.** Trên macOS app vẫn sống (Dock/tray), engine vẫn
chạy, lệnh nền vẫn xong — nhưng không còn renderer nào nghe `engine:event`. Sự kiện rơi vào hư không:
`pendingWakes` sống trong bộ nhớ renderer nên mở lại app cũng **không có card**, chỉ còn cái chip
"đã exit" nếu người dùng tự mở đúng phiên đó ra xem. Cùng lỗ hổng với lượt chạy xong và cổng xin
quyền: `composables/useNativeNotify.ts` bắn Web Notification **từ renderer**, chết theo cửa sổ.

**(B) "Push" không phải push.** `grep webpush|VAPID|pushManager` → 0 kết quả. PWA Remote
([ADR 0067](0067-mobile-remote-control-transport.md)) chỉ nhận thông báo **khi còn kết nối WebSocket
trong tailnet**; đóng app trên điện thoại là im.

Ràng buộc bao trùm:

- Invariant #5 (**no telemetry** ra ngoài trừ host model đã allowlist) và tinh thần local-first.
- Invariant #6 (no port public) — transport hiện tại chỉ bind trong tailnet, fail-closed.
- Phiên vẫn giữ bất biến "một phiên chỉ chạy 1 lượt tại một thời điểm".
- Lượt LLM **tiêu tiền thật** của người dùng.

## Quyết định

### 1. Hàng đợi wake nằm ở **Electron main**, giao lại bằng **phát lại nguyên văn**

`electron/src/wake.ts`:

1. Nghe `engine.onEvent` (main vốn đã là nơi fan-out sự kiện tới các cửa sổ).
2. Tính **cửa sổ sở hữu** phiên đúng theo luật hand-off của session popout: phiên đã pop ra thì cửa
   sổ popout sở hữu, còn lại thuộc cửa sổ chính. Không có cửa sổ sở hữu ⇒ không ai nhận được.
3. Không ai nhận được thì **park** `session.background-done` (trần 50, bỏ cái cũ nhất) và **báo bằng
   thông báo OS phát từ main**.
4. Cửa sổ chính mở lại, renderer đăng ký nghe ⇒ main **phát lại nguyên văn** sự kiện đó trên đúng
   kênh `engine:event`. Store xử lý y như lúc nhận trực tiếp — **không có nhánh code thứ hai**, và
   `stores/sessions.ts` không phải sửa một dòng nào.

Tín hiệu "renderer đã sẵn sàng" do **preload** gửi (`engine:subscribed`, phát mỗi lần có ai gọi
`onEvent`). Vì trong renderer có nhiều nơi cùng gọi `onEvent` và cái đầu tiên không chắc là store
phiên, main **chờ 750ms** rồi mới phát lại, cho mọi listener vòng đời app kịp gắn.

### 2. **KHÔNG** tự chạy lượt LLM khi không có cửa sổ nào mở

Park xong là dừng. Toggle `autoContinueOnBackground` vẫn quyết định như cũ, chỉ khác là nó chạy
**lúc cửa sổ mở lại**. Hai lý do độc lập, đủ một cái cũng chốt: (1) muốn chạy headless thì sidecar
phải có primitive "bắt đầu một lượt" — hiện không có, và dựng nó là việc lớn hơn hẳn gói này;
(2) một lượt LLM tiêu tiền của người dùng, chạy khi không ai nhìn là quyết định phải do họ bật tường
minh chứ không phải hệ quả phụ của việc đóng cửa sổ. **Mặc định TẮT, và ở bản này là không có.**

### 3. Thông báo cấp OS phát từ **tiến trình main** (`electron/src/notify.ts`)

Đây là kênh duy nhất còn lại khi renderer đã chết. Ba nguồn, tất cả **chỉ khi không cửa sổ nào nhận
được sự kiện** — nên nó không bao giờ trùng với thông báo của renderer:

| Sự kiện | Thông báo | Park |
|---|---|---|
| `session.background-done` (`wake ≠ false`) | "Lệnh nền đã xong / thất bại" + lệnh | ✅ |
| `session.permission-request` | "AWOG cần bạn cho phép" + tên tool | ❌ |
| `session.message.done` | "Lượt đã xong / bị lỗi" + trích đoạn | ❌ (transcript dựng lại từ JSONL) |

Bấm vào thông báo → mở cửa sổ chính + đi tới **đúng phiên**, dùng lại kênh `tray:command` mà
`useTrayStatus` đã xử lý sẵn. Cửa sổ chưa sẵn sàng thì đích đến được để dành và **preload kéo về
đúng lúc gắn handler** (`wake:drainRoute`) — không đoán mò thời điểm mount.

Công tắc `whenClosed` (mặc định **BẬT**) do main giữ, ở `userData/notifications.json`, hiện ở
Settings → Thông báo. Main không đọc được `stores/settings.ts` (localStorage của renderer) nên nó
phải có pref của riêng nó; ngôn ngữ lấy theo `app.getLocale()` với bảng 5 câu tại chỗ.

### 4. **KHÔNG** làm Web Push. Kết luận dứt khoát, không phải "để sau".

Web Push thật cần một **push service của trình duyệt** (FCM cho Chrome/Android, autopush của
Mozilla, APNs cho Safari/iOS): endpoint công khai trên hạ tầng của Google/Mozilla/Apple, cộng
VAPID key. Nội dung có mã hoá đầu-cuối, nhưng **metadata thì không**: mỗi lần báo là một lần lộ ra
bên thứ ba rằng máy này vừa có việc gì đó xong, lúc mấy giờ, tần suất ra sao, từ IP nào. Đó đúng là
thứ invariant #5 cấm, và nó phá luôn mô hình transport tailnet-only của ADR 0067 (đang fail-closed,
không phụ thuộc Internet). Thêm nữa iOS đòi PWA phải được cài ra màn hình chính mới có push.

Nói thẳng: **không nên làm** trong ràng buộc local-first của AWOG. Nếu về sau vẫn muốn thì phải là
một ADR riêng + infosec audit + opt-in tường minh, chứ không lặng lẽ bật kèm.

Phần khả thi đã làm thay: PWA đã dùng `registration.showNotification` của service worker (kênh duy
nhất Android Chrome hiện khi trang ở nền) + `notificationclick` focus lại app; bản này thêm nốt
thông báo cho **việc nền xong** — trước đó chỉ có cổng quyền và lượt xong. Giới hạn còn lại được ghi
thẳng vào UI: điện thoại nhận được **khi app Remote còn kết nối tailnet**.

## Phương án đã cân nhắc

- **Hàng đợi wake ở sidecar** — sidecar cũng sống lâu hơn renderer, nhưng nó **không có khái niệm cửa
  sổ**: không tính được "có ai nhận được không", nên vẫn phải hỏi ngược main. Từ chối.
- **Persist hàng đợi ra đĩa (sống qua lần khởi động app)** — YAGNI cho bản này: bản thân shell nền đã
  restart-safe trên đĩa, và `reloadBackgroundShells` cố ý coi shell đã exit từ tiến trình trước là
  "đã đọc" để restart không dựng lại đống chip của hôm qua. Đảo luật đó là một quyết định riêng.
- **Preload đệm mọi sự kiện `engine:event` từ lúc load** — đụng vào đường đi của MỌI sự kiện, mọi cửa
  sổ, để giải một ca hiếm. Từ chối theo KISS.
- **Kéo hàng đợi (drain) ngay trong `onEvent` của preload** — hỏng: trong renderer có nhiều module
  cùng gọi `onEvent` (git, wiki, commands…), module nào gọi trước sẽ nuốt mất wake vì handler của nó
  không xử lý sự kiện phiên. Vì vậy mới chọn "main phát lại trên kênh chung" — mọi listener đều nhận.
- **Cho main đọc `settings.notifications` của renderer** — không có đường: pref nằm ở localStorage
  của renderer, mà lúc cần nó nhất thì renderer không tồn tại.
- **Web Push thật** — xem mục 4.

## Hệ quả

- **Tích cực:** đóng cửa sổ không còn mất wake; lệnh nền / cổng quyền / lượt xong đều tới được người
  dùng; bấm thông báo là vào đúng phiên; `stores/sessions.ts` và sidecar **không đổi hành vi**.
- **Trade-off:** hàng đợi sống theo vòng đời **app**, không qua lần khởi động lại; việc nền xong lúc
  app tắt hẳn vẫn chỉ được phát hiện khi mở phiên ra xem. Trên Windows/Linux đóng cửa sổ cuối là app
  thoát nên toàn bộ cơ chế này chỉ có tác dụng thực tế ở macOS (và khi còn cửa sổ popout).
- **Trade-off:** ngôn ngữ thông báo theo locale của OS, có thể lệch với ngôn ngữ đang chọn trong app.
- **Việc cần làm tiếp:** Tasks/Workflows chưa có wake và chưa được báo khi cửa sổ đóng (`task.status`
  với `waitingApproval` là chỗ móc rõ ràng nhất) — cố ý để ngoài phạm vi gói này. Bridge type
  `getNotifyPrefs`/`setNotifyPrefs` đang khai tại chỗ trong `SettingsNotifications.vue`, nên gộp vào
  `types/awog-bridge.d.ts` khi file đó rảnh tay. **infosec** nên soi mục 4 (đã kết luận không gửi gì
  ra ngoài) và nội dung thân thông báo (một dòng, cắt 140 ký tự, có thể hiện trên màn hình khoá).

## Tham chiếu

- [ADR 0066 — Session background exec + reactive wake](0066-session-background-exec-and-wake.md)
- [ADR 0067 — Mobile Remote Control transport](0067-mobile-remote-control-transport.md)
- [Feature — Session background exec + reactive wake](../features/session-background-tasks.md)
- [.claude/rules/security.md](../../.claude/rules/security.md) — invariant #5, #6
