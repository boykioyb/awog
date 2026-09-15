# Feature — Bong bóng phiên: một phiên thu nhỏ ở góc phải màn hình

- **Trạng thái:** **Đã code 2026-09-14** (yêu cầu trực tiếp của người dùng, ngoài 8 mốc) — **chưa QA trong Electron thật**
- **Nguồn:** yêu cầu người dùng, nguyên văn: *"làm cả phần bubble session ở góc phải màn hình nhé, bản chất nó là mini session, folder tương tác sẽ là awog-infra (không phải awog, tôi muốn nó là infra riêng, tạo folder mới nếu chưa có). mở full sẽ điều hướng về session. các phần hỏi agent đều có option là cho vào session hiện tại hay mở session mới, trong màn agent sẽ có hiển thị toàn bộ session cả danh sách, cứ hiểu nó là dạng thu nhỏ"*
- **Chỗ đứng:** cửa sổ chính — `layouts/default.vue` (KHÔNG vào `AppGlobalHosts`, xem §"Chỗ đứng")
- **Anh em:** [infra-explorer.md](infra-explorer.md) · [infra-audit-log.md](infra-audit-log.md) · [session-infra-context.md](session-infra-context.md)

## Bốn yêu cầu, và cái nào khó

| # | Yêu cầu | Ghi chú |
|---|---|---|
| 1 | Bong bóng ở góc phải, bản chất là **mini session** | khó nhất: nó phải là **cùng một phiên**, không phải một widget chat thứ hai |
| 2 | Thư mục tương tác là **`awog-infra`**, không phải repo đang mở; tạo nếu chưa có | một project riêng, không dùng chung workspace |
| 3 | **Mở full** ⇒ điều hướng **về phiên** | không phải "mở to bong bóng", cũng không phải về `/infra` |
| 4 | Mọi chỗ "Hỏi agent" có hai lựa chọn: **phiên hiện tại** hay **phiên mới**; trong bong bóng xem được **toàn bộ danh sách phiên** | một lựa chọn dùng chung cho 5 màn |

## Một phiên THẬT, chỉ khác bề rộng

Bong bóng gọi đúng những thứ màn phiên gọi:

| Việc | Đi qua |
|---|---|
| Tạo phiên | `sessions.create(projectId)` |
| Gửi tin | `sessions.sendMessage(id, text)` |
| Dừng lượt | `sessions.cancel(id)` |
| Chọn phiên đang xem | `sessions.setActive(id)` + `navigateTo('/sessions')` |

**Không có state thứ hai.** Một "mini chat" tự giữ transcript riêng là một phiên thứ hai để lệch: gửi trong bong bóng thì phiên không biết, và ngược lại. Đây là lý do bong bóng không có store của riêng nó — chỉ có `open`/`pane`/`sessionId` ở module (`useInfraBubble`), và `sessionId` là **cùng một id** mà màn phiên dùng.

State nằm ở **module**, không nằm trong component: bong bóng phải sống ngoài mọi trang, nếu không thì đổi trang là mất phiên đang thu nhỏ — đúng thứ "mini session" sinh ra để tránh. Cùng khuôn với `useMinimizeDock`.

## Thư mục `awog-infra` — hai thứ khác nhau về mục đích

| Thứ | Để làm gì |
|---|---|
| **Project `awog-infra`** | để phiên có một chỗ đứng, một cái tên trong sidebar, và không lẫn với phiên của repo đang mở. Đây là phần "infra riêng" của yêu cầu |
| **`workspaceFolder` của chính phiên** | **đây mới là thứ quyết định cwd**: `sessions.send-message` gửi `workspacePath` theo **từng lượt** từ trường này, nên kể cả project có bị đổi về sau thì "folder tương tác" vẫn là `awog-infra` |

Cả hai đều được ghim **ngay sau khi tạo phiên** (`setWorkspaceFolder`), không phải chỉ dựa vào project.

### Chọn chỗ đặt thư mục — không hardcode đường dẫn của ai

