# Task Plan: Git Conflict Resolution UI

> **Spec:** [git-conflict-resolution-ui.md](./git-conflict-resolution-ui.md)
> **Owner:** Project Manager · **Ngày:** 2026-07-09
> **Phạm vi:** Chỉ tầng UI + store wiring trong `apps/desktop/ui-next/`.
> **KHÔNG chạm** sidecar · **KHÔNG** thêm dependency · **KHÔNG** đổi/thêm IPC method hay event schema.

## Bối cảnh cho Developer (đọc trước khi code)

Backend + API bridge đã đủ. Feature này chỉ nối UI. Tất cả quyết định kiến trúc đã chốt trong section
"Quyết định kỹ thuật (Tech Lead)" của spec (QĐ-1..QĐ-6) — **không tự phát minh phương án khác**.

**Sự thật đã xác minh trong code (khác đôi chỗ so với số dòng spec — theo code là chuẩn):**

- **Selection sống ở component, KHÔNG ở store.** `GitManager.vue` giữ `selectedFile = ref<GitSelection | null>`
  (dòng ~390). `GitState.sel` (git-types.ts dòng 144) là field khác, không dùng cho right pane. Union
  `GitRightPaneSel` của QĐ-2 sẽ thay chính `selectedFile` **cục bộ trong GitManager.vue**, không đụng `GitState.sel`.
- **`GitStatusSection.vue` hard-code checkbox stage + nút Discard-all.** Section Conflicted yêu cầu KHÔNG có
  hai thứ đó (QĐ-2, OQ-6) → **không tái dùng GitStatusSection cho Conflicted**; render section riêng
  (block markup gọn) ngay trong `GitChangesList.vue`.
- **Renderer diff:** `GitDiffLine.vue` nhận `DiffRow = { cls; n; tokens }` (KHÔNG phải `DiffLine`). `DiffLine`
  là `{ t; n?; s }`. Resolver cần map `ours/theirs: string[]` → `DiffLine[]` (QĐ-1 pseudocode) rồi → `DiffRow`
  để feed `GitDiffLine` (xem cách `GitDiffViewer.vue` convert). Developer tự chọn: dùng lại `GitDiffLine`
  hay render `<div>` dòng đơn giản với class `dl` — miễn read-only, không hex, không token highlight.
- **`loadStatus`** hiện chỉ tách 2 bucket (git.ts dòng 388-406): `staged` vs `unstaged`; file conflicted rơi
  nhầm vào `unstaged`. Cần thêm bucket thứ 3.
- **`completeMerge()`** (git.ts dòng 1121) luôn gọi `git.completeMerge` — cần phân nhánh `isRebasing`
  (QĐ-3). `abortMerge()` (dòng 1136) đã phân nhánh đúng, dùng làm mẫu.
- **Store đã có sẵn:** `openFile` (dòng 1439), `stageFile` (dòng 712) — dùng cho Flow non-UTF-8 (QĐ-5).
- **API bridge đã có** trong `composables/useGitApi.ts`: `readConflictFile`, `resolveFile`,
  `resolveFileBinary`, `rebaseContinue`, `rebaseAbort`, `mergeAbort`, `completeMerge` + type
  `ReadConflictFileResult` / `ResolveFileParams` / `ResolveFileBinaryParams` / `SidecarMergeConflictBlock`.
- **i18n thật:** `apps/desktop/ui-next/i18n/locales/en/git.json` + `apps/desktop/ui-next/i18n/locales/vi/git.json`
  (đã có nhóm `git.error.MERGE_CONFLICT`, `git.header.completeMerge`, `git.header.continueRebase`,
  `git.header.abortMerge`, `git.header.abortRebase`).

**Thứ tự thi công tổng:** types → store → resolver component → wiring list/manager → header banner → i18n → self-check.

---

## MVP scope

