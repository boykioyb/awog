# Feature: Git Conflict Resolution UI

**Trạng thái:** Draft
**Owner:** Business Analyst
**Ngày tạo:** 2026-07-09
**Tham chiếu Brief:** [git-manager.brief.md](./git-manager.brief.md) — mục "Resolve conflict"
**Tham chiếu Spec cha:** [git-manager.md](./git-manager.md) — mục [Conflict resolver UI v1](./git-manager.md#conflict-resolver-ui-v1), Flow 3, AC-32..AC-36
**ADR liên quan:** [0017-git-manager-ipc-contract.md](../decisions/0017-git-manager-ipc-contract.md), [0040-git-branch-ops-merge-rebase-pr.md](../decisions/0040-git-branch-ops-merge-rebase-pr.md)

## Mục lục

- [Bối cảnh & phạm vi](#bối-cảnh--phạm-vi)
- [Trạng thái hiện tại (gap analysis)](#trạng-thái-hiện-tại-gap-analysis)
- [Personas](#personas)
- [Hợp đồng dữ liệu đã có](#hợp-đồng-dữ-liệu-đã-có)
- [User flows](#user-flows)
- [UI behavior](#ui-behavior)
- [Acceptance Criteria](#acceptance-criteria)
- [Edge cases](#edge-cases)
- [i18n](#i18n)
- [Dependencies](#dependencies)
- [Out of scope](#out-of-scope)
- [Open questions cho Tech Lead / PO](#open-questions-cho-tech-lead--po)
- [Quyết định kỹ thuật (Tech Lead)](#quyết-định-kỹ-thuật-tech-lead)
- [Đầu vào cho QA](#đầu-vào-cho-qa)

## Bối cảnh & phạm vi

Backend sidecar và API bridge cho resolve conflict **đã hoàn chỉnh**. Đây là mắt xích UI còn thiếu: người dùng sau khi `merge`/`rebase`/`stash pop` tạo xung đột hiện **không có cách** giải quyết trong app — nút "Complete Merge"/"Continue Rebase" bị disable bởi `hasConflict` và không có UI để hạ cờ đó xuống.

Feature này **chỉ** phủ phần UI + store wiring cho:

1. Nhận diện & hiển thị file conflicted như một section riêng trong danh sách thay đổi.
2. Mở resolver 2-way (ours/theirs per block) — component mới `GitConflictResolver.vue`.
3. Store actions `loadConflictFile` + `resolveConflict` (+ `resolveConflictBinary`) gọi API đã có.
4. Chỉ dẫn trong banner header khi `hasConflict` (giải thích user cần làm gì).
5. Đường resolve cho file binary và file non-UTF-8 (fallback external editor).

Ràng buộc AWOG (local-first): toàn bộ flow chạy **offline** — không phụ thuộc mạng. Không chạm approval gate, không sinh trace event mới, không auto-commit (merge commit do user chủ động qua "Complete Merge" đã có).

## Trạng thái hiện tại (gap analysis)

Đã xác minh trong code (ui-next):

- **API bridge** đủ: [`useGitApi.ts`](../../apps/desktop/ui-next/composables/useGitApi.ts) dòng 414-431 — `readConflictFile`, `resolveFile`, `resolveFileBinary`, `merge`, `rebase`, `rebaseContinue`, `rebaseAbort`, `mergeAbort`, `completeMerge`. Type: `ReadConflictFileResult` (dòng 283), `ResolveFileParams` (289), `ResolveFileBinaryParams` (294), `SidecarMergeConflictBlock` (272), `SidecarGitFileStageState` gồm `'conflicted'` (18).
- **Sidecar** đủ: `git.readConflictFile` trả `{ path, isBinary, blocks }` hoặc throw `RpcError` với `gitCode: 'ENCODING_UNSUPPORTED'` cho non-UTF-8/UTF-16; mỗi block có `{ index, startLine, separatorLine, endLine, ours, theirs, oursLabel, theirsLabel }` ([git.read-conflict-file.ts](../../apps/desktop/sidecar/src/methods/git.read-conflict-file.ts)). `git.resolveFile` **re-read + re-parse** file (defense-in-depth), yêu cầu **đủ resolution cho MỌI block** (khác số block → `MERGE_CONFLICT`), ghi atomic-rename rồi `git add` ([git.resolve-file.ts](../../apps/desktop/sidecar/src/methods/git.resolve-file.ts)). `git.resolveFileBinary` chạy `git checkout --ours|--theirs` + `git add` ([git.resolve-file-binary.ts](../../apps/desktop/sidecar/src/methods/git.resolve-file-binary.ts)).
- **Store** [`stores/git.ts`](../../apps/desktop/ui-next/stores/git.ts): có `isMerging`, `isRebasing`, `hasConflict` (216-218; set ở 401-406 từ `status.conflictedCount > 0 || files.some(stageState==='conflicted')`); actions `merge`, `rebase`, `completeMerge`, `abortMerge` (1101-1150). **THIẾU** `loadConflictFile` / `resolveConflict`; **chưa gọi** `readConflictFile`/`resolveFile` ở bất kỳ đâu.
- **GAP nghiêm trọng — phân loại file:** `adaptFile` (dòng 59-61) chỉ map `changeType → st`; `loadStatus` (395-398) chỉ tách **staged vs non-staged** → **file conflicted rơi vào bucket `unstaged` với `st: 'U'`**. Không có `conflicted` ref riêng trong store.
- **UI list** [`GitChangesList.vue`](../../apps/desktop/ui-next/components/git/GitChangesList.vue): chỉ render section Staged + Changes (+ Untracked). **Không** có section Conflicted (grep "conflict" rỗng ở components/git).
- **Header banner** [`GitPageHeader.vue`](../../apps/desktop/ui-next/components/git/GitPageHeader.vue) dòng 55-64: khi `isMerging || isRebasing` hiện nút Complete/Continue (disable khi `hasConflict`) + Abort. **Không** có dòng chỉ dẫn khi `hasConflict`.

**Kết luận gap:** cần (a) thêm ref `conflicted` + phân loại trong store, (b) render section Conflicted, (c) component resolver, (d) 2 store actions, (e) chỉ dẫn banner, (f) i18n.

## Personas

- **Solo Builder** (persona MVP) — merge/rebase branch của mình hoặc pull về, gặp conflict, muốn xử lý ngay trong AWOG thay vì nhảy ra CLI. Quen Git nhưng muốn 2-way pick nhanh cho phần lớn conflict đơn giản.
- **Tech Lead** (tương lai) — review kết quả merge do agent/nhánh khác tạo. Nhu cầu: nhìn rõ ours vs theirs, nhãn side (`HEAD` vs `origin/main`) chính xác.

Không target: người dùng cần **3-way merge / edit tay inline phức tạp** (xem [Out of scope](#out-of-scope) + Open question OQ-1).

## Hợp đồng dữ liệu đã có

Không định nghĩa type mới. Dùng nguyên các type từ [`useGitApi.ts`](../../apps/desktop/ui-next/composables/useGitApi.ts):

```ts
// dòng 272
interface SidecarMergeConflictBlock {
  index: number
  startLine: number
  separatorLine: number
  endLine: number
  ours: string[]
  theirs: string[]
  oursLabel: string    // vd "HEAD"
  theirsLabel: string  // vd "origin/main"
}
// dòng 283
interface ReadConflictFileResult { path: string; isBinary: boolean; blocks: SidecarMergeConflictBlock[] }
// dòng 289
interface ResolveFileParams { path: string; resolutions: Array<{ blockIndex: number; choice: 'ours' | 'theirs' }> }
// dòng 294
interface ResolveFileBinaryParams { path: string; choice: 'ours' | 'theirs' }
```

**State UI cục bộ của resolver** (không cần lên store — sống trong component/composable): map `blockIndex → 'ours' | 'theirs' | undefined` cho lựa chọn đang chờ.

## User flows

Cú pháp: `[Actor]` → hành động; `[System]` → phản hồi (qua IPC `git.*`).

### Flow 1 — Merge tạo conflict → resolve từng block → complete (golden path)

```
Given user đang ở branch `feature/x`, workspace clean, chọn merge branch `origin/main`.
When  [User] tab Branches → chọn `origin/main` → "Merge into current".
      [Store] git.merge(root, 'origin/main').
Then  [Sidecar] merge fail vì conflict → RpcError gitCode = 'MERGE_CONFLICT'.
      [Store] reportError('merge', ...) + loadStatus() → status.conflictedCount > 0 →
              isMerging=true, hasConflict=true; file conflicted vào section Conflicted.
      [UI] Header banner hiện: "N file xung đột — chọn ours/theirs cho từng file rồi Complete Merge."
           Nút "Complete Merge" DISABLED (hasConflict=true).

When  [User] click 1 file trong section Conflicted.
      [Store] loadConflictFile(path) → git.readConflictFile(root, path) → { isBinary:false, blocks }.
Then  [UI] Right pane render GitConflictResolver: N block, mỗi block 2 pane OURS(label)/THEIRS(label),
           chưa block nào chọn → nút "Mark resolved" disabled.

When  [User] chọn ours/theirs cho MỌI block (hoặc "Take all ours" / "Take all theirs").
Then  [UI] "Mark resolved" enabled khi và chỉ khi mọi block đã chọn.

When  [User] click "Mark resolved".
      [Store] resolveConflict(path, resolutions) → git.resolveFile(root, { path, resolutions }).
Then  [Sidecar] re-read + re-parse (defense-in-depth), ghi file, git add; emit git:status:changed.
      [Store] loadStatus() → file rời Conflicted sang Staged; hasConflict cập nhật.
      [UI] resolver đóng (right pane về diff/empty). Nếu KHÔNG còn file conflicted:
           banner đổi thành "Hết xung đột — sẵn sàng Complete Merge"; nút Complete Merge ENABLED.

When  [User] click "Complete Merge".
      [Store] completeMerge(root) → git.completeMerge → git commit --no-edit.
Then  [Store] loadAll(); isMerging=false, hasConflict=false. Workspace clean.
```

### Flow 2 — Rebase conflict → Continue Rebase (thay vì Complete)

```
Given [User] rebase feature/x lên main → git.rebase(root, 'main').
When  [Sidecar] dừng ở conflict → RpcError gitCode = 'MERGE_CONFLICT'.
Then  [Store] loadStatus() → isRebasing=true, hasConflict=true.
      [UI] Banner + nút hiển thị biến thể REBASE: "Continue Rebase" thay "Complete Merge",
           "Abort Rebase" thay "Abort Merge" (GitPageHeader đã có switch isRebasing).
      Chỉ dẫn: "N file xung đột trong lần rebase này — resolve rồi Continue Rebase.
                Rebase có thể dừng lại ở commit tiếp theo (lặp lại)."
When  [User] resolve hết file (như Flow 1) → click "Continue Rebase".
      [Store] completeMerge() → (isRebasing → gọi rebaseContinue nội bộ, xem OQ-4).
Then  Case rebase còn commit conflict tiếp theo: sidecar trả conflict lần nữa →
      hasConflict=true lại, resolver lặp cho batch file mới.
      Case rebase xong: isRebasing=false, hasConflict=false.
```

> **Lưu ý wiring:** hiện `completeMerge()` store luôn gọi `git.completeMerge`; khi `isRebasing` phải gọi `git.rebaseContinue`. Xem OQ-4.

### Flow 3 — Abort giữa chừng

```
Given đang merge/rebase, hasConflict=true, có thể đang mở resolver.
When  [User] click "Abort Merge" / "Abort Rebase".
Then  [UI] confirm dialog "Bỏ toàn bộ merge/rebase và quay lại trạng thái trước? Lựa chọn đang
           chọn trong resolver sẽ mất."
      [User] confirm → [Store] abortMerge() → isRebasing ? git.rebaseAbort : git.mergeAbort.
      [Store] loadAll(); isMerging/isRebasing/hasConflict=false.
      [UI] Nếu resolver đang mở → đóng ngay, right pane về empty/diff. Lựa chọn UI cục bộ vứt bỏ.
```

### Flow 4 — File binary conflict

```
Given file conflicted là binary (vd .png).
When  [User] click file → loadConflictFile → git.readConflictFile → { isBinary: true, blocks: [] }.
Then  [UI] resolver render chế độ binary: KHÔNG hiện block, thay bằng thông báo
           "File nhị phân — không thể merge theo dòng. Chọn nguyên một phía:"
           + 2 nút file-level "Take ours (binary)" / "Take theirs (binary)".
When  [User] click "Take theirs (binary)".
      [Store] resolveConflictBinary(path, 'theirs') → git.resolveFileBinary(root, { path, choice }).
Then  [Sidecar] git checkout --theirs + git add; file rời Conflicted sang Staged. Resolver đóng.
```

### Flow 5 — File non-UTF-8 (ENCODING_UNSUPPORTED)

```
Given file conflicted mã hóa UTF-16 / non-UTF-8.
When  [User] click file → loadConflictFile → git.readConflictFile throw RpcError
      gitCode = 'ENCODING_UNSUPPORTED'.
Then  [Store] bắt lỗi, KHÔNG set currentConflictFile; đặt trạng thái lỗi resolver.
      [UI] resolver render chế độ fallback:
           "Encoding không hỗ trợ — không thể resolve trong app.
            Mở file bằng editor ngoài để resolve thủ công, sau đó quay lại và click 'Đánh dấu đã
            resolve' (stage) hoặc chạy `git add` ở CLI."
           Nút "Mở trong editor ngoài" (deeplink — xem OQ-2) + nút "Đánh dấu đã resolve (stage)"
           gọi thẳng stageFile(path) (KHÔNG dùng resolveFile vì không parse được).
```

### Flow 6 — File có nhiều block

```
Given file conflicted có ≥ 2 block.
When  [User] mở resolver.
Then  [UI] mỗi block render riêng, tiêu đề "Block i/N — dòng {startLine}", 2 pane ours/theirs
           kèm label side. Block đã chọn viền accent; chưa chọn viền border thường.
      "Take all ours"/"Take all theirs" set MỌI block cùng lúc.
      "Mark resolved" chỉ enabled khi TẤT CẢ block đã chọn (khớp ràng buộc sidecar: thiếu block → lỗi).
```

## UI behavior

### Vị trí resolver

- Resolver **thay thế right pane** khi file conflicted được chọn (giống cách `GitDiffViewer` chiếm right pane khi chọn file thường) — **không** dùng modal. Lý do: conflict thường nhiều dòng, cần không gian; nhất quán với pattern "click file → xem chi tiết bên phải".
- Right pane state = discriminated union: `{ kind: 'diff' } | { kind: 'conflict', path } | { kind: 'empty' }`. Chọn file conflicted → `kind: 'conflict'`.

### Section Conflicted trong danh sách

- Store thêm ref `conflicted: GitFile[]`; `loadStatus` phân loại: `stageState === 'conflicted'` → `conflicted`, `'staged'` → `staged`, còn lại → `unstaged`. (Sửa gap ở [gap analysis](#trạng-thái-hiện-tại-gap-analysis).)
- `GitChangesList.vue` render section "Conflicted" (icon cảnh báo, màu `t.warning`/`--del` token) **trên cùng** khi `conflicted.length > 0`, trước Staged. Mỗi item badge `U`, click → mở resolver.
- Section Conflicted **KHÔNG** có checkbox stage per-file thông thường và **KHÔNG** có Discard all (discard file conflicted nguy hiểm — dùng Abort thay thế). Đây là khác biệt so với section non-staged khác.

### Hiển thị block ours/theirs

- Mỗi block: 2 pane cạnh nhau (OURS trái / THEIRS phải), header pane hiện label từ sidecar (`oursLabel`, `theirsLabel` — vd `HEAD`, `origin/main`). Nếu label rỗng → fallback i18n "Ours"/"Theirs".
- Nội dung pane render **read-only** dạng danh sách dòng (`ours: string[]`, `theirs: string[]`). Ưu tiên tái dùng renderer diff đã có của ui-next (theo `DiffLine`/`DiffRow` trong [git-types.ts](../../apps/desktop/ui-next/components/git/git-types.ts)); Monaco diff-editor là tùy chọn nếu TL thấy cần — xem OQ-3.
- **Không hardcode hex.** Mọi màu qua `useTheme()`: viền block chưa chọn `t.border`, đã chọn `t.accent`; nền pane `t.bgPanel`/`t.bgInput`; text `t.text`/`t.textDim`; nút được chọn dùng `t.accent`+`t.accentText`. Nếu ui-next dùng CSS var (`--add`/`--del`/`--mod`) theo convention prototype.css → theo var đó, không hex literal.

### Trạng thái "đã resolve" vs "chưa"

- Per-block: chưa chọn (viền `t.border`, cả 2 nút "Take ours"/"Take theirs" ở trạng thái outline) → đã chọn (viền `t.accent`, nút được chọn fill accent, nút kia mờ).
- Header file: chip đếm "{đã chọn}/{tổng} block".

### Các nút

- **Per block:** "Take ours" / "Take theirs" (mutually exclusive, toggle được để đổi ý).
- **Header file:** "Take all ours" / "Take all theirs" (set toàn bộ block); "Mark resolved" (disabled cho đến khi mọi block đã chọn).
- **Binary:** chỉ "Take ours (binary)" / "Take theirs (binary)" (click = resolve luôn, không có bước Mark resolved riêng).
- **Non-UTF-8:** "Mở trong editor ngoài" + "Đánh dấu đã resolve (stage)".

### Banner chỉ dẫn (header)

- Khi `hasConflict === true`: thêm dòng chỉ dẫn cạnh nút Complete/Continue (đang bị disable): "{N} file xung đột — chọn cách giải quyết từng file rồi {Complete Merge | Continue Rebase}." Text theo biến thể `isRebasing`.
- Khi `isMerging/isRebasing` nhưng `hasConflict === false`: "Hết xung đột — sẵn sàng {Complete Merge | Continue Rebase}." Nút enabled.

### Convention (theo [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md))

- `<script setup lang="ts">`, `defineProps`/`defineEmits` type-only, event `kebab-case`.
- SFC resolver > ~250 dòng → tách state/handler vào composable `useConflictResolver()` trong `composables/`.
- Component `PascalCase.vue`: `GitConflictResolver.vue` (+ có thể `GitConflictBlock.vue` con).
- Body text `text-[1em]`; badge/count chip `text-[12px]` fixed mono.
- Store: state readonly + action; action async đặt tên rõ (`loadConflictFile`, `resolveConflict`, `resolveConflictBinary`).

## Acceptance Criteria

> Đánh số `CR-NN` (Conflict Resolution). Mỗi AC Given/When/Then, verify được qua UI + IPC log.

**CR-01: Section Conflicted xuất hiện**
- **Given** merge/rebase tạo ≥ 1 file conflicted (`status.conflictedCount > 0`).
- **When** `loadStatus` chạy.
- **Then** section "Conflicted (N)" render trên cùng danh sách, mỗi file badge `U`; file conflicted **không** còn nằm lẫn trong Changes/Unstaged.

**CR-02: Mở resolver cho file text**
- **Given** section Conflicted có file text.
- **When** user click file.
- **Then** `loadConflictFile` gọi `git.readConflictFile`; right pane switch sang `GitConflictResolver` render đúng số block; label ours/theirs khớp `oursLabel`/`theirsLabel` từ sidecar.

**CR-03: Chọn ours/theirs per block, mutually exclusive**
- **Given** resolver mở với ≥ 1 block.
- **When** user click "Take ours" ở block i rồi click "Take theirs" cùng block.
- **Then** lựa chọn cuối (theirs) thắng; chỉ 1 nút active; viền block = `t.accent`.

**CR-04: Mark resolved chỉ enabled khi đủ block**
- **Given** file 3 block, user chọn 2/3.
- **When** trạng thái nút.
- **Then** "Mark resolved" disabled + chip "2/3". Chọn nốt block 3 → enabled + chip "3/3".

**CR-05: Take all ours / theirs**
- **Given** file N block.
- **When** user click "Take all theirs".
- **Then** mọi block set 'theirs'; "Mark resolved" enabled.

**CR-06: Mark resolved → stage + rời Conflicted**
- **Given** mọi block đã chọn.
- **When** user click "Mark resolved".
- **Then** `git.resolveFile { path, resolutions }` gọi với **đủ resolution cho mọi blockIndex**; sau success `loadStatus` → file sang Staged; resolver đóng; nếu hết conflicted → nút Complete/Continue enabled.

**CR-07: Complete Merge sau khi hết conflict**
- **Given** không còn file conflicted, `isMerging=true`.
- **When** user click "Complete Merge".
- **Then** `git.completeMerge`; `isMerging=false`; workspace clean; toast/thông báo hoàn tất merge.

**CR-08: Continue Rebase (biến thể rebase)**
- **Given** `isRebasing=true`, hết conflicted.
- **When** user click "Continue Rebase".
- **Then** gọi `git.rebaseContinue` (KHÔNG `completeMerge`); nếu rebase còn commit conflict → hasConflict=true lại + resolver lặp; nếu xong → `isRebasing=false`.

**CR-09: Binary conflict**
- **Given** file conflicted `isBinary=true`.
- **When** user mở resolver.
- **Then** hiện 2 nút file-level, KHÔNG hiện block. Click "Take ours (binary)" → `git.resolveFileBinary { path, choice: 'ours' }`; file sang Staged.

**CR-10: Non-UTF-8**
- **Given** file conflicted mã hóa không hỗ trợ.
- **When** `git.readConflictFile` throw `gitCode: 'ENCODING_UNSUPPORTED'`.
- **Then** resolver hiện fallback (mở editor ngoài + đánh dấu stage), KHÔNG crash, KHÔNG hiện block giả.

**CR-11: Banner chỉ dẫn**
- **Given** `hasConflict=true`.
- **When** header render.
- **Then** hiện dòng chỉ dẫn với đúng số file + đúng biến thể merge/rebase; nút Complete/Continue disabled. Khi `hasConflict=false` (đang merge/rebase) → chỉ dẫn đổi "sẵn sàng" + nút enabled.

**CR-12: Abort đóng resolver**
- **Given** resolver đang mở, có lựa chọn cục bộ chưa Mark resolved.
- **When** user Abort (confirm).
- **Then** `git.mergeAbort`/`git.rebaseAbort`; resolver đóng; lựa chọn cục bộ vứt; cờ về false; workspace về trước op.

**CR-13: Defense-in-depth desync**
- **Given** file bị sửa ngoài app giữa lúc `readConflictFile` và `resolveFile` (số block thực khác resolutions gửi lên).
- **When** click "Mark resolved".
- **Then** sidecar trả `MERGE_CONFLICT` ("Cần X resolution — nhận Y" / "Block Z chưa resolve"); UI hiện lỗi có ý nghĩa (i18n `git.error.MERGE_CONFLICT`) + gợi ý reload file; KHÔNG stage sai.

**CR-14: Nhiều file conflicted cùng lúc**
- **Given** merge tạo 3 file conflicted.
- **When** user resolve lần lượt.
- **Then** mỗi lần Mark resolved chỉ file đó rời Conflicted; nút Complete Merge chỉ enabled khi cả 3 xong.

**CR-15: Offline**
- **Given** máy offline.
- **When** user resolve conflict + Complete Merge.
- **Then** toàn bộ flow thành công (đều là thao tác git local); không có lỗi mạng.

## Edge cases

| Edge case | Behavior mong đợi |
|---|---|
| Block rỗng một side (add/add, delete/modify) | `ours` hoặc `theirs` là mảng rỗng. Pane rỗng hiện placeholder i18n "(không có nội dung / phía này xóa)". "Take" phía rỗng = xóa nội dung block đó — vẫn hợp lệ, sidecar ghi mảng rỗng. |
| File vừa binary vừa conflict | `readConflictFile` trả `isBinary: true, blocks: []` → luôn đi nhánh binary (CR-09), không bao giờ hiện block. |
| Resolve xong nhưng completeMerge vẫn báo còn conflict | Sidecar defense-in-depth: `completeMerge` có thể fail nếu còn file conflicted chưa stage. UI hiện lỗi + `loadStatus` để đồng bộ lại section Conflicted (có thể còn file user quên). |
| Abort khi đang mở resolver | CR-12 — đóng resolver, vứt state cục bộ, không gọi resolveFile. |
| Nhiều file conflicted | CR-14 — section liệt kê tất cả; resolve độc lập từng file. |
| File conflicted bị agent/task sửa đồng thời | Sidecar dùng mutex per workspace + suppressEcho; `resolveFile` re-read nên không desync. Nếu số block đổi → CR-13. |
| `readConflictFile` không tìm thấy file (ENOENT — file đã bị resolve ngoài) | Sidecar trả lỗi; UI hiện "File không còn xung đột hoặc đã bị thay đổi", `loadStatus` để refresh. |
| File conflicted rỗng block (marker hỏng / stray `<<<<<<<`) | Parser sidecar bỏ qua block hỏng → `blocks: []`. UI hiện thông báo "Không phát hiện conflict block hợp lệ — resolve thủ công" + fallback stage/editor ngoài. |
| Mark resolved trong lúc mutex busy (git đang chạy op khác) | Sidecar queue/`BUSY`; UI disable nút trong khi in-flight + hiện trạng thái chờ. |
| i18n | Mọi chuỗi qua i18n en/vi (xem [i18n](#i18n)); không hardcode text. |
| Stash pop conflict | Cùng cơ chế section Conflicted (`stageState==='conflicted'`), resolver hoạt động. Nhưng KHÔNG có "Complete Merge" (không phải merge). Xem OQ-5. |

## i18n

Bổ sung key vào cả `en/git.json` và `vi/git.json` (đã có `git.error.MERGE_CONFLICT`). Nhóm đề xuất `git.conflict.*`:

- `git.conflict.section` — "Conflicted" / "Xung đột"
- `git.conflict.banner.resolve` — "{count} file xung đột — resolve rồi {action}" / "..."
- `git.conflict.banner.ready` — "Hết xung đột — sẵn sàng {action}" / "..."
- `git.conflict.takeOurs` / `takeTheirs` / `takeAllOurs` / `takeAllTheirs`
- `git.conflict.markResolved`
- `git.conflict.ours` / `git.conflict.theirs` (fallback label)
- `git.conflict.blockTitle` — "Block {i}/{n} — dòng {line}"
- `git.conflict.chosenCount` — "{chosen}/{total}"
- `git.conflict.binary.title` / `binary.takeOurs` / `binary.takeTheirs`
- `git.conflict.encoding.title` / `encoding.openExternal` / `encoding.markStaged`
- `git.conflict.emptySide` — "(phía này không có nội dung)"
- `git.conflict.abortConfirm`

## Dependencies

- **Đã có (không cần làm):** sidecar `git.readConflictFile` / `git.resolveFile` / `git.resolveFileBinary` / `git.completeMerge` / `git.mergeAbort` / `git.rebaseContinue` / `git.rebaseAbort`; API bridge trong `useGitApi.ts`; state `isMerging`/`isRebasing`/`hasConflict`; nút header Complete/Continue/Abort.
- **Phụ thuộc entity:** không tạo entity mới. Dùng `GitFile` (git-types.ts), `SidecarMergeConflictBlock`/`ReadConflictFileResult`/`ResolveFileParams` (useGitApi.ts).
- **Chạm store:** `stores/git.ts` — thêm ref `conflicted`, sửa `loadStatus` phân loại, thêm `loadConflictFile`/`resolveConflict`/`resolveConflictBinary`, sửa `completeMerge` phân nhánh rebase (OQ-4).
- **Chạm component:** `GitChangesList.vue`/`GitStatusSection.vue` (section Conflicted), `GitPageHeader.vue` (banner chỉ dẫn), right-pane host của page git (`pages/git.vue` hoặc composable), component mới `GitConflictResolver.vue`.
- **Không phụ thuộc mạng** — local-first OK.

## Out of scope

- **3-way conflict resolver** (base/ours/theirs) — v2. Ghi nhận từ [git-manager.md](./git-manager.md#out-of-scope).
- **Edit tay inline** nội dung block trong app — v1 chỉ 2-way pick. (Type `GitConflictResolution` có sẵn biến thể `manual` nhưng sidecar `resolveFile` **chỉ chấp nhận** `ours|theirs` → manual chưa được backend hỗ trợ.) Xem OQ-1.
- **Diff highlight token-level** giữa ours/theirs — hiển thị nguyên khối dòng là đủ v1.
- **Auto-resolve / merge tool ngoài tích hợp** (kdiff3, meld) — out of scope.
- **Conflict trong submodule / LFS** — out of scope (theo spec cha).
- **Trace event cho hành động resolve** — không persist event mới; merge commit đã ghi vào Git.

## Open questions cho Tech Lead / PO

- **OQ-1 (PO):** User có cần **edit tay inline** nội dung conflict trong app không? Backend `resolveFile` hiện chỉ nhận `ours|theirs`. 3 phương án:
  - (a) **v1 chỉ 2-way** (đề xuất) — đơn giản, khớp backend, KISS. User cần edit tay → mở external editor.
  - (b) Thêm nút "Mở trong editor ngoài" cho mọi conflict (không chỉ non-UTF-8) như lối thoát edit tay.
  - (c) v2 mở rộng `resolveFile` nhận `choice: 'manual', content` (đã có sẵn trong type UI, cần sidecar support). Trade-off: tăng surface + validate content.
- **OQ-2 (TL):** "Mở trong editor ngoài" implement thế nào? Chưa có API mở file bằng app OS mặc định. Phương án: (a) reuse terminal/`shell.openPath` nếu Electron main expose; (b) chỉ copy absolute path + hướng dẫn; (c) mở bằng Monaco full-screen của AWOG (đọc-ghi file trong workspace qua `fs.*`) — nhưng non-UTF-8 thì Monaco cũng khó. Ảnh hưởng Flow 5.
- **OQ-3 (TL):** Render 2 pane ours/theirs bằng renderer diff ui-next hiện có hay Monaco diff-editor read-only (như spec cha gợi ý)? Monaco nặng hơn nhưng đẹp; renderer sẵn có nhẹ, nhất quán. Đề xuất: renderer sẵn có cho v1.
- **OQ-4 (TL):** Wiring nút Complete/Continue. Hiện `completeMerge()` store luôn gọi `git.completeMerge`. Khi `isRebasing` phải gọi `git.rebaseContinue`. Sửa: `completeMerge()` phân nhánh `isRebasing ? rebaseContinue() : completeMerge()`, hay tách action `continueRebase()` riêng và header emit event khác nhau? (Header hiện emit chung `complete-merge`.)
- **OQ-5 (TL/BA):** Stash pop conflict — không có "Complete Merge" (không phải merge state). Sau khi resolve hết file conflicted từ stash pop, UI làm gì? (a) chỉ để file ở Staged, user tự commit; (b) hiện nút "Drop stash" nhắc user dọn stash còn lại (git giữ stash khi pop conflict). Cần chốt luồng — spec cha ghi "resolve conflict, sau đó drop stash thủ công".
- **OQ-6 (BA/PO):** Với section Conflicted, có cho phép **discard/checkout file conflicted** (vd `--ours`/`--theirs` như một shortcut) ngoài Abort không? Đề xuất: không ở v1 (giảm chân dễ bắn), chỉ Abort toàn cục.

## Quyết định kỹ thuật (Tech Lead)

**Ngày chốt:** 2026-07-09 · **Người chốt:** Tech Lead · **Trạng thái:** Accepted

**Vì sao không mở ADR riêng:** toàn bộ 6 quyết định dưới đây là **UI wiring** dựa trên hợp đồng IPC đã đóng băng ở [ADR 0017](../decisions/0017-git-manager-ipc-contract.md) + [ADR 0040](../decisions/0040-git-branch-ops-merge-rebase-pr.md). Không thêm dependency, không thêm/đổi IPC method, không đổi event schema, không phá invariant core (git scope vẫn = workspace, không tạo entity/DB mới, key không rời sidecar). Theo tiêu chí ADR của repo ("quyết định đã có ADR cũ phủ" + "refactor/wiring nội bộ") → ghi tại spec, không mint ADR mới. Nếu về sau chọn phương án `manual` (OQ-1c) hoặc mở rộng IPC → **mới** cần ADR (đổi hợp đồng sidecar).

### QĐ-1 (OQ-3 + OQ-1) — Renderer & phạm vi resolve: 2-way, KHÔNG Monaco

- Chốt **v1 chỉ 2-way pick** (OQ-1 phương án **a**). Backend `resolveFile` chỉ nhận `ours|theirs` → không làm edit tay inline. YAGNI: chưa có nhu cầu thực, và mở `manual` kéo theo đổi hợp đồng sidecar (thành ADR).
- **KHÔNG dùng Monaco** cho resolver (OQ-3 → renderer sẵn có). Lý do: 2-way chỉ cần render read-only `ours: string[]` / `theirs: string[]`; Monaco (2 model + worker) là over-engineering, ngược KISS, và mâu thuẫn "read-only chọn khối". Monaco chỉ dành cho Project Code Workspace ([ADR 0021](../decisions/0021-monaco-code-editor.md)).
- **Cách render:** biến mỗi side của block thành `DiffLine[]` rồi tái dùng đúng renderer dòng của `GitDiffViewer`/`GitDiffLine` (theo `DiffLine = { t; n?; s }` trong [git-types.ts](../../apps/desktop/ui-next/components/git/git-types.ts)). OURS map `t: '-'` (var `--del`), THEIRS map `t: '+'` (var `--add`) để tận dụng màu add/del sẵn có; hoặc `t: ' '` nếu muốn trung tính — chọn màu qua `useTheme()`/CSS var, **không hex**. Không cần token highlight (Out of scope đã ghi).

  ```ts
  // pseudocode — trong GitConflictResolver.vue / useConflictResolver()
  const toDiffLines = (lines: string[], kind: 'ours' | 'theirs'): DiffLine[] =>
    lines.length
      ? lines.map((s, i) => ({ t: kind === 'ours' ? '-' : '+', n: i + 1, s }))
      : [] // pane rỗng → placeholder i18n git.conflict.emptySide
  ```

### QĐ-2 (UI behavior) — Resolver ở right pane, KHÔNG modal; discriminated union

- Resolver **thay right pane** trong nhánh `section.kind === 'local-changes'` của [`GitManager.vue`](../../apps/desktop/ui-next/components/git/GitManager.vue) (nơi hiện render `GitDiffViewer + GitCommitPanel`). Khớp pattern "click file → chi tiết bên phải" đã có; không thêm layer modal.
- **Đổi kiểu selection** thay vì thêm biến rời rạc. Hiện `selectedFile: GitSelection | null` (`{ path; staged }`). Mở rộng thành union để right pane phân nhánh sạch:

  ```ts
  // git-types.ts — mở rộng, giữ tương thích call-site cũ qua kind 'file'
  type GitRightPaneSel =
    | { kind: 'file'; path: string; staged: boolean } // diff thường (như GitSelection cũ)
    | { kind: 'conflict'; path: string }              // → GitConflictResolver
    | null
  ```

  Template `GitManager.vue`: `v-if="sel?.kind === 'conflict'"` → `<GitConflictResolver :path="sel.path" @resolved="..." @abort-request="..." />`, `v-else-if="sel?.kind === 'file'"` → `GitDiffViewer` như cũ. `GitCommitPanel` giữ nguyên (luôn hiển thị dưới, không bị resolver che — hoặc ẩn khi conflict, tùy layout, developer quyết trong SFC).
- **Section Conflicted:** render trong `GitChangesList.vue` (đưa `conflicted` xuống prop mới), trên cùng, trước Staged; click item → `sel = { kind: 'conflict', path }`. **Không** checkbox stage / Discard trong section này (chốt OQ-6 = **không** shortcut checkout `--ours/--theirs`; chỉ Abort toàn cục).

### QĐ-3 (OQ-4) — Wiring Complete/Continue: SỬA `completeMerge()` phân nhánh, KHÔNG tách action

- **Không** thêm action `continueRebase()` riêng, **không** đổi event header. `GitPageHeader` đã có switch `isRebasing` để đổi nhãn nút và vẫn emit chung `complete-merge`. Giữ một điểm vào → ít khái niệm hơn (KISS), tránh header phải biết chọn event nào.
- **Sửa** [`completeMerge()`](../../apps/desktop/ui-next/stores/git.ts) (dòng ~1121) phân nhánh theo `isRebasing`, đối xứng với `abortMerge()` (đã phân nhánh `rebaseAbort`/`mergeAbort` ở dòng 1144-1145):

  ```ts
  // stores/git.ts — signature giữ nguyên, không đổi call-site
  const completeMerge = async () => {
    if (!available.value) {
      isMerging.value = false
      isRebasing.value = false
      hasConflict.value = false
      return
    }
    try {
      if (isRebasing.value) await useGitApi().rebaseContinue(workspaceRoot())
      else await useGitApi().completeMerge(workspaceRoot())
      await loadAll() // rebase có thể dừng ở conflict kế tiếp → loadAll set lại hasConflict
    } catch (err) {
      reportError(isRebasing.value ? 'rebaseContinue' : 'completeMerge', err)
    }
  }
  ```

  Lặp rebase (Flow 2) tự nhiên: `rebaseContinue` gặp conflict tiếp → sidecar trả `MERGE_CONFLICT`/status `isRebasing=true, conflictedCount>0` → `loadAll()` set `hasConflict=true` lại → resolver dùng cho batch mới. Không cần logic lặp riêng ở store.

### QĐ-4 (Store shape) — `conflicted` ref + phân loại + actions

- **Thêm ref** `conflicted = ref<GitFile[]>([])` cạnh `staged`/`unstaged` (dòng ~213), export trong return + `createGitState()`/`GitState` thêm field `conflicted: GitFile[]` (khởi tạo `[]`).
- **Sửa `loadStatus`** (dòng 393-406) tách 3 bucket theo `stageState`:

  ```ts
  const nextStaged: GitFile[] = []
  const nextUnstaged: GitFile[] = []
  const nextConflicted: GitFile[] = []
  for (const f of status.files) {
    if (f.stageState === 'conflicted') nextConflicted.push(adaptFile(f))
    else if (f.stageState === 'staged') nextStaged.push(adaptFile(f))
    else nextUnstaged.push(adaptFile(f))
  }
  staged.value = nextStaged
  unstaged.value = nextUnstaged
  conflicted.value = nextConflicted
  // hasConflict vẫn derive từ status.conflictedCount / stageState như cũ (dòng 405-406);
  // KHÔNG suy từ conflicted.value.length để tránh phụ thuộc thứ tự gán.
  ```

  Lưu ý dọn `conflicted.value = []` trong nhánh `NO_REPO` (cùng chỗ reset `staged`/`unstaged` dòng 415-416).
- **Actions mới** (đặt cạnh `merge`/`completeMerge`, cùng guard `available`/`workspaceRoot` + `reportError` như các action git khác):

  ```ts
  // Trả về ReadConflictFileResult cho component render; ném lỗi có gitCode để
  // component phân nhánh ENCODING_UNSUPPORTED / ENOENT (KHÔNG nuốt trong store).
  const loadConflictFile = (path: string): Promise<ReadConflictFileResult> =>
    useGitApi().readConflictFile(workspaceRoot(), path)

  const resolveConflict = async (
    path: string,
    resolutions: Array<{ blockIndex: number; choice: 'ours' | 'theirs' }>,
  ): Promise<void> => {
    if (!available.value) return
    try {
      await useGitApi().resolveFile(workspaceRoot(), { path, resolutions })
      await loadStatus() // file rời Conflicted → Staged; refresh hasConflict
    } catch (err) {
      reportError('resolveFile', err)
      throw err // để component giữ resolver mở khi MERGE_CONFLICT desync (CR-13)
    }
  }

  const resolveConflictBinary = async (
    path: string,
    choice: 'ours' | 'theirs',
  ): Promise<void> => {
    if (!available.value) return
    try {
      await useGitApi().resolveFileBinary(workspaceRoot(), { path, choice })
      await loadStatus()
    } catch (err) {
      reportError('resolveFileBinary', err)
      throw err
    }
  }
  ```

  **Ngoại lệ pattern có chủ đích:** các action git khác nuốt lỗi vào `reportError` (toast) rồi return. Ba action này **re-throw** sau khi report, để component biết giữ resolver mở + hiện lỗi inline khi desync (CR-13) / encoding (CR-10). `loadConflictFile` **không** try/catch — ném thẳng để component bắt `gitCode`.
- **Refresh:** không cần cơ chế mới. `loadStatus()` sau resolve đã đủ; watcher chokidar + subscribe `git:status:changed` sẵn có sẽ đồng bộ list.

### QĐ-5 (OQ-2) — External editor: DÙNG `store.openFile` sẵn có, KHÔNG thêm method

- **Đã có API.** [`store.openFile(path)`](../../apps/desktop/ui-next/stores/git.ts) (dòng ~1439) → `useSidecar().openPath(root, path)` → Electron `shell.openPath` mở file bằng app OS mặc định, **đã path-validate trong workspace**. Đây chính là "mở editor ngoài" cần cho Flow 5 (OQ-2 phương án **a** đã hiện thực sẵn). **Không** thêm method mới, **không** Monaco (non-UTF-8 Monaco cũng khó — đúng như OQ-2 nêu).
- **Flow non-UTF-8 (CR-10):** khi `loadConflictFile` ném `gitCode: 'ENCODING_UNSUPPORTED'`, resolver render chế độ fallback:
  - Nút "Mở trong editor ngoài" → `store.openFile(path)`.
  - Nút "Đánh dấu đã resolve (stage)" → `store.stageFile(path)` (đã có, dòng ~712) — **không** gọi `resolveFile` (không parse được).
  - Kèm chỉ dẫn + nút copy absolute path (dùng `navigator.clipboard`, đã dùng ở `GitManager.vue`) làm phương án dự phòng nếu `openPath` fail.
- **Flow binary (CR-09):** dùng `resolveConflictBinary` (QĐ-4). Không cần external editor.

### QĐ-6 (OQ-5) — Stash pop conflict: giữ ở Staged, KHÔNG auto-drop

- Chốt **phương án a**: sau resolve hết file conflicted từ stash pop, để file ở Staged, user tự commit; **không** hiện "Complete Merge" (không phải merge/rebase state → `isMerging=isRebasing=false`, resolver vẫn hoạt động vì chỉ phụ thuộc `stageState==='conflicted'`).
- **Không** tự động drop stash (git giữ stash khi pop lỗi — đúng hành vi git). Việc nhắc "Drop stash" (phương án b) là **enhancement tách riêng**, không thuộc scope feature này; user dọn qua context-menu stash sẵn có (`dispatchStash` → `store.stashDrop`). Ghi nhận cho v-next; nếu làm cũng chỉ là UI hint, không cần ADR.

### Tổng hợp task cập nhật cho Developer

1. `git-types.ts`: mở rộng selection thành union `GitRightPaneSel` (QĐ-2); thêm `conflicted: GitFile[]` vào `GitState` + `createGitState()`.
2. `stores/git.ts`: thêm ref `conflicted` + export; sửa `loadStatus` 3-bucket + reset trong `NO_REPO`; thêm `loadConflictFile`/`resolveConflict`/`resolveConflictBinary` (re-throw); sửa `completeMerge` phân nhánh `isRebasing` (QĐ-3, QĐ-4).
3. `GitConflictResolver.vue` (+ tùy chọn `GitConflictBlock.vue` con; state → `useConflictResolver()` nếu > ~250 dòng): render block 2-way qua renderer diff sẵn có, chế độ binary, chế độ ENCODING_UNSUPPORTED fallback (QĐ-1, QĐ-5).
4. `GitChangesList.vue`: prop + section "Conflicted" trên cùng, không checkbox/Discard (QĐ-2, OQ-6).
5. `GitManager.vue`: chuyển `selectedFile` sang union; nhánh right pane render resolver; wire event `resolved`/`abort-request`; giữ `@complete-merge` header như cũ.
6. `GitPageHeader.vue`: thêm dòng banner chỉ dẫn theo `hasConflict` + biến thể `isRebasing` (QĐ-3 phần UI).
7. i18n `en/git.json` + `vi/git.json`: nhóm `git.conflict.*` (xem [i18n](#i18n)).
8. Không chạm sidecar, không thêm dependency, không đổi IPC.

## Đầu vào cho QA

Kịch bản test tối thiểu (dựng repo local):

1. Merge 2 branch sửa cùng dòng 1 file → 1 block → resolve ours → complete. (CR-02,03,06,07)
2. Merge tạo 3 file conflicted, mỗi file nhiều block → Take all theirs từng file → complete. (CR-05,14)
3. Rebase conflict qua 2 commit liên tiếp → Continue Rebase lặp. (CR-08)
4. Conflict file binary (.png) → Take ours binary. (CR-09)
5. Conflict file UTF-16 → nhánh ENCODING_UNSUPPORTED. (CR-10)
6. Sửa file conflicted ngoài app (đổi số block) rồi Mark resolved → lỗi MERGE_CONFLICT. (CR-13)
7. Abort giữa lúc resolver mở với lựa chọn dở. (CR-12)
8. Block add/add với một side rỗng. (edge)
9. Offline: resolve + complete vẫn chạy. (CR-15)
10. Stash pop conflict → resolve → xác nhận luồng theo OQ-5.

## Tham chiếu

- Spec cha: [git-manager.md](./git-manager.md) (Conflict resolver UI v1, Flow 3, AC-32..36)
- ADR: [0017-git-manager-ipc-contract.md](../decisions/0017-git-manager-ipc-contract.md), [0040-git-branch-ops-merge-rebase-pr.md](../decisions/0040-git-branch-ops-merge-rebase-pr.md)
- Sidecar: [git.read-conflict-file.ts](../../apps/desktop/sidecar/src/methods/git.read-conflict-file.ts), [git.resolve-file.ts](../../apps/desktop/sidecar/src/methods/git.resolve-file.ts), [git.resolve-file-binary.ts](../../apps/desktop/sidecar/src/methods/git.resolve-file-binary.ts)
- UI: [useGitApi.ts](../../apps/desktop/ui-next/composables/useGitApi.ts), [stores/git.ts](../../apps/desktop/ui-next/stores/git.ts), [GitChangesList.vue](../../apps/desktop/ui-next/components/git/GitChangesList.vue), [GitPageHeader.vue](../../apps/desktop/ui-next/components/git/GitPageHeader.vue), [git-types.ts](../../apps/desktop/ui-next/components/git/git-types.ts)
- Convention: [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md)