Thứ tự (`infra.bubble-workspace`):

1. `dir` do người dùng chọn (khi có đường UI).
2. **Cạnh project được tạo gần nhất** — thư mục cha của nó. Đặt cạnh code của người dùng là mặc định hợp lý, và nó **không đoán bừa vào `$HOME`**.
3. Không có project nào ⇒ `$HOME`.

### Hàng rào

Đây là RPC **tạo thư mục ở đường dẫn tuỳ ý**, tức một nguyên thuỷ ghi đĩa kể cả khi nó chỉ `mkdir`. Vì vậy nó từ chối: gốc hệ thống (`/`) · chính `$HOME` · `~/.awog` · `/etc`, `/usr`, `/bin`, `/sbin`, `/var`, `/System`, `/Library`. Đường dẫn là file (không phải thư mục) cũng bị từ chối.

**VÌ SAO CẦN RPC RIÊNG** thay vì `fs.createDir`: `fs.createDir` chỉ tạo được thư mục **bên trong một workspace đã có** (`assertInsideWorkspace`). Ở đây ta đang tạo **chính cái workspace đó**, nên không có gốc nào để kiểm — cùng tình huống với `projects.clone`.

## Ba mặt của khung

| Mặt | Nội dung |
|---|---|
| **Chat** | transcript thu nhỏ + ô soạn tin (Enter gửi · Shift+Enter xuống dòng · khi đang chạy thì nút thành **Dừng**) |
| **Danh sách** | **toàn bộ phiên**, mới nhất trước, dùng lại `SessionListItem` (một định nghĩa cho "một hàng phiên"); bấm một hàng ⇒ bong bóng chuyển sang phiên đó |
| **Mở full** | `sessions.setActive(id)` + `navigateTo('/sessions')` — về **phiên**, không phải về `/infra` |

Đầu bong bóng có **đèn trạng thái** (xám = rảnh · accent = đang chạy · vàng = đang chờ trả lời · đỏ = lỗi) và một dòng hiện **thư mục tương tác**, để người dùng biết phiên này đọc/ghi ở đâu.

## "Hỏi agent" — một lựa chọn, dùng chung cho 5 màn

`askAgent(text, source)` **không gửi gì cả** — nó mở `InfraAskTargetDialog`, và chỉ `deliver(text, target)` mới gửi:

| Đích | Nghĩa |
|---|---|
| **`current`** | **NỐI THÊM** vào draft của phiên đang mở (không ghi đè: người dùng thường gõ câu hỏi trước rồi mới đính ngữ cảnh vào) |
| **`new`** | tạo phiên trong project `awog-infra` rồi **ghim nội dung vào ô soạn tin** của nó — **không tự gửi**, vì câu hỏi về một dòng log thường cần người dùng viết thêm |

Hộp chọn nằm ở **một host dùng chung** (`AppGlobalHosts`), không ở từng màn: bốn bản sao của hộp này là bốn chỗ để "phiên mới" hiểu khác nhau về việc nó nên rơi vào project nào. Nó hiện **nhãn nguồn** ("một dòng log", "EC2 Instances"…) và **xem trước 600 ký tự** để người dùng biết mình đang gửi gì.

**Không bao giờ mất nội dung.** Chọn "phiên hiện tại" mà không có phiên nào đang mở, hoặc tạo phiên mới thất bại (quota), thì nội dung **rơi về clipboard** kèm toast nói rõ vì sao. Im lặng làm mất thứ người dùng vừa yêu cầu gửi là kiểu hỏng tệ nhất của một nút "gửi".

An toàn: nội dung đi qua `redactString()` của `runInfra` **trước khi rời sidecar**, nên chỗ này chỉ **nối**, không lọc lại — hai lớp lọc khác nhau là hai định nghĩa khác nhau về "bí mật".

## Chỗ đứng trên màn hình

