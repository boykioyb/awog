# Feature — Dung lượng phiên (Settings → Dung lượng)

**Trạng thái:** Đã land (2026-09-12) · **Liên quan:** [ADR 0038](../decisions/0038-session-rewind.md) (snapshot), [ADR 0048](../decisions/0048-session-header-event-log.md) (JSONL)

## Vấn đề

Session store phình vô hạn và **không có bề mặt nào báo**. Đo trên máy thật trước khi viết dòng code nào:

```
~/.awog/sessions   11 GB / 820 entry
  snapshots/      7.7 GB  70%   ← blob file của Rewind
  file rời        2.8 GB  26%   ← 198 file *.bak / *.bloated-* từ một lần sửa cũ
  session.jsonl   654 MB   6%   ← chính hội thoại
  attachments/    125 MB   1%
```

Hai con số đó quyết định toàn bộ thiết kế, và cả hai đều trái trực giác: **hội thoại chỉ chiếm 6%** — xoá phiên để lấy chỗ là nhắm sai chỗ. Còn 26% thậm chí **không phải dữ liệu của app**: rác migrate mà không code nào mở được.

Vì sao snapshot phình: `snapshots.ts` prune **trong một phiên** (giữ 20 bản mới nhất, GC blob không còn tham chiếu) nhưng **không bao giờ prune xuyên phiên**. Một phiên xong việc từ ba tháng trước vẫn ôm nguyên 20 snapshot workspace của nó, mãi mãi.

## Thiết kế

**Sidecar** — [`src/storage/scan.ts`](../../apps/desktop/sidecar/src/storage/scan.ts):

- `scanStorage()` → tổng + tách theo loại (transcript / snapshot / attachment / other) + gom **theo project** + danh sách phiên sắp theo dung lượng + orphan (file rời nằm thẳng dưới `sessions/`). Thư mục phiên **không đọc được header** vẫn được liệt kê — đó chính là trường hợp cần báo nhất, vì không chỗ nào khác trong app nhìn thấy nó.
- `pruneSnapshots({ olderThanDays, projectId?, skipIds })` → xoá cây `snapshots/` của phiên lâu không đụng. **Không đụng vào hội thoại.**
- `deleteOrphans()` → xoá file rời.

RPC `storage.scan` · `storage.pruneSnapshots` · `storage.deleteOrphans`.

**Ba rào an toàn** (đây là code XOÁ, nên chúng là tính năng chứ không phải chi tiết):

1. **Phiên đang chạy luôn được bỏ qua** — `storage.pruneSnapshots` tự truyền `activeSessionIds()` vào `skipIds`; một phiên giữa lượt đang ghi snapshot ngay lúc đó.
2. **`olderThanDays` tối thiểu là 1** (zod `min(1)`) — `0` sẽ có nghĩa "mọi phiên kể cả cái đang mở", một cú bấm nhầm không được phép xoá lịch sử Rewind đang dùng.
3. **Nói trước sẽ giải phóng bao nhiêu.** Hộp xác nhận tính `reclaimable` từ scan đang hiển thị: *"Giải phóng khoảng 6.3 GB từ các phiên không đụng tới quá 30 ngày. Hội thoại vẫn giữ."* — "giải phóng 6.3 GB" là một quyết định người dùng cân được; "xoá snapshot" thì không.

Phiên không có `updatedAt` đọc được ⇒ coi là **cũ**, không phải bất tử — nếu không thì phiên hỏng header lại là thứ duy nhất không bao giờ dọn được.

**UI** — [`SettingsStorage.vue`](../../apps/desktop/ui-next/components/settings/SettingsStorage.vue): tổng + thanh xếp chồng theo loại (trả lời *nặng bao nhiêu* và *nặng vì cái gì*), hai nút dọn, bảng **theo dự án** kèm mini-bar, và **12 phiên nặng nhất** kèm nút xoá từng phiên — nhóm này thường là cả vấn đề, mà từ danh sách session thường không nhìn ra.

`storage.scan` quét cả cây: vài giây trên store nhiều GB ⇒ gọi lúc mở pane và sau mỗi lần dọn, **không bao giờ đặt timer**.

## Test