### T1. Mở rộng type — union selection + field `conflicted`
- [ ] **Add `GitRightPaneSel` union + `conflicted: GitFile[]` vào state** — **S**
  - **Role:** developer
  - **Depends on:** none
  - **File:**
    - `apps/desktop/ui-next/components/git/git-types.ts`
  - **Việc cụ thể:**
    1. Thêm type export (QĐ-2):
       ```ts
       export type GitRightPaneSel =
         | { kind: 'file'; path: string; staged: boolean }
         | { kind: 'conflict'; path: string }
         | null
       ```
       (giữ `GitSelection` cũ nếu còn call-site khác dùng — chỉ thêm, không xoá vội).
    2. Thêm field `conflicted: GitFile[]` vào type `GitState` (cạnh `staged`/`unstaged`, dòng ~150).
    3. Thêm `conflicted: []` vào `createGitState()` return (cạnh `staged: []`/`unstaged: []`, dòng ~188).
  - **Acceptance:** typecheck pass; `GitState.conflicted` tồn tại, khởi tạo `[]`. (Nền cho CR-01.)
  - **Risk:** none — thay đổi thuần type.

### T2. Store — ref `conflicted`, phân loại 3 bucket, 3 action, sửa `completeMerge`
- [ ] **Wire store cho conflict** — **M**
  - **Role:** developer
  - **Depends on:** T1
  - **File:**
    - `apps/desktop/ui-next/stores/git.ts`
  - **Việc cụ thể (theo QĐ-3 + QĐ-4):**
    1. Thêm ref `const conflicted = ref<GitFile[]>(seed.conflicted)` cạnh `staged`/`unstaged` (dòng ~213-214);
       export `conflicted` trong return của store (cạnh `staged`/`unstaged`).
    2. Sửa `loadStatus` (dòng 388-406) → 3 bucket:
       ```ts
       const nextConflicted: GitFile[] = []
       // trong vòng for:
       if (f.stageState === 'conflicted') nextConflicted.push(adaptFile(f))
       else if (f.stageState === 'staged') nextStaged.push(adaptFile(f))
       else nextUnstaged.push(adaptFile(f))
       // sau vòng for:
       conflicted.value = nextConflicted
       ```
       Giữ nguyên cách derive `hasConflict` (dòng 405-406) — KHÔNG suy từ `conflicted.value.length`.
    3. Reset `conflicted.value = []` trong nhánh `NO_REPO` (git.ts dòng 414-421, cùng chỗ reset
       `staged`/`unstaged`).
    4. Thêm 3 action (đặt cạnh `merge`/`completeMerge`, dùng `available`/`workspaceRoot`/`reportError` như
       các action git khác) — **`resolveConflict`/`resolveConflictBinary` re-throw sau report;
       `loadConflictFile` KHÔNG try/catch** (ném thẳng để component bắt `gitCode`):
       ```ts
       const loadConflictFile = (path: string): Promise<ReadConflictFileResult> =>
         useGitApi().readConflictFile(workspaceRoot(), path)

       const resolveConflict = async (path, resolutions): Promise<void> => {
         if (!available.value) return
         try { await useGitApi().resolveFile(workspaceRoot(), { path, resolutions }); await loadStatus() }
         catch (err) { reportError('resolveFile', err); throw err }
       }
       const resolveConflictBinary = async (path, choice): Promise<void> => {
         if (!available.value) return
         try { await useGitApi().resolveFileBinary(workspaceRoot(), { path, choice }); await loadStatus() }
         catch (err) { reportError('resolveFileBinary', err); throw err }
       }
       ```
       Export cả 3 trong return store.
    5. Sửa `completeMerge()` (dòng 1121) phân nhánh `isRebasing` (giữ signature, không đổi call-site):
       ```ts
       if (isRebasing.value) await useGitApi().rebaseContinue(workspaceRoot())
       else await useGitApi().completeMerge(workspaceRoot())
       await loadAll()
       // reportError(isRebasing.value ? 'rebaseContinue' : 'completeMerge', err)
       ```
  - **Acceptance:**
    - `loadStatus` đẩy file `stageState==='conflicted'` vào `conflicted`, không lẫn `unstaged` (CR-01).
    - `resolveConflict` gọi `git.resolveFile` với đủ resolution rồi `loadStatus`; re-throw khi lỗi (CR-06, CR-13).
    - `resolveConflictBinary` gọi `git.resolveFileBinary` rồi `loadStatus` (CR-09).
    - `completeMerge` gọi `git.rebaseContinue` khi `isRebasing`, `git.completeMerge` khi merge (CR-07, CR-08).
  - **Risk:** đảm bảo import type `ReadConflictFileResult` từ `useGitApi` (đã export). Không nuốt lỗi resolve
    (component cần biết để giữ resolver mở — CR-13/CR-10).

