# Transcript polish — WP4

Ba việc nhỏ nhưng đụng đúng chỗ người dùng hay vấp trong phiên chat: câu hỏi multi-select mất phần giải thích, job nền không xem được output, và thanh trạng thái thiếu thông tin git mà Claude Desktop có sẵn.

Liên quan: [ADR 0066 — background exec + wake](../decisions/0066-session-background-exec-and-wake.md) (job nền), [git-manager.md](./git-manager.md) (PR summary), [workspace-panel.md](./workspace-panel.md).

---

## 1. Multi-select giữ lại phần mô tả của lựa chọn

**Bug.** Tool `AskUserQuestion` ([ask-user-question-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/ask-user-question-tool.ts)) cho phép mỗi option có `description`. `SessionGateCard.vue` render nó ở nhánh **single-select** (`<b v-if="o.desc">`) nhưng **multi-select** thì bỏ qua — người dùng thấy danh sách nhãn trần, mất toàn bộ ngữ cảnh model vừa viết ra để giải thích từng lựa chọn.

**Sửa.** Nhánh multi-select bọc nhãn + mô tả vào `<span class="qchktext">` và render `o.desc` trong `<b>` giống hệt nhánh single:

| | Single-select (`.qopt b`, prototype.css:442) | Multi-select (`.qchktext b`, mới) |
|---|---|---|
| Bố cục | `display: block` (xuống dòng riêng) | như trên |
| Cỡ chữ | `var(--fs-sm)` / `var(--lh-sm)` | như trên |
| Màu | `var(--textDim)` | như trên |
| Đậm | `font-weight: 400` | như trên |

Khác biệt duy nhất là bố cục hàng: `.qchk` là flex row `align-items: center` (checkbox | chữ). Khi có mô tả, hàng thành 2 dòng nên class `has-desc` đổi sang `align-items: flex-start` + đẩy checkbox xuống 2px để nó canh theo **dòng đầu**, không canh giữa cả khối.

CSS đặt trong `<style scoped>` của [SessionGateCard.vue](../../apps/desktop/ui-next/components/session/SessionGateCard.vue) — không sửa `prototype.css`.

---

## 2. Xem output của job nền

**Trước.** Chip job nền ([SessionBackgroundChips.vue](../../apps/desktop/ui-next/components/session/SessionBackgroundChips.vue)) cho biết đang chạy / xong / lỗi và có nút dừng, nhưng output chỉ tới **gián tiếp** khi model gọi `BashOutput`. Người dùng không có đường nào tự đọc.

**Giờ.** Mỗi chip có thêm nút icon `terminal` → mở [SessionBackgroundOutputModal.vue](../../apps/desktop/ui-next/components/session/SessionBackgroundOutputModal.vue):

- Header: tiêu đề + pill trạng thái (đang chạy / exit N / interrupted) + nút đóng.
- Meta: **lệnh đầy đủ** (mono, `mono-ok`: lệnh shell copy-paste được) + thời điểm bắt đầu.
- Output: vùng cuộn riêng `overflow: auto`, `var(--code)`, `white-space: pre-wrap`, kèm nút copy.
- Modal ở `z-index: 120` (đúng dải modal 100–300), scrim `.ovl on` dùng chung, Esc để đóng.

State nằm ở [useSessionBackgroundOutput.ts](../../apps/desktop/ui-next/composables/useSessionBackgroundOutput.ts) — giữ **shellId** chứ không giữ object shell (store thay nguyên entry mỗi lần đổi trạng thái; giữ object sẽ đóng băng modal ở trạng thái cũ). Đổi session ⇒ tra không thấy shell ⇒ modal tự đóng.

### Output thật: RPC `sessions.backgroundRead` (WP7)

Sidecar giữ toàn bộ stdout+stderr của lệnh nền ở `~/.awog/sessions/<sid>/bg/<shellId>/log`. Trước WP7 chỉ tool `BashOutput` đọc được (qua `readBackground()` trong [bg-registry.ts](../../apps/desktop/sidecar/src/sessions/bg-registry.ts)); renderer chỉ thấy `outputTail` của event `session.background-done`, mất ngay khi wake bị tiêu thụ. WP7 bọc `readBackground()` thành RPC riêng — phương án (A) đã đề xuất.

**Contract** — [sessions.background-read.ts](../../apps/desktop/sidecar/src/methods/sessions.background-read.ts):

```ts
// params
{ sessionId: string, shellId: string, markRead?: boolean }   // markRead mặc định FALSE
// result
{ shellId, status: 'running'|'exited'|'exited-unknown', exitCode: number|null,
  output: string, truncated: boolean, droppedBytes: number, external: boolean }
```

Bốn điểm đáng nhớ:

