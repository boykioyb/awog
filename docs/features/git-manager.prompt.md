# Prompt: Implement Git Manager Prototype (UI-only, mock data)

> **Mục đích:** Prompt self-contained để giao cho một LLM (Claude Code, GPT-5, hoặc dev mới) triển khai **bản prototype hoàn chỉnh** của Git Manager trong AWOG, **chỉ ở lớp UI**, dùng mock data trong Pinia store. Không spawn `git` thật, không sidecar.
>
> **Cách dùng:** Copy toàn bộ phần ` ### PROMPT BẮT ĐẦU ` xuống cuối file, paste vào LLM/agent mới. LLM cần quyền Read/Write/Edit/Bash trong thư mục `apps/desktop/ui/`.

---

## Context cho người giao prompt

- Spec đầy đủ: [`git-manager.md`](./git-manager.md) — 42 AC, 21 RPC IPC, 6 user flow
- Brief: [`git-manager.brief.md`](./git-manager.brief.md)
- Repo: `/Users/kyro/KyroTech/Projects/awog`
- Frontend: `apps/desktop/ui` (Nuxt 4 SPA, `ssr: false`, Pinia, Tailwind, Monaco, VueFlow)
- Convention bắt buộc đọc: `CLAUDE.md`, `.claude/rules/{principles,typescript,nuxt-vue,lint-format,security}.md`

---

## Definition of Done cho prototype

- ✅ Page `/git` accessible từ NavRail icon (lucide `git-branch` hoặc `git-fork`).
- ✅ 5 tab/section: **Changes**, **History**, **Branches**, **Stash**, **Remotes**.
- ✅ Layout 3-pane cho tab Changes: file list (trái) | diff viewer (giữa) | commit panel (phải).
- ✅ Toàn bộ thao tác chạy được trên mock data, không lỗi runtime.
- ✅ Conflict resolver UI 2-way pick (Monaco diff) chạy được mô phỏng.
- ✅ Toast/notification khi push/pull/fetch (mock progress với `setTimeout`).
- ✅ Theme color qua `useTheme()`, không hardcode hex.
- ✅ `pnpm typecheck` + `pnpm lint` pass 0 error.
- ✅ Page render được trên `pnpm dev` ở `http://localhost:3030/git` mà không có warning console.
- ✅ README `apps/desktop/ui/README.md` cập nhật ghi nhận route mới.

---

### PROMPT BẮT ĐẦU

Bạn là kỹ sư frontend làm việc trên repo **AWOG** (Artifact Workflow Orchestrate Guild) tại `/Users/kyro/KyroTech/Projects/awog`. Nhiệm vụ: triển khai **prototype hoàn chỉnh** của tính năng **Git Manager** ở lớp UI Nuxt, dùng mock data. Không động vào sidecar — sidecar Node.js chưa tồn tại, mọi git operation chạy mock trong Pinia store.

#### 1. Bắt buộc đọc trước khi code

1. `/Users/kyro/KyroTech/Projects/awog/CLAUDE.md` — quy ước repo
2. `/Users/kyro/KyroTech/Projects/awog/.claude/rules/principles.md`
3. `/Users/kyro/KyroTech/Projects/awog/.claude/rules/typescript.md`
4. `/Users/kyro/KyroTech/Projects/awog/.claude/rules/nuxt-vue.md`
5. `/Users/kyro/KyroTech/Projects/awog/.claude/rules/lint-format.md`
6. `/Users/kyro/KyroTech/Projects/awog/.claude/rules/security.md`
7. `/Users/kyro/KyroTech/Projects/awog/docs/features/git-manager.md` — **spec đầy đủ, source of truth**
8. `/Users/kyro/KyroTech/Projects/awog/docs/features/git-manager.brief.md`
9. `/Users/kyro/KyroTech/Projects/awog/docs/coding/nuxt-frontend.md`
10. `/Users/kyro/KyroTech/Projects/awog/apps/desktop/ui/README.md`

Đọc các file pattern hiện tại để học style:

- `apps/desktop/ui/layouts/default.vue`
- `apps/desktop/ui/pages/tasks/index.vue` (pattern 3-pane gần nhất)
- `apps/desktop/ui/pages/agents/index.vue`
- `apps/desktop/ui/stores/workspace.ts` (pattern Pinia composition)
- `apps/desktop/ui/stores/sessions.ts`
- `apps/desktop/ui/composables/useTheme.ts`
- `apps/desktop/ui/utils/themes.ts`
- `apps/desktop/ui/utils/initial-data.ts` (pattern mock data)
- `apps/desktop/ui/types/index.ts`