### T3. Component `GitConflictResolver.vue` (+ composable nếu > ~250 dòng)
- [ ] **Tạo resolver 2-way (text / binary / encoding fallback)** — **L**
  - **Role:** developer
  - **Depends on:** T2
  - **File (tạo mới):**
    - `apps/desktop/ui-next/components/git/GitConflictResolver.vue`
    - (tùy chọn) `apps/desktop/ui-next/components/git/GitConflictBlock.vue` — block con
    - (bắt buộc nếu SFC > ~250 dòng) `apps/desktop/ui-next/composables/useConflictResolver.ts`
  - **Props/emits (type-only, event kebab-case):**
    - Props: `{ path: string }`
    - Emits: `(e: 'resolved'): void`, `(e: 'abort-request'): void`
  - **Việc cụ thể (theo QĐ-1 + QĐ-5, UI behavior spec):**
    1. `onMounted`/`watch(path)` → gọi `store.loadConflictFile(path)`; bắt lỗi phân nhánh theo `gitCode`:
       - `ENCODING_UNSUPPORTED` → chế độ **encoding fallback**.
       - `ENOENT` / lỗi khác → thông báo "file không còn xung đột / đã thay đổi" + gợi ý (không crash).
    2. **Chế độ text** (`isBinary === false`): render N block. Mỗi block: tiêu đề
       `git.conflict.blockTitle`, 2 pane OURS(label)/THEIRS(label) — label từ `oursLabel`/`theirsLabel`,
       rỗng → fallback `git.conflict.ours`/`git.conflict.theirs`. Nội dung read-only: map
       `ours/theirs: string[]` → `DiffLine[]` (OURS `t:'-'`, THEIRS `t:'+'`) rồi render qua renderer diff
       sẵn có (dùng lại `GitDiffLine.vue` sau khi convert `DiffLine`→`DiffRow` như `GitDiffViewer.vue`, hoặc
       `<div class="dl">` dòng đơn giản). Pane rỗng → placeholder `git.conflict.emptySide`.
    3. **State cục bộ** (KHÔNG lên store): `Map<number, 'ours' | 'theirs'>` cho lựa chọn per block. Nút
       per-block "Take ours"/"Take theirs" toggle mutually-exclusive (CR-03). "Take all ours"/"Take all
       theirs" set toàn bộ (CR-05). Chip đếm `git.conflict.chosenCount` "{chosen}/{total}".
    4. Nút **"Mark resolved"** disabled cho tới khi MỌI block đã chọn (CR-04); click → build
       `resolutions: Array<{ blockIndex, choice }>` cho **mọi block** → `store.resolveConflict(path, resolutions)`;
       success → emit `resolved`; nếu lỗi (re-throw từ store) → giữ resolver mở, hiện lỗi inline dùng
       `git.error.MERGE_CONFLICT` + gợi ý reload (CR-13).
    5. **Chế độ binary** (`isBinary === true`): KHÔNG render block; hiện `git.conflict.binary.title` + 2 nút
       `binary.takeOurs`/`binary.takeTheirs` → `store.resolveConflictBinary(path, choice)` → emit `resolved`
       (CR-09).
    6. **Chế độ encoding fallback:** hiện `git.conflict.encoding.title` + nút
       `encoding.openExternal` → `store.openFile(path)`; nút `encoding.markStaged` → `store.stageFile(path)`
       (KHÔNG `resolveFile`); + nút copy absolute path dự phòng (`navigator.clipboard`) (CR-10, QĐ-5).
    7. **Màu qua CSS var / `useTheme()`** — viền block chưa chọn `--border`, đã chọn `--accent`; KHÔNG hex.
    8. Nếu SFC > ~250 dòng: đẩy state + handler vào `useConflictResolver()`, SFC chỉ giữ template + bind.
  - **Acceptance:** map CR-02, CR-03, CR-04, CR-05, CR-06, CR-09, CR-10, CR-13 + edge "block rỗng một side".
  - **Risk:** đây là task lớn nhất. Nếu convert renderer phức tạp, chấp nhận render dòng đơn giản (read-only)
    thay vì ép dùng `GitDiffLine` — KISS. Đừng thêm Monaco (QĐ-1 cấm).