```
                                              ┌──────────────────────┐
                                              │ ● Phiên hạ tầng  ▤ ⤢ ✕│  ← bong bóng (360px)
                                              │ 📁 ~/…/awog-infra     │
                                              │  … hội thoại …        │
                                              │ [ hỏi về hạ tầng… ] ➤ │
                                              └──────────────────────┘
                                              ┌──────┐
                                              │ dock │  ← phiên thu nhỏ (useMinimizeDock)
                                              └──────┘
```

- Đóng thì chỉ là **một viên tròn** ở góc phải dưới.
- Mở thì là khung `min(360px, 100vw − 32px)`, cao tối đa `min(520px, 100vh − 140px)`.
- **Đứng CAO HƠN dock thu nhỏ** (`bottom: 46 + số mục trong dock × 44`) — hai bề mặt ở cùng góc mà chồng nhau là hai bề mặt không dùng được.
- **Cố ý ở `layouts/default.vue`, KHÔNG ở `AppGlobalHosts`:** một cửa sổ popout **đã là** một phiên, nên thêm một phiên thu nhỏ nổi bên trong nó là hai điều khiển cho cùng một việc.

## Điểm lệch có chủ đích

| Điểm | Thực tế | Vì sao |
|---|---|---|
| **Transcript thu nhỏ** | cố ý **không** dùng `SessionMessageItem`; chỉ render chữ · suy nghĩ · bước công cụ · câu hỏi đang chờ · quyền · lỗi, kèm chỉ báo "đang chạy" | `SessionMessageItem` mang theo toàn bộ craft của màn phiên (markdown render, highlight, mermaid, hành động trên từng tin, neo bookmark) — trong khung 340px thì vừa không đọc được vừa kéo cả cây component vào mọi trang. **Mở full để xem đầy đủ** |
| **Danh sách phiên** | không có menu chuột phải | chọn phiên là hành động duy nhất ở đây; menu ngữ cảnh thuộc màn phiên |
| **`pane`** | chỉ hai mặt: `chat` ↔ `list` | bong bóng là chỗ **nhìn nhanh**, không phải chỗ quản lý phiên |

## Nợ đã biết

- **Chưa có đường UI đổi thư mục.** RPC đã nhận `dir` (và comment đầu file mô tả nút *"Đổi thư mục" → hộp thoại native*), nhưng **không có nút nào gọi nó** — hiện chỉ dùng được đường mặc định (cạnh project gần nhất, không thì `$HOME`). Ai muốn đổi thì phải sửa `defaultParentDir()` hoặc thêm nút.
- **Bong bóng chưa có trong ảnh chụp/kiểm thử thật** — mọi thứ ở tài liệu này là đọc code; chưa ai mở app bấm thử.
- **Chưa có phím tắt mở bong bóng** — hiện chỉ bấm viên tròn.
- **Bong bóng không tự khôi phục sau khi khởi động lại app** (`sessionId` là ref ở module, không persist) — phiên vẫn còn trong danh sách, chỉ là bong bóng không tự mở lại.

## Bảo mật

| Rủi ro | Xử lý |
|---|---|
| **RPC tạo thư mục ở đường dẫn tuỳ ý** | denylist gốc hệ thống + `$HOME` trần + `~/.awog`; từ chối nếu đích là file |
| **Phiên hạ tầng ghi vào repo đang mở** | Đây chính là lý do tồn tại của `awog-infra`: nếu dùng chung workspace, mọi file agent tạo khi đang xem hạ tầng sẽ rơi vào git working tree của người dùng, và `git status` của họ bẩn vì một việc không liên quan |
| **Nội dung log/tài nguyên đi vào chat** | Đi qua `redactString()` **trước khi rời sidecar**; bong bóng chỉ nối, không lọc lại |
| **Tạo phiên ngoài ý muốn** | `ensureSession()` chỉ chạy khi **mở bong bóng** hoặc khi người dùng chọn **"phiên mới"** — tạo phiên là một lượt gọi provider (tốn quota) và một dòng trong danh sách của người dùng, nên nó không được xảy ra sau lưng |