#### 2. Phạm vi prototype (DoD)

Implement **đầy đủ 4 nhóm** đã có trong spec:

1. **Status + Stage + Commit** — stage/unstage per-file (hunk-level OK skip nếu phức tạp, ghi TODO).
2. **Diff viewer** — Monaco diff editor cho file text; placeholder cho binary.
3. **Fetch / Pull / Push** — mock với `setTimeout` 800-2000ms + progress event giả + toast.
4. **Stash + Branch + Resolve conflict** — list/save/pop/drop stash; create/checkout/delete branch; 2-way conflict picker với Monaco.

**Out of scope cho prototype này** (skip, ghi TODO comment trong code):

- Sidecar IPC thật (mọi action chạy trong store, không gọi mạng/exec).
- Auth flow (chỉ mock error message khi push).
- Auto-commit per phase (đó là feature Task Engine, không thuộc prototype này).
- Cross-link Agent Trace ↔ commit (mock vài commit có `phaseId` trong message để demo, không wire vào trace).
- Performance optimization cho repo >10k file (mock có ~30 file là đủ).

#### 3. Files cần tạo / sửa

**Types** — sửa `apps/desktop/ui/types/index.ts`, thêm:

```ts
export type GitFileStatusCode =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export type GitFileStatus = {
  path: string
  oldPath?: string
  index: GitFileStatusCode | 'clean'
  workTree: GitFileStatusCode | 'clean'
  isBinary: boolean
  isStaged: boolean
  hasConflict: boolean
}

export type GitCommit = {
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  date: string // ISO
  subject: string
  body?: string
  parents: string[]
  refs: string[] // branch/tag refs pointing here
  phaseId?: string // AWOG cross-link, optional
  agentId?: string
}

export type GitBranch = {
  name: string
  isCurrent: boolean
  isRemote: boolean
  upstream?: string
  ahead: number
  behind: number
  lastCommit: string // hash
}

export type GitStashEntry = {
  index: number
  ref: string // stash@{0}
  message: string
  date: string
  branch: string
}

export type GitRemote = {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type GitDiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: Array<{ kind: 'context' | 'add' | 'del'; text: string }>
}

export type GitFileDiff = {
  path: string
  oldPath?: string
  isBinary: boolean
  hunks: GitDiffHunk[]
}

export type GitMergeConflictBlock = {
  startLine: number
  endLine: number
  ours: string
  theirs: string
  base?: string
  resolution: 'ours' | 'theirs' | 'manual' | 'unresolved'
}

export type GitRepoState =
  | 'clean'
  | 'dirty'
  | 'merging'
  | 'rebasing'
  | 'detached'
  | 'no-repo'
```

**Pinia store** — tạo mới `apps/desktop/ui/stores/git.ts`:

- Composition style `defineStore('git', () => { ... })`
- State: `currentBranch`, `branches`, `commits`, `stashes`, `remotes`, `statusFiles`, `selectedFilePath`, `commitMessage`, `repoState`, `isFetching`, `isPulling`, `isPushing`, `conflictFiles`, `ahead`, `behind`
- Getters: `stagedFiles`, `unstagedFiles`, `untrackedFiles`, `conflictedFiles`, `hasUncommitted`, `hasConflict`
- Actions (tất cả mock, dùng `await new Promise(r => setTimeout(r, ms))` để mô phỏng latency):
  - `loadStatus()`, `stageFile(path)`, `unstageFile(path)`, `discardFile(path)`
  - `commit(message)`, `amendCommit(message)`
  - `fetch()`, `pull()`, `push()`
  - `createBranch(name, fromRef?)`, `checkoutBranch(name)`, `deleteBranch(name)`
  - `stashSave(message?)`, `stashPop(index)`, `stashApply(index)`, `stashDrop(index)`
  - `loadDiff(path)` → `GitFileDiff`
  - `loadCommit(hash)` → `GitCommit & { files: GitFileDiff[] }`
  - `resolveConflict(path, resolution)` — set `resolution` cho từng block; mark file staged khi all resolved
  - `revertFile(path, commitHash?)`
- Initial mock data: ~30 file thay đổi, 50 commit lịch sử (10 commit có phaseId), 5 branch, 3 stash, 1 remote `origin`. Mô phỏng 1 file conflicted để demo resolver.