### T4. `GitChangesList.vue` — section "Conflicted" trên cùng
- [ ] **Render section Conflicted (no checkbox / no discard)** — **M**
  - **Role:** developer
  - **Depends on:** T1
  - **File:**
    - `apps/desktop/ui-next/components/git/GitChangesList.vue`
  - **Việc cụ thể (QĐ-2, UI behavior spec):**
    1. Thêm prop `conflicted: GitFile[]`.
    2. Render section "Conflicted (N)" **trên cùng**, TRƯỚC Staged, chỉ khi `conflicted.length > 0`. Icon
       cảnh báo + màu `--del`/warning token. Mỗi item badge `U`, click → emit sự kiện chọn conflict.
    3. **KHÔNG** dùng `GitStatusSection` (nó hard-code checkbox stage + discard-all). Render markup gọn riêng
       (list item click-only). **KHÔNG** checkbox stage per-file, **KHÔNG** discard-all trong section này.
    4. Thêm emit mới `(e: 'select-conflict', file: string): void`.
  - **Acceptance:** CR-01 (section trên cùng, badge U, file không lẫn Changes); click item phát
    `select-conflict`. Section Conflicted không có checkbox/discard.
  - **Risk:** không phá render Staged/Changes hiện có; giữ prop/emit cũ nguyên vẹn.

### T5. `GitManager.vue` — union selection + nhánh right pane resolver + wiring
- [ ] **Wire selection union + render resolver ở right pane** — **M**
  - **Role:** developer
  - **Depends on:** T2, T3, T4
  - **File:**
    - `apps/desktop/ui-next/components/git/GitManager.vue`
  - **Việc cụ thể (QĐ-2):**
    1. Đổi `selectedFile` (dòng ~390) từ `ref<GitSelection | null>` sang `ref<GitRightPaneSel>` (import type
       mới từ git-types). Cập nhật mọi chỗ đọc `.path`/`.staged` sang phân nhánh `kind`:
       - `@select="(f, s) => selectedFile = { kind: 'file', path: f, staged: s }"`.
       - Các hàm `clearSelectionFor`, `onDiscardAll`, `diffLines` watch, `onStageHunk`… phải guard
         `sel?.kind === 'file'` trước khi đọc `.staged`/`.path` (một số chỉ áp dụng cho file diff).
    2. Truyền `:conflicted="store.conflicted"` vào `<GitChangesList>`; wire
       `@select-conflict="(f) => (selectedFile = { kind: 'conflict', path: f })"`.
    3. Trong nhánh `section.kind === 'local-changes'` (dòng 74-116), phân nhánh right pane `.detail`:
       - `v-if="selectedFile?.kind === 'conflict'"` →
         `<GitConflictResolver :path="selectedFile.path" @resolved="onConflictResolved"
         @abort-request="() => store.abortMerge()" />`.
       - `v-else` → `GitDiffViewer` như cũ (đọc `selectedFile?.kind === 'file' ? … : null`).
    4. `onConflictResolved()`: `selectedFile.value = null` (đóng resolver; `loadStatus` trong store đã refresh
       list) → file rời Conflicted. Nếu hết conflicted, banner/nút Complete tự cập nhật (CR-06, CR-14).
    5. Giữ `@complete-merge="() => store.completeMerge()"` header nguyên (QĐ-3 — store phân nhánh rebase).
    6. `GitCommitPanel`: developer quyết ẩn khi `kind === 'conflict'` hay giữ (spec cho phép tùy layout).
    7. Abort (CR-12): khi `store.abortMerge()` xong, `hasConflict=false` → nếu resolver đang mở, đóng nó
       (`selectedFile.value = null`) — có thể watch `store.hasConflict` hoặc reset trong handler abort.
  - **Acceptance:** CR-02 (click conflict → resolver ở right pane), CR-07/CR-08 (Complete/Continue),
    CR-12 (abort đóng resolver), CR-14 (nhiều file). Diff file thường vẫn hoạt động như trước.
  - **Risk:** đây là chỗ dễ vỡ nhất — nhiều call-site đọc `selectedFile.path/.staged`. Rà toàn bộ (search
    `selectedFile`) để không sót guard `kind`. Confirm dialog cho Abort đã có ở header/flow — kiểm tra
    Flow 3 (confirm "bỏ toàn bộ merge/rebase").

