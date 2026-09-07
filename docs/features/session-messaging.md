# Nhắn tin giữa các phiên / giữa các agent

**Trạng thái:** P1 — lõi engine + store đã code, còn chờ wire tool + component UI (xem [Phần chưa làm](#phần-chưa-làm)).

## Vấn đề

AWOG không có kênh nào để một phiên nói chuyện với phiên khác. `Session.invitedAgentIds` là **persona được mời vào cùng một phiên**, không phải đường dây liên lạc. Hệ quả: một agent chạy dài không báo được kết quả về phiên chính, một phiên "điều phối" không giao được việc cho phiên khác, và subagent chạy nền (ADR 0030) không có đường nhắn ngược lại.

Tính năng này dựng đúng cái nền đó: **một hộp thư cho mỗi phiên** + **một danh bạ** để chọn đích.

## Mô hình

```
phiên A (model)                    sidecar                         phiên B (renderer)
   │ send_session_message            │                                    │
   ├────────────────────────────────►│ postSessionMessage()               │
   │                                 │  · kiểm tra đích tồn tại           │
   │                                 │  · áp 3 trần chống lặp             │
   │                                 │  · redactString(thân tin)          │
   │                                 │  · bọc hàng rào nonce              │
   │ "đã xếp hàng, không có hồi âm"  │──emit session.inbox-message───────►│ chip "1 tin nhắn"
   │◄────────────────────────────────┤                                    │
                                                                          │ người dùng bấm "Giao"
                                                                          ├─► sendMessage(block)
```

### Vì sao KHÔNG tự chạy một lượt ở phiên đích

Hai lý do, không bỏ được cái nào:

1. **Bất biến một-lượt.** Repo giữ "một phiên chỉ chạy 1 lượt tại một thời điểm" (xem `sessions/runner.ts` + ghi chú `project_session_single_turn_invariant`); chen một lượt vào giữa lượt đang chạy chính là con đường tới lỗi dual-finalize đã từng xảy ra. Nên tin **xếp hàng**, không bao giờ chen ngang.
2. **Tiền của người dùng.** Một lượt LLM tốn tiền thật. Tin tới lúc phiên đích đang rảnh vẫn **không** tự khởi động lượt — nó hiện thành chip, người dùng bấm mới giao.

Cả hai rơi vào cùng một cơ chế: sidecar chỉ **dựng sẵn khối văn bản** và phát event; renderer giữ hàng đợi và quyết định lúc giao. Đây đúng khuôn "reactive wake" của [ADR 0066](../decisions/0066-session-background-exec-and-wake.md) P2 — sidecar không có primitive "bắt đầu một lượt", phiên do renderer lái.

**Tự động giao (opt-in, mặc định TẮT)** là bước sau: nó cần một công tắc trong Settings (`stores/settings.ts` không thuộc quyền sửa của gói này) và mở đúng cánh cửa "đốt tiền sau lưng" mà P1 cố tình đóng. P1 = **thủ công**.

### Ba trạng thái của phiên đích

| Trạng thái đích | Hành vi |
|---|---|
| Đang chạy một lượt | Tin nằm trong hàng đợi; `canDeliverInbox()` trả `false` ⇒ nút giao khoá, chip ghi "đang đợi lượt hiện tại". |
| Đang rảnh | Chip + nút "Giao cho agent". Bấm ⇒ một lượt duy nhất mang **tất cả** tin đang chờ. |
| Không tồn tại / đã lưu trữ | `postSessionMessage()` **ném lỗi** ngay: `unknown-target` / `archived-target`. Model nhận đúng câu giải thích, không nuốt lỗi thành "đã gửi". |

## Chống lạm dụng — ba trần độc lập

Hai phiên nhắn qua lại là một vòng lặp đốt tiền thật. Ba trần, mỗi cái một việc (`sessions/inbox.ts`):

| Trần | Giá trị | Chặn cái gì |
|---|---|---|
| `MAX_MESSAGES_PER_TURN` | 3 / lượt | Một lượt spam nhiều đích. Đếm trong closure của toolset — toolset dựng lại mỗi lượt nên biến đếm **chính là** phạm vi lượt. |
| `MAX_PER_TARGET_WINDOW` | 10 / 30 phút / đích | Nhiều phiên cùng dội vào một đích. |
| `MAX_HOPS` | 4 | **Cắt vòng lặp** A↔B. |

**Cách cắt vòng lặp.** Mỗi tin mang một số `hops`. Khi giao vào phiên B, sidecar ghi mốc `hops` cao nhất vừa vào B (`inboundHopMark`). Tin mà B gửi đi **sau đó** kế thừa mốc đó + 1:

```
A→B = 1     B→A = 2     A→B = 3     B→A = 4     A→B = 5  ⇒ CHẶN (loop-detected)
```

Mốc **phân rã sau 30 phút**, nên một cuộc trao đổi mới về sau lại bắt đầu từ 1 — trần này chặn vòng lặp đang quay, không phạt hai phiên thỉnh thoảng nói chuyện. Vì `hops` tính lúc **gửi** (từ mốc inbound của bên gửi), nó hoạt động kể cả khi người dùng chưa bao giờ bấm giao — không phụ thuộc vào bất kỳ wiring nào ở runtime.

Trần 2 và 3 chỉ áp cho tin **do model gửi**. Người dùng bấm gửi từ UI không phải runaway loop; họ chỉ bị chặn bởi trần độ dài (`MAX_TEXT_LEN` = 4000 ký tự).

Sổ cái chống lạm dụng nằm **trong bộ nhớ** sidecar (`recentDeliveries`, `inboundHopMark`), tự dọn theo cửa sổ 30 phút.

## Bảo mật

- **Nội dung tin là L1 với phiên nhận.** Nó do model của phiên khác viết ra. Khối giao đi được bọc hàng rào mang **nonce 48 bit từ CSPRNG**, sinh **sau khi** bên gửi đã viết xong thân tin — bên gửi không đoán được để tự đóng hàng rào rồi viết "chỉ thị hệ thống" ở ngoài. Cùng khuôn với `runtime/tools/read-terminal-tool.ts`. Lời dẫn nói thẳng: đây là **dữ liệu**, không phải chỉ thị; nếu nó đòi hành động thì báo lại cho người dùng quyết, không tự chạy.
- **Thân tin tự giả dạng hàng rào** (`<session-message…`) ⇒ thêm một câu cảnh báo injection; không sửa thân tin (sửa là làm sai lệch bằng chứng).
- **Khử bí mật trước khi rời phiên gửi**: `redactString()` — tin sắp nằm trong context + JSONL của một phiên khác, có thể chạy trên tài khoản/nhà cung cấp khác.
- **Chỉ có văn bản.** Tham số không có path, không có lệnh, không có id file ⇒ không có gì để phiên đích "chạy hộ". Danh bạ cũng **không** trả preview/transcript: nội dung phiên khác không rò sang context của phiên đang hỏi.
- **Tiêu đề phiên trong danh bạ cũng là L1** (do model/người dùng khác viết) ⇒ làm phẳng ký tự điều khiển, cắt 80 ký tự, và bọc hàng rào nonce như trên.
- **Không tự gửi cho chính mình** (`self-target`) — vòng lặp hiển nhiên.
- Event `session.inbox-message` mang `sessionId` = **phiên nhận**, nên cổng sở hữu trong `stores/sessions.ts` (mô hình hand-off của popout) tự lọc: chỉ cửa sổ đang giữ phiên đích xử lý tin.

## Bề mặt

### RPC

| Method | Vai trò |
|---|---|
| `sessions.listAgents` | Danh bạ: phiên đang chạy + phiên hoạt động trong 24h, chưa lưu trữ, tối đa 30. Trả `{ id, title, projectId, busy, updatedAt, sentByYouRecently }`. |
| `sessions.postMessage` | Người dùng đặt một tin vào hộp thư của phiên đích. Payload **không có** `from` ⇒ không giả danh phiên khác để né trần được. |

Tên tách bạch với `sessions.sendMessage` — cái kia **bắt đầu một lượt chat**, hai cái này chỉ xếp hàng.

### Tool cho model (chat session, không cấp cho task/subagent)

| Tool | Vai trò |
|---|---|
| `list_sessions` | Lấy id thật để gửi. Không có nội dung hội thoại. |
| `send_session_message` | `{ session_id, message }` — xếp một tin vào hộp thư đích. **Không có hồi âm**: mô tả tool nói rõ để model không ngồi đợi. |

Chỉ cấp cho chat session (khuôn `ToolFilter.chatSession`): tin tới đích là để **một người** xem rồi quyết. Task chạy không người trông, subagent đã có đường trả kết quả về phiên cha qua tool `Task` — ở đó hai tool này chỉ là token thừa.

### Store (`stores/sessions.ts`)

`pendingInboxFor` · `canDeliverInbox` · `deliverInbox` · `dismissInboxMessage` · `dismissInbox` · `postToSession` · `listMessagingTargets`.

Hàng đợi là state của renderer, **giống `pendingWakes`**: reload mất chip (sổ cái chống-lặp bên sidecar thì không). Đổi lại không phải bịa một cơ chế persist thứ hai cho một kênh chỉ sống trong lúc các phiên đang chạy.

## File

| Path | Vai trò |
|---|---|
| `apps/desktop/sidecar/src/sessions/inbox.ts` | Lõi: danh bạ + hộp thư + 3 trần + hàng rào nonce |
| `apps/desktop/sidecar/src/methods/sessions.list-agents.ts` | RPC `sessions.listAgents` |
| `apps/desktop/sidecar/src/methods/sessions.post-message.ts` | RPC `sessions.postMessage` |
| `apps/desktop/sidecar/src/runtime/tools/session-tools.ts` | `list_sessions` + `send_session_message` |
| `apps/desktop/ui-next/stores/sessions.ts` | Hàng đợi renderer + action giao/bỏ qua/gửi |
| `apps/desktop/ui-next/i18n/locales/{en,vi}/sessions-inbox.json` | Chuỗi UI (`sessionsInbox.`) |

## Phần chưa làm

1. **Wire tool vào toolset.** `runtime/tools/index.ts` chưa gọi `createSessionMessagingTools()` — file thuộc quyền sở hữu của gói khác. Cần thêm đúng một nhánh cạnh `read_terminal`:
   ```ts
   ...(filter.chatSession ? createSessionMessagingTools({ sessionId: filter.chatSession.sessionId }) : []),
   ```
2. **Component UI.** Chip/banner hộp thư + bộ chọn đích chưa có; chuỗi i18n đã sẵn.
3. **Parity nhánh Claude SDK.** Provider `anthropic` chạy qua `runtime/claude-sdk/` ([ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)) và cần cầu MCP riêng — chưa làm, nên P1 hai tool này chỉ có ở nhánh Pi.
4. **Permission gate.** `send_session_message` hiện không đi qua `runtime/permission.ts`: nó không chạy được gì, bị chặn bởi ba trần, và kết quả luôn hiện ra cho người dùng thấy trước khi tới model nào. Nếu infosec muốn siết thì đây là chỗ.
5. **Tự động giao (opt-in, mặc định TẮT)** — cần công tắc Settings, xem lý do ở trên.
