# 0097 — Nhánh Claude SDK dùng transcript Claude làm session store; AWOG chỉ giữ index + annotation

- **Trạng thái:** Accepted (2026-10-11 — pointer-mode đã ship; replay fold qua `sessions/claude-transcript.ts`, xem hiệu chỉnh knock-on bên dưới)
- **Ngày:** 2026-10-11
- **Người quyết định:** kyro
- **Supersedes:** một phần mô hình persist của [ADR 0058](0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (ADR 0058 chọn Claude SDK làm runtime nhưng vẫn để AWOG persist transcript song song)

## Bối cảnh

Mỗi phiên Anthropic hiện được ghi **hai lần**, hai format khác nhau:

```
~/.awog/sessions/<slug>/session.jsonl               ← AWOG event adapter fold
~/.awog/sdk-sessions/projects/<proj>/<uuid>.jsonl   ← Claude CLI transcript
```

Nội dung trùng nhau đến mức gần 1-1 (text + tool calls + usage). Hệ quả đo được:

- **Disk ×2** mỗi turn, cộng thêm CPU fold JSONL hai lần.
- **Hai nguồn sự thật**: CLI attach (`awog session cli`) đọc file Claude, AWOG đọc file của mình — khi một bên hỏng (crash giữa fold, resume lệch) hai bản lệch nhau mà không ai phát hiện.
- **Compact native** (ADR-đề-xuất tiếp theo) khó cắm vào: AWOG checkpoint `firstKeptMessageId` không khớp `compact_boundary` của Claude, nên đường native buộc phải "re-seed" thủ công thay vì để CLI tự quản.

Người dùng hỏi: "có dùng luôn của Claude được không, AWOG chỉ lưu list biết vị trí?".

## Phương án đã cân nhắc

### Option A — Claude transcript làm source of truth; AWOG = index + annotation (chọn)

- **Mô tả:** Với `provider === 'anthropic'`, AWOG ngừng ghi `session.jsonl` nội dung. Session store chỉ còn file index nhẹ (`{ id, engineId, sdkSessionId, sdkSessionPath, title, status, pinned, archived, projectId, usageCache, bookmarks, todos, aboutTaskId, budget, pinnedContext, runTree }`) + transcript được **derive** lúc load bằng cách replay event-adapter trên CLI JSONL. Non-anthropic (Pi, Codex) giữ nguyên mô hình cũ.
- **Pros:**
  - Single source of truth — CLI attach và AWOG đọc cùng một file, không thể lệch.
  - Compact native của CLI trở thành đường tự nhiên (checkpoint AWOG không còn cần cho nhánh này).
  - Giảm ~50% disk ghi mỗi turn + bỏ một lớp fold.
  - Resume handle (`sdkSessionId`) không bao giờ rơi vì "checkpoint xoá".
- **Cons:**
  - Transcript Claude là **format nội bộ không ổn định** — đổi theo version CLI (đã từng thấy: `TodoWrite` biến mất → `TaskCreate`, `compact_boundary` schema mới). AWOG thành độc giả format người khác.
  - `cleanupPeriodDays` của Claude tự xoá session → index trỏ vào file đã mất; phải tắt hoặc chịu.
  - Read path phải replay adapter — chi phí load tăng so với đọc JSONL đã fold sẵn (đo được trên spike).
  - Map `eid` (AWOG message id) ↔ SDK `uuid` cho bookmark/anchor — cần migration + quy ước id ổn định.

### Option B — Giữ duplicate, chỉ khử phần dư thừa

- **Mô tả:** AWOG vẫn persist riêng nhưng ghi ít hơn (bỏ trường trùng, chỉ giữ annotation + diff so với Claude transcript).
- **Pros:** Không đụng read path; ít rủi ro format.
- **Cons:** Vẫn hai nguồn sự thật; "chỉ ghi diff" phức tạp hơn cả Option A (phải diff từng message, reconcile khi lệch). Không giải quyết được vấn đề compact native.

### Option C — Đổi chiều: AWOG store là source, Claude chỉ là runtime

- **Mô tả:** Giữ nguyên hiện trạng; coi file Claude là phế phẩm của runtime.
- **Pros:** Không đổi gì.
- **Cons:** Duplicate vĩnh viễn; CLI attach thấy transcript khác AWOG khi lệch; compact native vẫn khó.

## Quyết định

**Chọn: Option A** — với điều kiện **spike reader phải chứng minh replay được trước**.

Lý do: duplicate không mang lại an toàn nào mà chỉ tạo hai chỗ để hỏng. Adapter `event-adapter.ts` vốn đã là chỗ duy nhất biết cách fold SDK events thành `SessionMessage` — replay nó trên transcript persist về lý thuyết cho ra đúng thứ đang ghi, miễn là mapping `uuid → eid` deterministic. Chi phí là AWOG tự gánh rủi ro format Claude đổi, nhưng rủi ro đó **đã tồn tại** (adapter vẫn phải đọc SDK events mỗi turn); chỉ dời từ "đọc lúc stream" sang "đọc lúc load".

## Hệ quả

### Positive

- Một file, một nguồn sự thật cho nhánh anthropic; CLI attach / compact native / fork native đều "ăn ngay".
- Sidecar persist queue cho phiên anthropic co lại chỉ còn index write — ít I/O.
- Index file trở thành nơi duy nhất cho AWOG-only state → mô hình "metadata AWOG + transcript runtime" rõ hơn cho cả 3 runtime về sau.

### Negative / cost

- **Format drift**: mỗi lần bump `@anthropic-ai/claude-agent-sdk` phải re-verify replay; cần test fixture transcript mẫu.
- **`cleanupPeriodDays`**: AWOG phải set `cleanupPeriodDays: 0` (hoặc cảnh báo user không dọn) cho session AWOG-own, hoặc chấp nhận transcript biến mất còn index còn.
- **Fork**: AWOG-fork hiện tạo AWOG-session mới; nếu dùng Claude fork native thì cây fork đọc từ CLI (source:'fork'), mapping phải viết lại.
- **Hai đường persist vĩnh viễn**: anthropic = index+pointer, Pi/Codex = full AWOG store → `sessions/store.ts` tách 2 nhánh đọc.
- **Spike gate**: nếu replay không cho ra transcript tương đương (steps/parts đủ cho UI render), ADR này dừng ở Proposed và quay lại Option B/C.

### Knock-on

- `sidecar/src/sessions/store.ts` — tách `loadAnthropicSession` (index + replay) khỏi `loadSession` cũ.
- `sidecar/src/sessions/claude-transcript.ts` — module mới (leaf): `parseClaudeTranscript` + fold helpers tách từ `cli-import.ts`, phục vụ cả importer lẫn replay. `sessions/sdk-transcript.ts` phải là leaf (treo trên đường hydration sync của store) — KHÔNG được đi qua event-adapter/cli-import vì sẽ kéo cli-registry/bridged vào đồ thị sessions và làm hỏng thứ tự init ESM (đã xảy ra: bridged khởi tạo giữa vòng → `TEAM_TOOL_NAMES` undefined). Vì lý do đó, mảng tên tool của hai server nằm trong sessions graph (`awogsessions`, `awogteam`) đã dời sang `runtime/tools/tool-names.ts` (leaf), các file tools re-export lại.
- `methods/sessions.compact.ts` — nhánh anthropic đổi sang native compact (ADR tiếp theo), `isCliAttached` gate nới (compact native không xoá sdkSessionId).
- `stores/sessions.ts` (UI) — không đổi interface; chỉ nguồn data thay đổi.
- Migration: session cũ giữ nguyên file AWOG (đọc được như trước); session mới ghi index-only. Cần flag/migration pass khi mở session cũ lần đầu.
- Spec liên quan: `docs/features/session-cli-mode.md` (CLI attach giờ đọc cùng file), ADR 0093 (attach socket không đổi).

## Implementation pointers

- **Spike (bước bắt buộc trước khi động write path):**
  1. Script `sidecar` đọc một `*.jsonl` Claude thật → chạy `foldSdkEvents` → in `SessionMessage[]`.
  2. So sánh với `session.jsonl` AWOG tương ứng: số message, số step mỗi message, text user/assistant, tool names, usage cuối.
  3. Đo thời gian replay trên transcript ~1000 entries (ngưỡng chấp nhận < 300ms lần đầu; sau đó cache index).
  4. Report: phần nào KHÔNG derive được (bookmarks? todos? findings? step `detail` UI-only?) → quyết phần đó nằm trong index.
- **Module dự kiến chạm:** `sessions/store.ts` (+`sdk-transcript.ts` mới), `event-adapter.ts` (replay entry), `sessions.get.ts`, `session-manager.ts` (persist queue), `methods/sessions.compact.ts`.
- **Test:** fixture 3 transcript Claude thật (turn thường / compact_boundary / task subagents) → snapshot SessionMessage; unit test mapping `uuid → eid`.
- **Rollout:** spike → index+pointer cho session MỚI (dual-read) → migrate session cũ lazy (lần mở đầu tiên) → xoá write path AWOG cho anthropic khi chạy ổn định 1 sprint.

## Reversibility

- **Reversible ở mức độ vừa.** File Claude vẫn tồn tại nguyên vẹn → quay lại Option C bằng cách re-fold replay vào `session.jsonl` AWOG (một script), không mất transcript. Mất đi khi rollback: thời gian viết lại + annotation state nằm ở index phải merge ngược.
- Spike chưa đụng write path ⇒ giai đoạn spike hoàn toàn reversible (không đổi gì).
- Spike report: [claude-transcript-source-spike.md](../features/claude-transcript-source-spike.md) — đã chạy trên `@anthropic-ai/claude-agent-sdk@0.3.296` (bump từ 0.3.280), transcript 6,713 dòng thật. Kết luận: **khả thi**, cần vá replay-mode cho text + thinking (adapter hiện chỉ lấy từ `stream_event`).
- SDK bump: `0.3.280 → 0.3.296` (cùng PR với ADR này — `apps/desktop/sidecar/package.json` + `pnpm-lock.yaml`)

## Liên kết

- [ADR 0058 — Claude Agent SDK vs Pi runtime](0058-claude-agent-sdk-vs-pi-runtime-revisit.md)
- [ADR 0093 — AWOG CLI attach](0093-awog-cli-attach.md)
- [ADR 0047 — Session compaction](0047-session-compaction.md)
- [docs/features/session-cli-mode.md](../features/session-cli-mode.md)
- Spike report: `docs/features/claude-transcript-source-spike.md`