### T6. `GitPageHeader.vue` — banner chỉ dẫn khi conflict
- [ ] **Thêm dòng chỉ dẫn theo hasConflict + biến thể rebase** — **S**
  - **Role:** developer
  - **Depends on:** none (song song với T2-T5; chỉ cần i18n T7 để hiển thị đúng chữ)
  - **File:**
    - `apps/desktop/ui-next/components/git/GitPageHeader.vue`
  - **Việc cụ thể (QĐ-3 phần UI, UI behavior spec):**
    1. Trong block `v-if="isMerging || isRebasing"` (dòng 56-64), thêm dòng chỉ dẫn cạnh nút Complete/Continue:
       - `hasConflict === true` → `git.conflict.banner.resolve` với `{ count, action }` (action =
         `continueRebase`/`completeMerge` theo `isRebasing`). Nút Complete/Continue disabled (đã có).
       - `hasConflict === false` → `git.conflict.banner.ready` với `{ action }`. Nút enabled (đã có).
    2. Cần số file conflicted → thêm prop `conflictedCount: number` (truyền `store.conflicted.length` từ
       GitManager) HOẶC prop `conflictCount`; developer chọn tên, cập nhật GitManager truyền xuống.
    3. Text qua i18n, KHÔNG hardcode; màu qua CSS var/theme.
  - **Acceptance:** CR-11 (banner hiện đúng số file + đúng biến thể merge/rebase; đổi "sẵn sàng" khi hết
    conflict; nút disabled/enabled đúng).
  - **Risk:** cần thêm prop mới → nhớ cập nhật chỗ truyền prop trong `GitManager.vue` (T5). Nếu T5 chưa xong,
    tạm truyền `store.conflicted.length` inline.

### T7. i18n — nhóm `git.conflict.*` (en + vi)
- [ ] **Bổ sung key i18n en/vi** — **S**
  - **Role:** developer
  - **Depends on:** none (nên làm sớm để T3/T6 có key thật; nhưng key list đã cố định trong spec)
  - **File:**
    - `apps/desktop/ui-next/i18n/locales/en/git.json`
    - `apps/desktop/ui-next/i18n/locales/vi/git.json`
  - **Việc cụ thể (theo section i18n spec):** thêm nhóm `git.conflict.*`:
    - `section`, `banner.resolve` (`{count}`,`{action}`), `banner.ready` (`{action}`),
      `takeOurs`, `takeTheirs`, `takeAllOurs`, `takeAllTheirs`, `markResolved`, `ours`, `theirs`,
      `blockTitle` (`{i}`,`{n}`,`{line}`), `chosenCount` (`{chosen}`,`{total}`),
      `binary.title`, `binary.takeOurs`, `binary.takeTheirs`,
      `encoding.title`, `encoding.openExternal`, `encoding.markStaged`,
      `emptySide`, `abortConfirm`.
    - Cần thêm 2 label action để nội suy `{action}` trong banner nếu chưa tách được từ
      `git.header.completeMerge`/`continueRebase` — tái dùng key header có sẵn nếu khớp.
  - **Acceptance:** mọi chuỗi resolver + banner render qua i18n; en + vi đồng bộ key (không thiếu bên nào);
    tiếng Việt đúng chính tả (CR-11 + rule "không hardcode text").
  - **Risk:** giữ 2 file cùng bộ key — thiếu key bên nào sẽ hiện key thô. Nội suy `{action}` phải nhất quán.