[`src/storage/__tests__/scan.test.ts`](../../apps/desktop/sidecar/src/storage/__tests__/scan.test.ts) — 9 test trên cây tạm thật: tách byte theo loại, gom theo project + sắp xếp, phân biệt orphan vs phiên, phiên không header vẫn hiện; prune đúng cutoff **và giữ lại `session.jsonl`**, không đụng phiên mới, **không đụng phiên đang chạy**, giới hạn theo project; deleteOrphans chỉ xoá file rời.

## Toast — và một lỗi có sẵn lộ ra cùng lúc

Bản đầu gọi `useToasts()`, và **nút bấm chạy trong im lặng**. ui-next có **hai** hệ toast:

| | `useToasts()` | `pushActionToast()` |
|---|---|---|
| State | **per-caller** — mỗi lần gọi là một `ref([])` riêng | singleton cấp module |
| Host | **không có**; caller phải tự render hoặc `return toasts` cho page | `ActionToastHost` mount sẵn ở **layout root** |

Gọi `useToasts()` từ một component không tự render ⇒ toast xếp vào một mảng **không ai hiển thị**. Với màn này còn một lý do thứ hai phải dùng singleton: Settings là modal (`.ovl` z-index **100**), host singleton ở z-index **141** nên nổi lên trên.

Audit lại toàn bộ call site thì lộ ra **4 file dính sẵn lỗi này từ trước** — `SshForwardingSection.vue`, `SshForwardPanel.vue`, `useSftpBrowser.ts` (17 call site), `useSftpContextMenu.ts`: lỗi SSH port-forward và xác nhận copy SFTP đều câm lặng. Đã chuyển cả 4 sang `pushActionToast`.

Lệnh audit (`renders=0` **và** `returns=0` ⇒ toast bị nuốt):

```bash
for f in $(grep -rl "useToasts()" components/ pages/ composables/); do
  printf "%-56s renders=%s returns=%s\n" "$f" \
    "$(grep -c 'v-for="[a-z]* in toasts' $f)" "$(grep -c 'toasts,' $f)"
done
```

### `{n}` lọt ra màn hình

Sau khi toast chạy được, user báo một toast đọc là **"Đã giải phóng 0 B từ `{n}` phiên"**. Ba lỗi chồng lên nhau, mỗi cái sửa một chỗ:

1. **`useI18n.ts` cố tình in placeholder thô.** `interpolate()` trả `` `{${key}}` `` khi param `undefined` — tín hiệu cho lập trình viên, nhưng hiển thị cho người dùng. Nay: `console.warn` khi `import.meta.dev`, render chuỗi rỗng, câu vẫn đọc được như một câu.
2. **"Giải phóng 0 B" là câu trả lời rỗng.** User bấm để lấy chỗ trống mà không lấy được gì thì phải nói thẳng: `settings.storage.nothingToClean` → *"Không có gì để dọn"*.
3. **Engine cũ vẫn trả `sessionCount`.** Sidecar đóng gói kèm app nhưng **chỉ nạp bản build mới khi khởi động lại**, nên UI hot-reload có thể đang nói chuyện với engine cũ — đúng tình huống user gặp. `useStorageApi` chuẩn hoá `count ?? sessionCount ?? 0` để phía dưới không phải biết hai hình dạng.

Cả bốn nhánh verify trên app thật: engine mới · engine cũ (`sessionCount`) · không giải phóng được gì · lỗi RPC.

Kèm theo, `PruneResult.sessionCount` đổi tên thành `count`: cả prune (đếm **phiên**) lẫn deleteOrphans (đếm **file**) đều trả field đó, và cái tên rò ra tận toast — "giải phóng 2.8 GB từ **199 phiên**" trong khi vừa xoá 199 file rời. Giờ mỗi đường có chuỗi riêng.

## Còn lại

- Chỉ tính `~/.awog/sessions`. `sdk-sessions/` (1.3 MB), `usage/`, `tasks/` chưa vào — nhỏ hơn ba bậc độ lớn nên chưa đáng.
- **Chưa có retention tự động.** Dọn vẫn là thao tác tay. Một chính sách "tự bỏ snapshot quá N ngày" khi khởi động sẽ hợp lý, nhưng xoá tự động cần chốt riêng.
- Chưa dọn được theo từng project từ UI (RPC đã nhận `projectId`, UI chưa gắn nút).