| | Vì sao |
|---|---|
| `markRead` mặc định **false** | `readBackground()` gọi `markRead()` cho shell đã kết thúc ⇒ chip *retire*. **Người dùng xem output KHÔNG phải "model đã đọc kết quả".** Tham số mới `ReadBackgroundOptions.markRead` mặc định `true` nên đường tool `BashOutput` giữ nguyên hành vi cũ; chỉ RPC này truyền `false`. |
| Cắt theo đuôi | Log cap ở `MAX_OUTPUT_BYTES` = 64KB (đúng mức của tool one-shot Bash). `readOutputTail()` trả phần **đuôi** + cờ `truncated`/`droppedBytes`; RPC dùng `raw: true` để KHÔNG chèn dòng chú thích tiếng Anh vào giữa output — UI tự nói bằng ngôn ngữ người dùng (`sessionsBg.truncated`). Tool vẫn nhận chuỗi có chú thích inline như trước (`withTruncationNotice`). |
| Không đọc chéo session | Path do sidecar tự dựng: `sessionDir(sessionId)/bg/<shellId>`, tức thư mục cha **luôn** là session của chính request — không có tham số path nào từ UI. `shellId` bị chặn 2 lớp: zod `^[A-Za-z0-9._:-]+$` + cấm `..` (≤128 ký tự) ở biên RPC, và `sanitizeChild()` trong `shellDirFor()` (chặn `/`, `\`, `..`, `.`). Id sai session ⇒ `RpcError -32004 'Background shell not found'`, không rò rỉ gì. |
| `external` | Job nền của nhánh Claude SDK (`registerExternalBackground`) chạy trong tiến trình CLI, **không có file log** ⇒ `output` luôn rỗng. Cờ này để UI nói đúng lý do thay vì hiện hộp trắng hay báo lỗi đỏ. |

**Phía UI.** [useSessionBackgroundOutput.ts](../../apps/desktop/ui-next/composables/useSessionBackgroundOutput.ts) fetch qua action mới `sessions.readBackgroundOutput(engineId, shellId)` và giữ state `BgOutputState { text, loading, error, truncated, droppedBytes, external }`:

- Fetch khi mở modal; **đọc lại** khi trạng thái chip đổi (đang chạy → xong) nên output cuối cùng tự hiện, không cần đóng/mở lại. Mốc `fetchedStatus` chặn fetch trùng, biến `seq` chặn race (kết quả cũ về sau không ghi đè kết quả mới).
- Modal ([SessionBackgroundOutputModal.vue](../../apps/desktop/ui-next/components/session/SessionBackgroundOutputModal.vue)) render 5 trạng thái: đang đọc · lỗi đọc (**chỉ** trường hợp này tô `--danger`) · output thật (`<pre>`, text node — output là **L1 không tin**, tuyệt đối không `v-html`) · rỗng-vì-đang-chạy · rỗng-vì-external. Banner `sessionsBg.truncated` hiện phía trên khi log bị cắt.
- Metadata (lệnh đầy đủ, thời điểm bắt đầu, pill trạng thái) giữ nguyên như WP4.

---

## 3. Chip git ở thanh trạng thái: diff-stat + Create PR

[StatusBranch.vue](../../apps/desktop/ui-next/components/shell/StatusBranch.vue) trước đây chỉ có tên branch + badge số file bẩn.

**Thêm 1 — diff-stat `+N −M`** ngay trên chip, màu `var(--add)` / `var(--del)`, class `.tnum` (`font-variant-numeric: tabular-nums`) để số không nhảy khi đổi — **không** dùng mono (đây là con số, không phải code, theo ADR 0079 D3).

Nguồn số liệu, **không thêm RPC mới**:

- `git.status` **không** cung cấp được: `GitFileStatus.additions/deletions` là optional và parser `parsePorcelainV2` chưa bao giờ điền (đây cũng là lý do `WorkspaceDiff.vue` gần như không hiện +/−).
- Nên chip cộng dồn từ hai diff sẵn có: `git.diff { kind: 'workingTree' }` + `git.diff { kind: 'staged' }`, đếm `line.kind === 'add' | 'del'` — đúng cách `GitDiffViewer.vue` đang đếm.
- **Chưa tính file untracked**: `git diff` không thấy chúng, mà gọi `--no-index` cho từng file mới thì quá nặng cho một chip status bar. Badge số file bẩn vẫn đếm chúng, nên thông tin không bị mất hoàn toàn.

Refresh: watch `root` + debounce 200ms trên event `git:status:changed` — cùng nhịp với `useGitDirtyCount` / `useSessionBranch`.

**Thêm 2 — "Tạo pull request…"** trong footer popover (icon `merge`), gọi thẳng [usePrSummaryModal](../../apps/desktop/ui-next/composables/usePrSummaryModal.ts) với `head = null` (⇒ branch hiện tại). Trước đó lối vào duy nhất là context menu branch trong Git Manager (hoặc phím tắt ⌘I).

**Fail gracefully.** Không có project / không phải git repo / bridge không có (browser dev): `loadStat()` nuốt lỗi và đặt `stat = null` ⇒ chip **không** hiện diff-stat; mục "Tạo pull request…" chỉ hiện khi `branch != null`. Không throw ở bất kỳ nhánh nào.

---

## i18n

Chuỗi mới nằm ở `i18n/locales/{en,vi}/sessions-bg.json` (glob-merge, key phẳng dạng dotted):

- `sessionsBg.*` — modal output job nền. WP7 thêm `loading` / `noOutput` / `external` / `truncated` / `error`, bỏ `unavailable` (câu "app không còn giữ output" đã sai kể từ khi có `sessions.backgroundRead`).
- `statusbar.diffStat.title`, `statusbar.branch.createPr` — hai chuỗi của việc 3. Chúng nằm tạm trong file này để tránh đụng `statusbar.json` (file đang có agent khác sửa song song); **nên gộp về `statusbar.json`** khi dọn dẹp — key không đổi, merge theo key nên việc chuyển file là thao tác thuần cơ học.

Các chuỗi tái sử dụng: `sessions.bg.running` / `.exit` / `.interrupted` (trạng thái), `common.close` / `common.copy` / `common.copied`.
