# 0062 — Session storage áp dụng mô hình lưu + nạp của Craft (header + messages, warm cache)

- **Trạng thái:** Accepted
- **Ngày:** 2026-07-10
- **Người quyết định:** User (chủ dự án) + Tech Lead
- **Liên quan:** **Amend** [ADR 0048](./0048-session-index-lazy-load.md) (thay `index.json` bằng header per-file + warm cache); **chạm** [ADR 0047](./0047-auto-compact-context.md) (di dời checkpoint compaction, KHÔNG đổi cách compact); dùng [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) (JSONL là source of truth), [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (dual runtime), [ADR 0032 (parts model)](./0032-session-message-parts-model.md). Cùng đợt "bám craft làm chuẩn" với [ADR 0060](./0060-connections-adopt-craft-sources-model.md), [ADR 0061](./0061-session-craft-parity-render-model.md). Đảo hướng của ghi chú `session-jsonl-byte-minimal-persist` (append-per-step) — xem mục Hệ quả.

## Bối cảnh

Mở / chuyển giữa các session trong AWOG **kém mượt hơn** Craft rõ rệt. Truy về code, có 3 nguyên nhân gốc, đều nằm ở tầng lưu + nạp (KHÔNG phải tầng render của ADR 0061):

1. **Sidecar không giữ warm cache của session đã fold.** `sessions.get` → `loadSession` → `foldFile` **fold lại toàn bộ JSONL từ đĩa MỖI lần mở** ([store.ts:239](../../apps/desktop/sidecar/src/sessions/store.ts), [sessions.get.ts](../../apps/desktop/sidecar/src/methods/sessions.get.ts)). Đóng rồi mở lại cùng session = fold lại từ đầu.

2. **JSONL là event log, fold siêu tuyến tính.** Mỗi dòng là một `SessionEvent`; `foldFile` replay từng event qua reducer `applyEvent` — mỗi event làm `findIndex` + dựng lại immutable bằng `.map()` toàn mảng messages ([store.ts:132–216](../../apps/desktop/sidecar/src/sessions/store.ts)). Tệ hơn: nó replay **mọi `message.progress` delta** mà một `message.appended` cùng id **về sau ghi đè trọn vẹn** — công replay của toàn bộ chuỗi delta bị vứt bỏ ở cuối. Một lượt ~491 step nghĩa là hàng trăm lần rebuild-cả-mảng cho một message rốt cuộc chỉ giữ snapshot cuối.

3. **Event log nhiều dòng hơn số message rất nhiều** (mỗi delta streaming là một dòng) + chi phí `readline` stream từng dòng.

**Craft** ([craft-agents-oss](https://github.com/lukilabs/craft-agents-oss) `v0.11.0`, clone tại `/Users/kyro/KyroTech/Projects/craft-agents-oss`) làm ngược:

- `session.jsonl` **dòng 1 = `SessionHeader`** giàu, tính sẵn: `messageCount`, `preview`, `lastMessageRole`, `lastFinalMessageId`, `tokenUsage` ([jsonl.ts `createSessionHeader`](file:///Users/kyro/KyroTech/Projects/craft-agents-oss/packages/shared/src/sessions/jsonl.ts)). **Dòng 2+ = message đầy đủ**, mỗi dòng một message (không phải event).
- List chỉ đọc **8KB đầu** (`readSessionHeader` bằng `openSync`/`readSync` — header **chính là index**, không cần file index tách rời).
- Runtime `SessionManager` giữ `Map<id, ManagedSession>`: nạp **header** lúc boot (`loadSessionsFromDisk`), **lazy-load messages đúng một lần** khi mở (`ensureMessagesLoaded` + dedupe promise), rồi **giữ warm** (`messagesLoaded=true`) → mở lại là O(1) trong RAM ([SessionManager.ts](file:///Users/kyro/KyroTech/Projects/craft-agents-oss/packages/server-core/src/sessions/SessionManager.ts)).

ADR 0048 đã tách metadata-list khỏi transcript bằng `index.json` derived cache + `sessions.get` fold-1-file. Nó giải quyết được chi phí startup (~930 MB → vài chục KB) nhưng **không** chạm 3 nguyên nhân trên: mỗi lần mở vẫn fold lại nguyên event-log, và không có warm cache.

## Quyết định

Port mô hình **STORAGE + LOAD + LIST** của Craft 1-1 vào sidecar. **Ngoại lệ có chủ đích: compaction** (xem D-7).

### D-1 — Format đĩa mới: header + messages (bỏ event log)

`~/.awog/sessions/<id>.jsonl`: **dòng 1 = `SessionHeader`**, **dòng 2+ = `SessionMessage` đầy đủ** (mỗi dòng một message). **Bỏ** lược đồ `SessionEvent` (`session.created` / `message.appended` / `message.progress` / `session.truncated` / `session.compacted` / …). Header tính sẵn các field list cần: `messageCount`, `preview`, `lastMessageRole`, `lastFinalMessageId`, `tokenUsage`, cùng metadata session (title/projectId/settings/pinned/…). `SessionSummary` của ADR 0048 dẫn xuất từ header này.

### D-2 — `SessionPersistenceQueue` (mirror craft)

Hàng đợi ghi per-session: **debounce 500ms**, coalesce các save dồn dập, **serialize** ghi theo từng session (tránh đua trên `.tmp`), **atomic write** (ghi `.tmp` → `unlink` file cũ → `rename`), và **header-signature merge** để không đè metadata bị đổi từ ngoài (watcher / instance khác). `saveSession` = `enqueue` + `flush` ngay (ghi tức thì cho `create`/`delete`); `flushAll` khi quit. Mirror [persistence-queue.ts](file:///Users/kyro/KyroTech/Projects/craft-agents-oss/packages/shared/src/sessions/persistence-queue.ts).

### D-3 — Warm cache trong sidecar (`SessionManager`)

`Map<id, ManagedSession>`:

- **Boot:** nạp **header only** cho mọi session (không nạp messages) → list sẵn sàng ngay, RAM thấp.
- **Mở session:** `ensureMessagesLoaded` — nếu `messagesLoaded=false` thì đọc + parse messages một lần (dedupe promise cho các lần gọi đồng thời khi switch nhanh), set `messagesLoaded=true`.
- **Mở lại:** phục vụ thẳng từ Map — **O(1)**, không chạm đĩa.
- **Cold-persist guard:** trước khi enqueue một session **chưa** load messages (`persistSession` khi `messagesLoaded=false`), **hydrate messages từ đĩa trước** (`hydrateMessagesForColdPersist`) → không bao giờ ghi `messages: []` đè lên transcript thật trên đĩa.

### D-4 — List = header only / warm Map; bỏ `index.json`

`sessions.list` đọc **header (8KB fd read)** mỗi file, hoặc phục vụ từ warm Map. **Bỏ** `~/.awog/sessions/index.json` + `touchIndex`/`rebuildIndex` của ADR 0048 — header per-file thay thế index derived cache (không còn một file cache tập trung để lệch/rebuild). **Contract RPC giữ nguyên** (ADR 0048): `sessions.list` → `SessionSummary[]`, `sessions.get(id)` → full `Session`, `sessions.search` → fold on-demand. UI-side của ADR 0048 (`ensureSessionMessages`, cờ `messagesLoaded`, badge count) **không phải đổi**.

### D-5 — Portable path token `{{SESSION_PATH}}`

Serialize mỗi dòng qua `makeSessionPathPortable` / expand khi đọc — đường dẫn tuyệt đối nhúng trong content (planPath, attachment, file link…) thành token portable, cross-machine an toàn (mirror craft [jsonl.ts](file:///Users/kyro/KyroTech/Projects/craft-agents-oss/packages/shared/src/sessions/jsonl.ts)).

### D-6 — Migration một lần (có backup)

Nhận diện file event-log cũ (**dòng đầu có field `type`** — dấu hiệu `SessionEvent`; format mới dòng đầu là header, không có `type`) → **fold một lần** bằng `foldFile` hiện có → ghi lại dạng `header + messages`. **Sao lưu bản gốc trước khi ghi đè** (`.jsonl.bak` hoặc thư mục backup) để lỗi migration không mất transcript. Idempotent, chạy lúc boot; file đã ở format mới bỏ qua.

### D-7 — NGOẠI LỆ: compaction KHÔNG port 1-1

Craft ủy thác compaction cho **session tree của runtime** (Pi `SessionTreeEntry` / store của Claude SDK). AWOG **cố ý** rebuild context model từ JSONL mỗi lượt và giữ compaction **provider-agnostic** (ADR 0029, ADR 0047) — không dùng session tree. Vì vậy:

- **GIỮ** cơ chế compaction hiện tại của AWOG: re-summarise prefix thô từ JSONL, cắt context ở `buildContext` từ `firstKeptMessageId`, inject summary vào system prompt (ADR 0047). **Logic cut của `buildContext` không đổi.**
- **Chỉ di dời** checkpoint `SessionCompaction { summary, firstKeptMessageId, tokensBefore, at }` vào **`SessionHeader`** (Craft cũng lưu `pendingPlanExecution` / `branchFrom*` trong header của nó). Trước đây checkpoint đến qua event `session.compacted`; nay là một field trên header, ghi qua persistence queue như mọi metadata khác. Defence cũ giữ nguyên: chỉ nhận checkpoint có `firstKeptMessageId` còn tồn tại trong transcript.

Tương tự, các thao tác trước đây là event (`truncate`, `metadata.update`) nay là **mutate messages/header in-memory rồi persist** — cùng invariant (truncate slice tới `keepThroughId`; drop `sdkSessionId` khi truncate/compact theo ADR 0058).

## Hệ quả

### Tích cực

- **Mở / switch gần tức thì** khi session đã warm (O(1) từ Map); lần mở đầu là **parse tuyến tính** header+messages thay vì replay event siêu tuyến tính.
- **Không còn công thừa**: không replay chuỗi `message.progress` bị `message.appended` ghi đè.
- **List đơn giản hơn**: header per-file thay index tập trung — bớt một nguồn lệch/rebuild (bỏ `index.json`).

### Đánh đổi

- **Ghi lại toàn file mỗi lần save** thay cho append O(1). Đây là điểm **đảo hướng** so với ghi chú `session-jsonl-byte-minimal-persist` (từng chuyển sang append-per-step để tránh O(n²) → file 1.2 GB → vỡ `readFile`). Vì sao lần này an toàn: **debounce 500ms + coalesce** nghĩa là **không** ghi lại mỗi step — nhiều step dồn vào một lần ghi. **Kích thước đỉnh của file = kích thước transcript cuối** (mỗi message xuất hiện đúng một lần), KHÔNG phải tăng trưởng O(n²) của thời "re-persist full snapshot mỗi step". Bloat cũ đến từ *ghi lại toàn bộ snapshot **mỗi step*** chứ không phải từ *ghi lại toàn bộ file*; debounce khử đúng nguyên nhân đó.
- **Crash mid-turn**: append-per-event trước đây giữ được partial reply tới delta cuối cùng ghi ra đĩa. Full-file-rewrite + debounce có thể mất phần in-flight giữa 2 lần flush. **Bù lại bằng periodic flush trong lượt dài** (flush định kỳ theo thời gian / mốc message trong khi đang stream) → snapshot header+messages gồm cả assistant message đang chạy, giữ được đảm bảo "crash vẫn còn reply cắt ngắn" ở mức hạt thô hơn. `parseMessagesResilient` (bỏ qua dòng JSON hỏng do crash giữa write) là lưới an toàn thứ hai.
- **Rủi ro migration**: fold-once + rewrite là thao tác phá hủy → **backup bản gốc là bắt buộc** (D-6). Session cũ (legacy event-log partial→final cùng id) fold ra `messages` đúng nên header `messageCount` chính xác ngay lần đầu.
- **Bảo toàn invariant**: không phá `step.textOffset ↔ message.text` (ADR 0032 — messages giữ nguyên shape, chỉ đổi cách gói dòng); credential không rời sidecar (không đụng auth); loader vẫn stream/parse chịu-lỗi cho file lớn.

## Phương án đã cân nhắc

- **A — Port storage+load+list của Craft (CHỌN):** đánh trúng cả 3 nguyên nhân gốc; warm cache + parse tuyến tính; bỏ được index tách rời. Cons: migration + đổi format đĩa, đảo append-per-step. Ngoại lệ compaction giữ AWOG-native.
- **B — Chỉ thêm warm cache LRU, giữ event log:** rẻ, không migration. Nhưng lần mở nguội (session chưa cache) vẫn fold siêu tuyến tính + replay progress thừa — không đạt cảm nhận Craft, chỉ giấu vấn đề sau cache. Bác.
- **C — Giữ event log nhưng bỏ replay progress khi có appended cùng id:** giảm công thừa (nguyên nhân 2) nhưng vẫn readline nhiều dòng + không warm cache + vẫn cần `index.json`. Nửa vời. Bác.
- **D — Port trọn Craft kể cả compaction (session tree):** mâu thuẫn rebuild-from-JSONL + provider-agnostic của ADR 0029/0047; regress compaction hiện có. Bác (D-7).

## Cần kiểm chứng trên app thật

Sidecar đổi lớn → **rebuild `dist` + restart app** trước khi test (ghi chú `sidecar-rebuild-restart-in-dev`). Checklist:

- Mở / switch một session **nặng** nhiều lần → mở lại phải tức thì (warm), không giật.
- Một lượt **~491 step** → không regress bloat: file cuối ≈ kích thước transcript, không phình; theo dõi số lần ghi (debounce coalesce).
- **Crash giữa lượt** → mở lại còn reply cắt ngắn (periodic flush) + list không mất session.
- **Resume** (fold JSONL khi UI gửi history rỗng — ghi chú `session-resume-history-contract`) vẫn đúng với format mới.
- **Truncate / regenerate / fork** → messages slice đúng, `sdkSessionId` drop theo ADR 0058.
- **`/compact`** (D-7): checkpoint vào header, `buildContext` cắt context không đổi, marker hiển thị đúng, restart-safe.
- **Migration**: chạy trên thư mục có cả file event-log cũ lẫn file mới → fold đúng, backup bản gốc, idempotent lần boot sau.

## Phụ lục — Optional phase (folder-per-session + externalized attachments + slug ids) — đã triển khai

Ba cải tiến bổ sung, xây TRÊN storage core đã land (không rebuild):

1. **Folder-per-session.** Layout đĩa đổi từ `~/.awog/sessions/{id}.jsonl` (phẳng) sang thư mục riêng mỗi session: `~/.awog/sessions/{id}/session.jsonl` + thư mục anh em `~/.awog/sessions/{id}/attachments/`. `jsonl.ts` thêm `sessionDir(id)` / `attachmentsDir(id)`, `sessionFilePath(id)` trỏ vào `{id}/session.jsonl`. `session-manager.loadAllFromDisk` quét ENTRY **thư mục** (đọc header `{dir}/session.jsonl`); `deleteSession` `rm -rf` cả thư mục `{id}/`.

2. **Externalize image/PDF attachments (chỉ ở ranh giới persistence).** Ảnh/PDF vẫn nằm inline dạng base64 `data:` URL trên `SessionAttachment.url` khi ở RAM; khi GHI JSONL, tầng `jsonl.ts` giải mã base64 ra file `{attachmentsDir}/{att.id}`, đặt `SessionAttachment.storedFile = att.id` và BỎ `url` khỏi dòng JSON (làm trên bản COPY — object session sống trong RAM giữ nguyên `url`). Khi ĐỌC, `jsonl.ts` đọc lại file, base64-encode, khôi phục `url`. Do đó `runtime/context-builder.ts` và UI render **không đổi** — luôn thấy `url` đầy đủ, không hề biết `storedFile`. Đã externalize một lần thì lần save sau chỉ bỏ `url` (không giải mã/ghi lại). File thiếu khi đọc → log warn, để `url` undefined (không phá transcript).

3. **Slug session id (UI, deterministic).** `engineIdFor(clientId)` ở `stores/sessions.ts` đổi từ `ses-<base36>` sang slug người-đọc-được `YYMMDD-adjective-noun-<tail>` (util `ui-next/utils/session-slug.ts`, ~48 adj × 48 noun + tail base36 3 ký tự). BẮT BUỘC deterministic + đồng bộ (fallback `if (!s.engineId) …` phụ thuộc). Session cũ giữ id `ses-…` — KHÔNG migrate id; chỉ session mới nhận slug. Không có chỗ nào parse prefix `ses-` (đã grep xác nhận).

**Migration folder** (`migrate-legacy.ts`, một lần lúc boot, idempotent + best-effort): quét `sessionsDir()` — entry thư mục → bỏ qua (đã đúng layout); file `{id}.jsonl` phẳng (event-log cũ HOẶC single-file header interim) → dựng `Session`, tạo `{id}/` + `{id}/attachments/`, ghi `{id}/session.jsonl` qua `writeSessionJsonl` (tự externalize attachment), **backup** file phẳng ra `{id}.jsonl.bak` TRƯỚC (không đè bak sẵn có) rồi unlink file phẳng SAU khi ghi folder. Tombstone `session.deleted` vẫn retire ra `.deleted.bak`; vẫn xoá `index.json` cũ. Crash giữa backup và ghi folder → còn file phẳng + .bak → re-migrate boot sau.