**Page** — tạo mới `apps/desktop/ui/pages/git/index.vue`:

- Tab bar trên cùng: Changes | History | Branches | Stash | Remotes
- Layout từng tab theo spec § "UI structure"
- Indicator nhỏ (badge dot) ở tab Changes nếu `hasUncommitted`
- Header chính: branch name dropdown (click → branch picker), ahead/behind count, fetch button

**Components** — tạo trong `apps/desktop/ui/components/git/`:

1. `GitStatusList.vue` — list file kèm checkbox stage, icon status (M/A/D/U/R/C màu khác nhau qua `useTheme()`)
2. `GitDiffViewer.vue` — wrap `monaco-editor` ở mode diff; props `diff: GitFileDiff`, fallback "Binary file" / "No changes"
3. `GitCommitPanel.vue` — textarea message (Monaco markdown), "Stage all" + "Commit" + "Amend" button; preview file count
4. `GitBranchList.vue` — list branch local + remote, click → checkout (confirm modal nếu dirty), context menu rename/delete
5. `GitStashList.vue` — list stash entry, button pop/apply/drop, modal save với message
6. `GitHistoryList.vue` — list commit + author + date + short hash; click → mở `GitCommitDetail` ở pane phải
7. `GitCommitDetail.vue` — show commit message, file changed list, diff viewer; nếu có `phaseId` show badge link (mock route)
8. `GitRemoteList.vue` — list remote, button fetch/push/pull per remote
9. `GitConflictResolver.vue` — Monaco diff 2-way; mỗi conflict block có 2 button "Use ours" / "Use theirs"; "Mark resolved" khi all done
10. `GitOpsToolbar.vue` — toolbar fetch/pull/push với loading state

**Navigation** — sửa `apps/desktop/ui/layouts/default.vue` (hoặc component NavRail tương ứng): thêm icon Git mở route `/git`. Đặt sau Tasks/Workflows/Agents/Skills, trước Settings.

**Theme tokens** — sửa `apps/desktop/ui/utils/themes.ts`: thêm token nếu thiếu:

- `gitAdded` (xanh)
- `gitModified` (vàng)
- `gitDeleted` (đỏ)
- `gitUntracked` (xám)
- `gitConflict` (cam)
- `diffOurs` (xanh nhạt)
- `diffTheirs` (tím nhạt)

Đảm bảo mọi color UI git lấy từ token này, không hardcode hex trong template.

**README** — sửa `apps/desktop/ui/README.md`: thêm bullet route `/git` ở mục "Trạng thái port".

#### 4. Quy tắc bắt buộc tuân thủ

- **Ngôn ngữ:** Code/identifier/log = English. Comment kỹ thuật, JSDoc, doc = tiếng Việt (theo CLAUDE.md).
- **Vue:** `<script setup lang="ts">` only. Cấm Options API.
- **TS:** `strict`, cấm `any`, không `@ts-ignore`. Type-only `defineProps`/`defineEmits`.
- **Pinia:** composition `defineStore('git', () => {...})`. Không gọi store ở module top-level.
- **Tailwind:** layout/spacing/typography qua class. **Mọi màu theme** qua `:style="{ background: t.x }"` từ `useTheme()`. Không hardcode hex.
- **Component dài >250 dòng → tách subcomponent.**
- **Cấm `v-html`** ngoại trừ component dedicated kiểm soát source.
- **Không thêm dependency mới.** Monaco, VueFlow, lucide-vue-next, Pinia đã có. Nếu cần diff parsing dùng tự viết hoặc bỏ qua (mock data dạng `GitFileDiff` đã có sẵn hunks).
- **Không gọi `fetch`/`fs`/`child_process`** ở client. Mock 100% trong store.
- **Naming:** Component `PascalCase.vue`, page `kebab-case.vue`, composable `useXxx.ts`, store file `kebab-case.ts` export `useGitStore`.
- **Event custom:** `kebab-case` (vd `@select-commit`, `@resolve-conflict`).
- **No semicolons** (Prettier `semi: false`), single quote, trailing comma `all`, printWidth 100.

#### 5. Workflow