### T8. Self-check — lint / format / typecheck + verify AC
- [ ] **Chạy lint:fix + format + typecheck, verify AC** — **S**
  - **Role:** developer
  - **Depends on:** T2, T3, T4, T5, T6, T7
  - **File:** (không sửa mới — chạy lệnh)
  - **Việc cụ thể:**
    ```bash
    cd apps/desktop/ui-next
    pnpm lint:fix && pnpm format
    pnpm lint       # 0 error
    pnpm typecheck  # vue-tsc strict, 0 error
    ```
    Rồi self-verify nhanh các AC UI-verify được: CR-01 (section), CR-02..CR-06 (resolver text),
    CR-07/CR-08 (complete/continue), CR-09 (binary), CR-10 (encoding), CR-11 (banner), CR-12 (abort),
    CR-14 (nhiều file). Ghi lại CR nào cần QA dựng repo thật (CR-13 desync, CR-15 offline).
  - **Acceptance:** lint 0 error, typecheck 0 error, format sạch; checklist CR tự-verify pass hoặc ghi rõ
    CR nào chuyển QA.
  - **Risk:** hook `format-after-edit.sh` chỉ chạy trên file trong `apps/desktop/ui/` (không phải ui-next) —
    **phải chạy tay** lệnh trên cho ui-next.

---

## Thứ tự thi công & song song

```
T1 (types)
  ├─> T2 (store) ──┐
  └─> T4 (list) ───┤
T3 (resolver) ◄── T2
                   ├─> T5 (manager wiring) ◄── T2, T3, T4
T6 (header banner) ── song song, cần prop từ T5 (hoặc inline tạm)
T7 (i18n) ─────────── song song hoàn toàn (key đã cố định trong spec)
                   └─> T8 (self-check) ◄── T2..T7
```

- **Làm song song được:** T7 (i18n) độc lập hoàn toàn — làm bất cứ lúc nào. T6 (header) độc lập về file,
  chỉ cần khớp prop với T5. T4 (list) và T2 (store) song song sau khi T1 xong.
- **Đường găng (critical path):** T1 → T2 → T3 → T5 → T8. Đây là chuỗi tuần tự dài nhất.
- **Task lớn nhất:** T3 (resolver) — nếu cần chia nhỏ, tách `GitConflictBlock.vue` + `useConflictResolver.ts`.

## Ước lượng tổng

| Task | Effort |
|---|---|
| T1 types | S |
| T2 store | M |
| T3 resolver | L |
| T4 list | M |
| T5 manager wiring | M |
| T6 header banner | S |
| T7 i18n | S |
| T8 self-check | S |

**Tổng ước lượng: ~3.5–5 ngày công** (1 developer). Đường găng T1→T2→T3→T5→T8 ≈ 3–4 ngày; T4/T6/T7
chèn song song không kéo dài tổng.

## Ngoài phạm vi (đã chốt trong spec — KHÔNG làm)

- 3-way merge, edit tay inline block, token-level diff highlight, Monaco cho resolver (QĐ-1).
- Shortcut checkout `--ours/--theirs` per-file trong section Conflicted (OQ-6 = không).
- Auto-drop stash sau stash-pop conflict; nhắc "Drop stash" (QĐ-6 = không, enhancement tách riêng).
- Trace event cho hành động resolve.
- Thêm dependency / đổi IPC / chạm sidecar.

## Missing from spec / cần lưu ý (không block, nhưng ghi nhận)

- **`{action}` trong banner:** spec liệt kê key `git.conflict.banner.resolve/ready` với `{action}` nhưng
  không nêu rõ nguồn chuỗi action. Đề xuất: nội suy từ `git.header.completeMerge`/`git.header.continueRebase`
  (đã có). Nếu BA muốn wording khác → xác nhận trong T7.
- **Confirm dialog Abort (Flow 3):** header `@abort-merge` hiện gọi thẳng `store.abortMerge()`. Flow 3 yêu cầu
  confirm "bỏ toàn bộ merge/rebase…". Kiểm tra xem confirm đã có ở đâu chưa; nếu chưa, T5 cần thêm confirm
  (dùng `useConfirm()` sẵn có + key `git.conflict.abortConfirm`). Ghi nhận như một điểm cần developer xác nhận.
- **GitCommitPanel khi conflict:** spec để "developer quyết trong SFC" (ẩn hay giữ). Không phải blocker.

## Đầu vào cho QA (chuyển tiếp từ spec)

Sau T8, QA dựng repo local chạy 10 kịch bản trong spec section "Đầu vào cho QA" (CR-02/03/06/07,
CR-05/14, CR-08, CR-09, CR-10, CR-13, CR-12, edge block rỗng, CR-15 offline, OQ-5 stash-pop). CR-13 (desync)
và CR-15 (offline) cần môi trường thật → không tự-verify được ở T8.