1. Tạo todo list 8-12 mục theo thứ tự: types → store → theme tokens → page skeleton → components Changes tab → History tab → Branches tab → Stash tab → Remotes tab → Conflict resolver → NavRail → polish.
2. Mark từng todo `in_progress` rồi `completed` ngay khi xong, không batch.
3. Sau khi từng nhóm component xong → chạy `pnpm typecheck` để kịp bắt lỗi.
4. Trước khi báo "xong" — chạy đủ:

   ```bash
   cd /Users/kyro/KyroTech/Projects/awog/apps/desktop/ui
   pnpm lint:fix
   pnpm format
   pnpm typecheck
   pnpm lint
   pnpm dev   # smoke test thủ công, mở http://localhost:3030/git
   ```

   Tất cả phải 0 error. Nếu có warning chưa fix được, ghi rõ trong báo cáo cuối.

5. Smoke test thủ công các flow:
   - Mở `/git` → tab Changes hiện file list mock
   - Click 1 file → diff render bên giữa
   - Stage file → file chuyển sang section "Staged"
   - Gõ commit message → click "Commit" → commit xuất hiện trong History tab
   - Tab Branches → checkout branch khác → toast confirm
   - Tab Stash → save stash → entry xuất hiện
   - Mở file conflicted → resolver hiện 2-way picker → "Use ours" → mark resolved
   - Click Fetch/Pull/Push → toast progress

#### 6. Báo cáo cuối khi xong

Báo cáo có:

- Danh sách file đã tạo/sửa (paths đầy đủ)
- Output `pnpm lint` (số error, warning)
- Output `pnpm typecheck` (pass/fail)
- Screenshot mô tả (text) các tab đã hoạt động
- AC trong spec § "Acceptance Criteria" — đánh dấu cái nào prototype này cover, cái nào skip vì cần sidecar thật (vd push auth)
- Open question phát sinh khi code

#### 7. Edge case xử lý trong prototype

- Empty repo state (no commit) — show empty state "No commits yet"
- `repoState === 'no-repo'` — show CTA "Initialize git repository" (mock, chỉ chuyển state sang `clean`)
- Mock 1 file `binary.png` để test fallback diff viewer
- Mock workspace dirty + click checkout branch → modal "You have uncommitted changes. Stash | Discard | Cancel"
- Mock conflict file để demo resolver
- Path có unicode/emoji trong mock data để verify hiển thị

#### 8. Cấm tuyệt đối

- ❌ Thêm dependency vào `package.json` (nếu thực sự cần, dừng lại hỏi user trước).
- ❌ Sửa file ngoài `apps/desktop/ui/` và `docs/features/git-manager.md` (chỉ thêm checkbox AC, không sửa logic).
- ❌ Tạo file markdown mới ngoài README update.
- ❌ Implement IPC/sidecar thật.
- ❌ Hardcode màu hex trong template/style.
- ❌ Tắt rule lint hoặc dùng `@ts-ignore`.
- ❌ Commit code tự ý — chỉ dừng lại báo cáo, để user review và commit.

#### 9. Khi gặp vướng

- Nếu spec mâu thuẫn với pattern code hiện tại → ưu tiên pattern code, ghi note đề xuất sửa spec.
- Nếu cần dependency mới → dừng lại hỏi user.
- Nếu Monaco diff khó wire → fallback render diff bằng HTML đơn giản (3 cột: line, +/-, text), ghi TODO chuyển Monaco sau.
- Nếu typecheck fail không tự fix được sau 3 lần thử → dừng, báo cáo error gốc, đừng workaround bằng `any`.

#### 10. Output mong đợi

Một bản prototype `/git` có thể demo cho stakeholder mà không cần sidecar, sẵn sàng cho QA viết test case dựa vào spec, và sẵn sàng cho Tech Lead refactor wire vào sidecar khi sidecar có.

### PROMPT KẾT THÚC

---

## Mở rộng tương lai (KHÔNG đưa vào prompt prototype)

Khi sidecar có và muốn convert prototype thành real:

1. Tạo `apps/desktop/ui/composables/useGitApi.ts` wrap IPC call.
2. Sửa `stores/git.ts`: thay mock `setTimeout` bằng `await useGitApi().X()`.
3. Wire streaming event `git:fetch:progress` qua IPC bus.
4. Conflict resolver chuyển từ 2-way mock sang 3-way với base từ `git merge-base`.
5. Cross-link Agent Trace: tạo composable `useCommitTraceLink()` lookup `phaseId` từ commit message và navigate.

Tham chiếu spec § "Sidecar IPC contract" cho list 21 RPC method cần wire.
