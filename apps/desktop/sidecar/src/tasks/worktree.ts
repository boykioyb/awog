// Cô lập working tree cho một lượt chạy agent (ADR 0081, tổng quát hoá ở gói #7c).
//
// Vấn đề gốc: scheduler chạy tới CONCURRENCY_CAP node cùng lúc, nhưng trước đây
// mọi node đều lấy `project.path` làm cwd — hai agent sửa cùng một cây làm việc,
// rồi `git add -A` của node này quét luôn file dở dang của node kia. Đây là tranh
// chấp thật, không phải thiếu tính năng. Subagent chat song song (ADR 0083 §b)
// có ĐÚNG tranh chấp đó, chỉ khác chủ sở hữu.
//
// ── Khoá theo OWNER, không khoá theo task ───────────────────────────────────
// Mọi đường của module này (thư mục checkout, neo nhánh, tiền tố branch, VÀ
// sweeper) đi qua một khoá duy nhất:
//
//   WorkspaceOwner = { kind: 'task' | 'session', id }
//
//   | | thư mục owner | tiền tố branch |
//   |---|---|---|
//   | task    | `~/.awog/tasks/<taskId>/`                | `awog/task/<taskId>/`    |
//   | session | `~/.awog/session-worktrees/<sessionId>/` | `awog/session/<sessionId>/` |
//
// Checkout nằm ở `<ownerDir>/worktrees/<slug>`, neo nhánh ở `<ownerDir>/worktree-base`,
// repo đã cấp worktree ở `<ownerDir>/worktree-repo`. Layout của `task` giữ NGUYÊN
// như ADR 0081 nên không cần migration; `session` chỉ là một owner thứ hai cùng
// hình dạng. `sweepOrphanWorktrees()` quét `listOwners()` — CẢ HAI loại — nên
// không có loại owner nào rơi ra ngoài lưới dọn mồ côi.
//
// ── Ba chính sách cấp phát ──────────────────────────────────────────────────
//   • `shared`      — không bao giờ cô lập (node Task tắt auto-commit per-phase).
//   • `first-claim` — node in-flight ĐẦU TIÊN của project giữ cây gốc, phần còn
//     lại vào worktree riêng. DAG tuần tự (đại đa số) chạy y hệt như trước.
//   • `always`      — luôn cô lập (subagent chat): cây gốc đang là cwd của chính
//     lượt cha, không có chuyện "giành chỗ đầu tiên".
//
// ── Gộp kết quả: CHỈ Task ───────────────────────────────────────────────────
// `integrateTaskBranches()` nhận `taskId` (không nhận owner) — cố ý: merge vào
// nhánh người dùng đang checkout là hành động Task đã có công tắc (auto-commit
// per-phase) và có điểm ráo để chạy. Một lượt chat KHÔNG có công tắc nào như thế,
// nên branch của subagent chỉ được cô lập và giao lại cho người dùng, không bao
// giờ tự merge. Ràng buộc đó là KIỂU, không phải quy ước: không có cách nào gọi
// hàm merge cho một owner `session`.
//
// Danh sách branch cần merge được DERIVE TỪ GIT (`for-each-ref` theo prefix),
// không giữ trong bộ nhớ → sống sót qua restart.
//
// Degrade an toàn: không phải git repo / git < 2.20 / `worktree add` fail ⇒ quay
// về dùng chung cây gốc như cũ và log rõ ràng. Lượt chạy vẫn tiếp tục.
//
// Hai lưới an toàn chống mất dữ liệu (đính chính F8 của ADR 0081) — áp cho MỌI
// owner:
//   • KHÔNG xoá mù. Trước khi bỏ một checkout (release cuối lượt, hoặc sweep ở
//     boot) ta hỏi `git status --porcelain`. Còn thay đổi ⇒ commit WIP lên chính
//     branch của lượt đó; commit WIP cũng hỏng ⇒ GIỮ NGUYÊN checkout và báo lên
//     UI. Không có đường nào xoá một cây còn việc chưa lưu.
//   • Merge phải hạ cánh ĐÚNG nhánh. Nhánh đang checkout lúc cấp worktree đầu
//     tiên được ghi xuống `<ownerDir>/worktree-base`; lúc ráo, HEAD lệch nhánh đó
//     (người dùng tự `git checkout` giữa chừng) ⇒ KHÔNG merge, báo conflict để
//     engine pause. AWOG không checkout hộ người dùng.
//
// Branch rỗng thì không để lại rác: lúc release ta thử `git branch -d` (KHÔNG
// bao giờ `-D`). Git tự từ chối xoá branch còn commit chưa nằm trong HEAD, nên
// đây là guarantee của git chứ không phải phán đoán của AWOG: cô lập một lượt
// chỉ-đọc không để lại dấu vết nào, còn một lượt có sửa file thì branch còn nguyên.
//
// ── Member của một Session Team (docs/features/session-teams.md §4–§5) ──────
// Một đường owner `session` THỨ HAI sống cạnh đường subagent ở trên: member của
// một nhóm phiên giữ MỘT worktree + MỘT branch (`<ownerDir>/worktrees/team`,
// `awog/session/<id>/team`) suốt MEMBERSHIP — cấp lười ở lượt đầu
// (`ensureSessionWorkspace`), nhả khi rời nhóm/lưu trữ/xoá
// (`releaseSessionWorkspace`), KHÔNG theo hết lượt như subagent. Khác hành vi
// ở ba điểm có chủ đích:
//   • Detached HEAD KHÔNG degrade: worktree chỉ cần một điểm neo, baseRef lúc đó
//     là SHA (integrate sẽ từ chối vì không có nhánh nào để merge vào).
//   • Nhả worktree thì GIỮ branch kể cả rỗng — merge/xoá là nút bấm của người
//     dùng (`sessions.integrateMember`), không phải dọn dẹp tự động.
//   • `integrateSessionBranch` merge MỘT branch của MỘT member khi người dùng
//     bấm — cổng của Session Teams; ranh giới "chat không tự merge" ở trên vẫn
//     nguyên vì đường này chỉ chạy từ một RPC do người dùng gọi.

import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gitAtLeast, runGit } from '../git/runner.js'
import { GitErrorCode, mapStderrToCode, sanitizeStderr } from '../git/error-map.js'
import type { RunGitResult } from '../git/runner.js'
import { withWorkspaceLock } from '../git/mutex.js'
import { suppressEchoFor } from '../git/watcher.js'
import { assertValidBranchName } from '../git/ref-validate.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import { awogHome, sanitizeChild } from '../util/path.js'
import { listTaskIds, loadTask, taskDir } from './store.js'
import type { SessionWorktree } from '../types/shared.js'

// `git worktree` tồn tại từ 2.5 nhưng `worktree list --porcelain` + `remove` chỉ
// ổn định từ 2.17/2.20; 2.20 cũng đúng bằng mức Git Manager đang yêu cầu (ADR 0017)
// nên không phải giải thích cho người dùng thêm một ngưỡng thứ hai.
const MIN_GIT_VERSION = '2.20'
const WORKTREES_DIR = 'worktrees'
// Nhà của owner loại `session`. Nằm cạnh `tasks/` chứ không nằm TRONG nó: một
// thư mục con của `~/.awog/tasks/` sẽ bị `listTaskIds()` (và mọi thứ đọc store
// Task) nhìn thấy như một task ma.
const SESSION_OWNERS_DIR = 'session-worktrees'
// Gốc namespace branch: nhận diện được bằng mắt, và là khoá để tìm lại branch
// cần merge sau restart. Không được đổi mà không viết migration.
const BRANCH_ROOT = 'awog'
// `worktree add` phải checkout cả cây — repo lớn có thể lâu hơn 30s mặc định.
const WORKTREE_TIMEOUT_MS = 120_000
const REPO_LOCK_TIMEOUT_MS = 60_000
// Nhánh mà owner neo vào, ghi lúc cấp worktree ĐẦU TIÊN. Nằm trong thư mục owner
// của AWOG (không đụng `.git/config` của người dùng) và bền qua restart — merge
// ở điểm ráo phải đối chiếu với nó.
const BASE_BRANCH_FILE = 'worktree-base'
// Repo đã cấp worktree cho owner này. Sweeper ở boot cần nó để `worktree prune`
// đúng repo — với owner `session` thì đây là nguồn DUY NHẤT (một phiên chat không
// bắt buộc thuộc project nào).
const REPO_FILE = 'worktree-repo'
// Độ dài tối đa của stderr git đưa lên UI (đã qua sanitizeStderr trước khi cắt).
const DETAIL_MAX_LEN = 500

// Ai sở hữu checkout này. `task` = một node của Task Execution Engine (ADR 0081);
// `session` = một subagent trong một lượt chat (ADR 0083 §c).
export interface WorkspaceOwner {
  kind: 'task' | 'session'
  id: string
}

// Cách cấp phát cây làm việc cho một lượt chạy.
export type IsolationPolicy =
  // Không bao giờ cô lập — dùng chung cây gốc (node Task tắt auto-commit per-phase).
  | 'shared'
  // Lượt in-flight đầu tiên của project giữ cây gốc, phần còn lại vào worktree.
  | 'first-claim'
  // Luôn cô lập — cây gốc đã có chủ (lượt chat cha) nên không giành.
  | 'always'

export interface IsolatedWorkspace {
  // cwd cho agent + cho auto-commit của lượt chạy.
  cwd: string
  // true = worktree riêng; false = dùng chung cây gốc của project.
  isolated: boolean
  // Branch của worktree (chỉ khi isolated).
  branch?: string
  // Repo chính đã cấp worktree. Giữ lại vì `rev-parse --show-toplevel` chạy TRONG
  // một linked worktree trả về chính worktree đó, không phải repo mẹ — dọn dẹp mà
  // hỏi lại git thì sẽ prune nhầm chỗ.
  repoRoot?: string
  // Khoá claim cây gốc — release() dùng để nhả.
  claimKey: string
}

// Kết quả nhả cây làm việc. 'retained' = còn việc chưa lưu mà cũng không commit
// WIP được ⇒ checkout CÒN NGUYÊN trên đĩa, caller phải báo lên UI.
export type ReleaseStatus = 'clean' | 'rescued' | 'retained'

export interface ReleaseOutcome {
  status: ReleaseStatus
  // Branch của lượt chạy — CHỈ set khi nó còn tồn tại sau release, tức là nó mang
  // commit chưa nằm trong HEAD. Branch rỗng đã bị `git branch -d` dọn ⇒ không có
  // gì để nói với người dùng.
  branch?: string
  // Đường dẫn checkout được giữ lại (chỉ khi 'retained').
  path?: string
  // Thông điệp đã sanitize, đủ để người dùng biết phải làm gì.
  detail?: string
}

export type IntegrationStatus = 'merged' | 'conflict'

export interface IntegrationOutcome {
  branch: string
  status: IntegrationStatus
  // Thông điệp đã sanitize (stderr của git đã qua error-map ở runner).
  detail?: string
}

// Lượt chạy đang giữ cây gốc của mỗi project. Claim đặt ĐỒNG BỘ ở đầu
// acquireWorkspace nên hai lượt dispatch trong cùng một tick không thể cùng
// nhận cây gốc (giống cách git/mutex.ts claim đồng bộ).
const sharedClaims = new Map<string, string>()

// Ký tự an toàn cho tên branch + tên thư mục. Id nội bộ (taskId/nodeId/sessionId)
// về lý thuyết là do AWOG sinh, nhưng nodeId đến từ workflow snapshot người dùng
// sửa được ⇒ vẫn coi là L1 và chuẩn hoá trước khi ghép vào ref/path.
function safeSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'run'
}

// Repo root chứa `dir`, hoặc null khi `dir` không nằm trong repo git nào.
async function resolveRepoRoot(dir: string): Promise<string | null> {
  try {
    const res = await runGit(dir, ['rev-parse', '--show-toplevel'], { throwOnNonZero: false })
    const root = res.stdout.trim()
    return res.code === 0 && root.length > 0 ? root : null
  } catch {
    return null
  }
}

// Thư mục AWOG của owner. Task tái dùng đúng thư mục task sẵn có (không migration);
// session có nhà riêng cạnh `tasks/`.
function ownerDir(owner: WorkspaceOwner): string {
  return owner.kind === 'task'
    ? taskDir(owner.id)
    : join(awogHome(), SESSION_OWNERS_DIR, sanitizeChild(owner.id))
}

function worktreeRoot(owner: WorkspaceOwner): string {
  return join(ownerDir(owner), WORKTREES_DIR)
}

function baseBranchFile(owner: WorkspaceOwner): string {
  return join(ownerDir(owner), BASE_BRANCH_FILE)
}

function repoFile(owner: WorkspaceOwner): string {
  return join(ownerDir(owner), REPO_FILE)
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

// Nhánh đang checkout của repo; null khi HEAD detached (hoặc git lỗi).
async function currentBranch(repoRoot: string): Promise<string | null> {
  try {
    const res = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      throwOnNonZero: false,
    })
    const name = res.stdout.trim()
    return res.code === 0 && name.length > 0 ? name : null
  } catch {
    return null
  }
}

async function readTrimmed(path: string): Promise<string | null> {
  try {
    const value = (await readFile(path, 'utf8')).trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

async function readBaseBranch(owner: WorkspaceOwner): Promise<string | null> {
  return readTrimmed(baseBranchFile(owner))
}

// Ghi neo MỘT LẦN cho mỗi đợt cô lập, TRƯỚC khi branch đầu tiên tồn tại — không
// bao giờ có branch chờ merge mà thiếu neo. Neo được xoá khi mọi branch của owner
// đã merge xong, nên lần resume sau (có thể trên nhánh khác) neo lại đúng nhánh
// lúc đó. Ghi kèm repo root để sweeper ở boot biết prune ở đâu.
async function rememberAnchor(
  owner: WorkspaceOwner,
  branch: string,
  repoRoot: string,
): Promise<void> {
  await mkdir(ownerDir(owner), { recursive: true, mode: 0o700 })
  await writeFile(repoFile(owner), `${repoRoot}\n`, { encoding: 'utf8', mode: 0o600 })
  if (await readBaseBranch(owner)) return
  await writeFile(baseBranchFile(owner), `${branch}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function clearBaseBranch(owner: WorkspaceOwner): Promise<void> {
  await rm(baseBranchFile(owner), { force: true }).catch(() => undefined)
}

// Prefix branch của MỘT owner — cũng là namespace `for-each-ref` quét khi tìm
// branch cần merge. `awog/task/<id>/` giữ nguyên như ADR 0081.
function branchPrefix(owner: WorkspaceOwner): string {
  return `${BRANCH_ROOT}/${owner.kind}/${safeSegment(owner.id)}/`
}

export interface AcquireArgs {
  owner: WorkspaceOwner
  // Nhãn lá của checkout + branch: `<nodeId>-vN` với Task, id subagent với chat.
  slug: string
  // Cây làm việc gốc — `project.path` (Task) hoặc cwd của phiên (chat). Do sidecar
  // đọc từ store / cấu hình phiên, KHÔNG nhận path từ payload UI.
  projectPath: string
  policy: IsolationPolicy
}

// Cấp workspace cho một lượt chạy. Luôn trả về một workspace dùng được: nhánh
// degrade rơi về `projectPath` y như hành vi cũ.
export async function acquireWorkspace(args: AcquireArgs): Promise<IsolatedWorkspace> {
  const { owner, slug, projectPath, policy } = args
  const holder = `${owner.kind}:${owner.id}:${slug}`

  // Claim đồng bộ — không await trước dòng này.
  if (policy === 'first-claim' && !sharedClaims.has(projectPath)) {
    sharedClaims.set(projectPath, holder)
    return { cwd: projectPath, isolated: false, claimKey: projectPath }
  }

  const degrade = (reason: string): IsolatedWorkspace => {
    log.warn('isolated worktree unavailable — sharing the project tree', {
      owner: holder,
      reason,
    })
    return { cwd: projectPath, isolated: false, claimKey: '' }
  }

  if (policy === 'shared') return degrade('isolation-not-requested')
  const repoRoot = await resolveRepoRoot(projectPath)
  if (!repoRoot) return degrade('not-a-git-repo')
  if (!(await gitAtLeast(MIN_GIT_VERSION))) return degrade(`git-older-than-${MIN_GIT_VERSION}`)
  // HEAD detached ⇒ không có nhánh nào để neo, mà merge vào một HEAD rời cũng
  // không phải thứ người dùng chờ đợi. Quay về cây gốc: đúng bằng hành vi khi
  // chưa có ADR 0081, không tệ hơn.
  const base = await currentBranch(repoRoot)
  if (!base) return degrade('detached-head')

  const leaf = sanitizeChild(safeSegment(slug))
  const dir = join(worktreeRoot(owner), leaf)
  const branch = `${branchPrefix(owner)}${leaf}`
  try {
    assertValidBranchName(branch)
    await mkdir(worktreeRoot(owner), { recursive: true, mode: 0o700 })
    await rememberAnchor(owner, base, repoRoot)
    // Serialise với auto-commit + Git Manager trên cùng repo: `worktree add` ghi
    // vào `.git` (refs + metadata) nên không được chạy song song với một mutator.
    await withWorkspaceLock(
      repoRoot,
      () =>
        runGit(repoRoot, ['worktree', 'add', '-b', branch, dir, 'HEAD'], {
          timeoutMs: WORKTREE_TIMEOUT_MS,
        }),
      { timeoutMs: REPO_LOCK_TIMEOUT_MS },
    )
  } catch (err) {
    // Dọn phần dang dở để lần sau không vướng "directory already exists".
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return degrade(err instanceof Error ? err.message : String(err))
  }

  log.info('run isolated in its own worktree', { owner: holder, branch })
  return { cwd: dir, isolated: true, branch, repoRoot, claimKey: '' }
}

type RescueResult =
  | { kind: 'clean' }
  | { kind: 'rescued'; files: number }
  | { kind: 'retained'; detail: string }

// Auto-commit BẬT chỉ nói commit ĐƯỢC PHÉP, không nói commit ĐÃ XẢY RA: lượt chạy
// fail giữa chừng, hook `pre-commit` chặn, `add` trượt… đều để lại một cây còn
// việc mà không có commit nào. Xoá checkout lúc đó là mất trắng, không hồi lại
// được. Với subagent chat thì còn chắc chắn hơn: chat KHÔNG có auto-commit, nên
// lưới này là đường duy nhất giữ lại việc agent vừa làm.
//
// Nên trước mọi lần bỏ checkout: còn thay đổi ⇒ gom vào MỘT commit WIP trên chính
// branch của lượt chạy. Commit rescue cố tình bỏ qua hook và ký GPG — nó là lưới
// an toàn, không phải commit "đẹp"; để một hook chặn nó thì lại quay về đúng chỗ
// mất dữ liệu.
async function rescueDirtyCheckout(dir: string, branch: string): Promise<RescueResult> {
  const fail = (raw: string): RescueResult => ({
    kind: 'retained',
    detail: sanitizeStderr(raw).trim().slice(0, DETAIL_MAX_LEN),
  })

  let status: RunGitResult
  try {
    status = await runGit(dir, ['status', '--porcelain'], { throwOnNonZero: false })
  } catch (err) {
    // Không dò được trạng thái: thư mục đã biến mất thì không còn gì để cứu;
    // còn tồn tại mà git không trả lời thì giữ lại — chưa biết bên trong có gì.
    if (!(await pathExists(dir))) return { kind: 'clean' }
    return fail(err instanceof Error ? err.message : String(err))
  }
  if (status.code !== 0) {
    // Không phải worktree git (metadata đã bị prune, hoặc thư mục rác trong
    // `worktrees/`): không có branch nào để commit lên ⇒ coi như dọn được, đúng
    // bằng hành vi cũ. Mọi lỗi git KHÁC thì giữ lại, đừng đoán.
    if (mapStderrToCode(status.stderr) === GitErrorCode.NO_REPO) return { kind: 'clean' }
    return fail(status.stderr || status.stdout)
  }

  const files = status.stdout.split('\n').filter((l) => l.trim().length > 0).length
  if (files === 0) return { kind: 'clean' }

  const add = await runGit(dir, ['add', '-A'], { throwOnNonZero: false })
  if (add.code !== 0) return fail(add.stderr || add.stdout)
  const message = `WIP: rescued uncommitted work from branch ${branch}`
  const commit = await runGit(dir, ['commit', '--no-verify', '--no-gpg-sign', '-m', message], {
    throwOnNonZero: false,
  })
  if (commit.code !== 0) return fail(commit.stderr || commit.stdout)
  return { kind: 'rescued', files }
}

// Thử bỏ một branch KHÔNG mang việc riêng. `-d` (không bao giờ `-D`) là guarantee
// của chính git: nó từ chối khi branch còn commit chưa nằm trong HEAD. Nên lượt
// chỉ-đọc không để lại branch rác, còn lượt có sửa file thì branch còn nguyên và
// được trả về cho caller báo lên UI. Trả true khi đã xoá.
async function dropBranchIfContained(repoRoot: string, branch: string): Promise<boolean> {
  try {
    const res = await runGit(repoRoot, ['branch', '-d', branch], { throwOnNonZero: false })
    return res.code === 0
  } catch {
    return false
  }
}

// Nhả workspace khi lượt chạy kết thúc (thành công hay không). Cây sạch ⇒ checkout
// bị xoá ngay để không tích rác; commit của lượt vẫn sống trên branch. Cây còn
// việc chưa lưu ⇒ commit WIP trước (xem rescueDirtyCheckout); cứu không được ⇒
// KHÔNG xoá gì cả, trả 'retained' để caller báo lên UI.
export async function releaseWorkspace(
  owner: WorkspaceOwner,
  ws: IsolatedWorkspace,
): Promise<ReleaseOutcome> {
  if (!ws.isolated) {
    if (ws.claimKey) sharedClaims.delete(ws.claimKey)
    return { status: 'clean' }
  }
  const branch = ws.branch ?? ''
  const rescue = await rescueDirtyCheckout(ws.cwd, branch || '(unknown)')
  if (rescue.kind === 'retained') {
    log.error('worktree kept — uncommitted work could not be rescued', {
      owner: `${owner.kind}:${owner.id}`,
      dir: ws.cwd,
      branch,
      detail: rescue.detail,
    })
    return {
      status: 'retained',
      ...(branch ? { branch } : {}),
      path: ws.cwd,
      ...(rescue.detail ? { detail: rescue.detail } : {}),
    }
  }
  if (rescue.kind === 'rescued') {
    log.warn('run left uncommitted work — committed as WIP before releasing the worktree', {
      owner: `${owner.kind}:${owner.id}`,
      branch,
      files: rescue.files,
    })
  }
  const repoRoot = ws.repoRoot
  let branchKept = branch.length > 0
  try {
    if (repoRoot) {
      await withWorkspaceLock(
        repoRoot,
        async () => {
          await runGit(repoRoot, ['worktree', 'remove', '--force', ws.cwd], {
            throwOnNonZero: false,
            timeoutMs: WORKTREE_TIMEOUT_MS,
          })
          await runGit(repoRoot, ['worktree', 'prune'], { throwOnNonZero: false })
          // Sau `remove` mới xoá được: git từ chối bỏ branch còn checkout ở một
          // linked worktree.
          if (branch) branchKept = !(await dropBranchIfContained(repoRoot, branch))
        },
        { timeoutMs: REPO_LOCK_TIMEOUT_MS },
      )
    }
  } catch (err) {
    log.warn('worktree remove failed (sweeper will retry at boot)', {
      owner: `${owner.kind}:${owner.id}`,
      dir: ws.cwd,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  // `remove` có thể bỏ lại thư mục — xoá thẳng. An toàn vì tới đây cây đã sạch
  // (hoặc mọi thay đổi đã nằm trong commit WIP trên branch).
  await rm(ws.cwd, { recursive: true, force: true }).catch(() => undefined)
  return {
    status: rescue.kind === 'rescued' ? 'rescued' : 'clean',
    ...(branchKept && branch ? { branch } : {}),
  }
}

// Liệt kê branch còn tồn của một owner — nguồn sự thật là git, nên restart không
// làm mất dấu công việc đã commit trong worktree.
async function listOwnerBranches(repoRoot: string, owner: WorkspaceOwner): Promise<string[]> {
  const prefix = branchPrefix(owner)
  const res = await runGit(
    repoRoot,
    ['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`],
    { throwOnNonZero: false },
  )
  if (res.code !== 0) return []
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith(prefix))
}

// Merge mọi branch node của MỘT TASK về nhánh hiện tại của repo. CHỈ được gọi khi
// task đã ráo (không node nào đang chạy) — lúc đó cây gốc không có ai ghi vào.
//
// Nhận `taskId` chứ không nhận `WorkspaceOwner`: merge vào cây làm việc của người
// dùng là hành động của Task (có công tắc auto-commit per-phase, có điểm ráo).
// Một lượt chat không có công tắc nào như thế nên branch của subagent KHÔNG bao
// giờ đi qua đây — ràng buộc bằng kiểu, không bằng quy ước.
//
// Conflict ⇒ `merge --abort`, GIỮ branch, báo lên caller. Engine dừng task có
// trật tự để người dùng tự merge; AWOG không đoán hộ khi hai node song song sửa
// cùng một chỗ.
export async function integrateTaskBranches(
  taskId: string,
  projectPath: string,
): Promise<IntegrationOutcome[]> {
  const owner: WorkspaceOwner = { kind: 'task', id: taskId }
  const repoRoot = await resolveRepoRoot(projectPath)
  if (!repoRoot) return []
  let branches: string[]
  try {
    branches = await listOwnerBranches(repoRoot, owner)
  } catch (err) {
    log.warn('listing task node branches failed', {
      taskId,
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
  if (branches.length === 0) {
    // Không còn gì chờ merge ⇒ nhả neo, để đợt cô lập sau neo lại đúng nhánh
    // người dùng đang đứng lúc đó.
    await clearBaseBranch(owner)
    return []
  }

  // `git merge` hạ cánh xuống HEAD hiện tại. Người dùng lỡ `git checkout` giữa
  // lúc task chạy thì HEAD không còn là nhánh task đã neo — merge lúc đó đổ commit
  // của agent xuống nhầm nhánh. Lệch ⇒ không merge, báo conflict để engine pause;
  // AWOG không checkout hộ người dùng.
  const expected = await readBaseBranch(owner)
  if (expected) {
    const head = await currentBranch(repoRoot)
    if (head !== expected) {
      const where = head ? `nhánh "${head}"` : 'HEAD detached'
      const detail =
        `Repo đang ở ${where} nhưng task neo vào nhánh "${expected}" — bỏ qua merge ` +
        `${branches.length} branch để commit không hạ cánh nhầm nhánh. Checkout lại ` +
        `"${expected}" rồi Resume, hoặc merge tay: ${branches.join(', ')}`
      log.warn('task branch integration skipped — repo HEAD is not the anchored branch', {
        taskId,
        expected,
        head,
        branches: branches.length,
      })
      const first = branches[0] as string
      return [{ branch: first, status: 'conflict', detail }]
    }
  } else {
    // Task bắt đầu trước bản vá này (chưa có neo): giữ hành vi cũ, chỉ log.
    log.warn('task node branches have no anchored base branch — merging into current HEAD', {
      taskId,
      branches: branches.length,
    })
  }

  const outcomes: IntegrationOutcome[] = []
  for (const branch of branches) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await mergeOne(repoRoot, taskId, branch)
    outcomes.push(outcome)
    if (outcome.status === 'conflict') break // dừng ở conflict đầu tiên
  }
  if (outcomes.every((o) => o.status === 'merged')) await clearBaseBranch(owner)
  return outcomes
}

async function mergeOne(
  repoRoot: string,
  taskId: string,
  branch: string,
): Promise<IntegrationOutcome> {
  const message = `Merge task node branch ${branch}`
  try {
    return await withWorkspaceLock(
      repoRoot,
      async () => {
        suppressEchoFor(repoRoot)
        const merge = await runGit(repoRoot, ['merge', '--no-edit', '-m', message, branch], {
          throwOnNonZero: false,
        })
        if (merge.code !== 0) {
          // Huỷ merge dở (no-op khi merge chưa kịp bắt đầu).
          await runGit(repoRoot, ['merge', '--abort'], { throwOnNonZero: false })
          // Cùng sanitizer với đường RPC (`git/runner.ts`): stderr thô có thể mang
          // token nhúng trong URL remote và path tuyệt đối, mà detail này đi thẳng
          // lên UI qua event `task.worktree`.
          const detail = sanitizeStderr(merge.stderr || merge.stdout)
            .trim()
            .slice(0, DETAIL_MAX_LEN)
          log.warn('task node branch merge conflicted — branch kept for manual merge', {
            taskId,
            branch,
            detail,
          })
          return { branch, status: 'conflict' as const, ...(detail ? { detail } : {}) }
        }
        // Merge xong mới xoá branch; `-d` từ chối khi chưa merge hết ⇒ an toàn.
        await runGit(repoRoot, ['branch', '-d', branch], { throwOnNonZero: false })
        log.info('task node branch merged', { taskId, branch })
        return { branch, status: 'merged' as const }
      },
      { timeoutMs: REPO_LOCK_TIMEOUT_MS },
    )
  } catch (err) {
    const detail = sanitizeStderr(err instanceof Error ? err.message : String(err))
      .trim()
      .slice(0, DETAIL_MAX_LEN)
    log.warn('task node branch merge failed', { taskId, branch, detail })
    return { branch, status: 'conflict', detail }
  }
}

// Mọi owner có thể còn checkout trên đĩa. Sweeper PHẢI quét đủ cả hai loại —
// bỏ sót một loại là đẻ lại đúng lỗi mồ côi mà ADR 0081 vừa vá, chỉ dưới một cái
// tên khác.
async function listOwners(): Promise<WorkspaceOwner[]> {
  const owners: WorkspaceOwner[] = []
  try {
    for (const id of await listTaskIds()) owners.push({ kind: 'task', id })
  } catch (err) {
    log.warn('worktree sweep: listing tasks failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    for (const id of await readdir(join(awogHome(), SESSION_OWNERS_DIR))) {
      owners.push({ kind: 'session', id })
    }
  } catch {
    /* chưa phiên chat nào dùng worktree */
  }
  return owners
}

// Dọn checkout mồ côi ở boot: sidecar chết giữa lượt chạy để lại thư mục worktree
// + metadata trong `.git`. Đây cũng là một đường xoá hàng loạt, nên nó đi qua
// ĐÚNG lưới an toàn của release: cây nào còn việc chưa lưu thì commit WIP trước,
// cứu không được thì giữ nguyên (lần boot sau thử lại). Xong mới `worktree prune`
// và thử bỏ branch rỗng bằng `git branch -d` (git tự từ chối branch còn việc).
// Branch còn commit KHÔNG bị xoá — đó là công sức của agent; task merge nó ở điểm
// ráo, còn phiên chat thì để người dùng tự lấy.
export async function sweepOrphanWorktrees(): Promise<number> {
  const owners = await listOwners()
  let removed = 0
  for (const owner of owners) {
    const root = worktreeRoot(owner)
    let entries: string[]
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(root)
    } catch {
      continue // owner không dùng worktree
    }
    const swept: string[] = []
    for (const entry of entries) {
      // Checkout `team` của member Session Team sống theo MEMBERSHIP, không theo
      // lượt chạy — nó không bao giờ là đồ mồ côi của một lượt chết dở. Chỉ
      // releaseSessionWorkspace (rời nhóm/lưu trữ/xoá) được động vào nó; sweeper
      // quét đây sẽ xoá oan cây còn sống của member mỗi lần boot.
      if (owner.kind === 'session' && entry === TEAM_SLUG) continue
      const dir = join(root, entry)
      // eslint-disable-next-line no-await-in-loop
      const rescue = await rescueDirtyCheckout(dir, entry)
      if (rescue.kind === 'retained') {
        log.error('orphan worktree kept — uncommitted work could not be rescued', {
          owner: `${owner.kind}:${owner.id}`,
          dir,
          detail: rescue.detail,
        })
        continue
      }
      if (rescue.kind === 'rescued') {
        log.warn('orphan worktree had uncommitted work — committed as WIP before sweeping', {
          owner: `${owner.kind}:${owner.id}`,
          dir,
          files: rescue.files,
        })
      }
      // eslint-disable-next-line no-await-in-loop
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      swept.push(entry)
      removed += 1
    }
    // Chỉ xoá thư mục cha khi đã rỗng — checkout giữ lại phải sống sót.
    // eslint-disable-next-line no-await-in-loop
    await rmdir(root).catch(() => undefined)
    // eslint-disable-next-line no-await-in-loop
    const repoRoot = await repoRootOfOwner(owner)
    if (!repoRoot) continue
    try {
      // eslint-disable-next-line no-await-in-loop
      await runGit(repoRoot, ['worktree', 'prune'], { throwOnNonZero: false })
      const prefix = branchPrefix(owner)
      for (const entry of swept) {
        // eslint-disable-next-line no-await-in-loop
        await dropBranchIfContained(repoRoot, `${prefix}${safeSegment(entry)}`)
      }
    } catch {
      /* prune là dọn dẹp cơ hội — thất bại không chặn boot */
    }
  }
  if (removed > 0) log.info('swept orphan worktrees', { removed })
  return removed
}

// Repo đã cấp worktree cho owner. Nguồn chính là file neo `worktree-repo` (ghi
// lúc acquire, đúng cho cả hai loại owner); owner `task` của bản trước bản vá này
// chưa có file đó nên fall back về project của task.
async function repoRootOfOwner(owner: WorkspaceOwner): Promise<string | null> {
  const remembered = await readTrimmed(repoFile(owner))
  if (remembered) {
    const root = await resolveRepoRoot(remembered)
    if (root) return root
  }
  if (owner.kind !== 'task') return null
  try {
    const task = await loadTask(owner.id)
    if (!task) return null
    const project = await loadProject(task.projectId)
    if (!project?.path) return null
    return resolveRepoRoot(project.path)
  } catch {
    return null
  }
}

// ─── Session Teams: worktree THEO MEMBERSHIP của member ──────────────────────
// (docs/features/session-teams.md §4–§5, ADR 0094 — xem thêm đầu file)
//
// Slug cố định của checkout + branch: một phiên = một worktree duy nhất cho cả
// thời gian ở trong nhóm, nên không cần hậu tố phiên bản như node Task.
const TEAM_SLUG = 'team'
// Trần diff đưa lên UI / vào context model qua `member_diff` — đủ đọc được một
// lượt sửa đáng kể mà không ném cả diff khổng lồ vào transcript.
const MEMBER_DIFF_MAX_CHARS = 8000

// SHA của HEAD — neo dự phòng cho trường hợp repo đang detached: member vẫn
// được cấp cây riêng (worktree chỉ cần một điểm neo chứ không cần nhánh), nhưng
// integrate sau đó sẽ báo base-not-checked-out vì không có nhánh đích.
async function headSha(repoRoot: string): Promise<string | null> {
  try {
    const res = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], {
      throwOnNonZero: false,
    })
    const sha = res.stdout.trim()
    return res.code === 0 && sha.length > 0 ? sha : null
  } catch {
    return null
  }
}

// Probe xem một thư mục có phải checkout git còn sống không — dùng để nhận ra
// worktree đã cấp từ trước (idempotent) và phân biệt nó với thư mục rác.
async function isLiveCheckout(dir: string): Promise<boolean> {
  try {
    const res = await runGit(dir, ['rev-parse', '--is-inside-work-tree'], {
      throwOnNonZero: false,
    })
    return res.code === 0 && res.stdout.trim() === 'true'
  } catch {
    return false
  }
}

// Dựng lại bản ghi worktree của member cho một checkout ĐÃ tồn tại trên đĩa
// (đường idempotent của ensureSessionWorkspace): đọc lại neo `worktree-base` /
// `worktree-repo` thay vì tính lại — chúng là sự thật đã ghi lúc cấp.
async function rememberedSessionWorktree(
  owner: WorkspaceOwner,
  dir: string,
  branch: string,
  repoRoot: string,
): Promise<SessionWorktree | null> {
  const baseRef = await readBaseBranch(owner)
  if (!baseRef) return null // neo mất → coi như không cấp được, tạo lại cho chắc
  const repoPath = (await repoRootOfOwner(owner)) ?? repoRoot
  const info = await stat(dir).catch(() => null)
  return {
    repoPath,
    worktreePath: dir,
    branch,
    baseRef,
    createdAt: (info?.mtime ?? new Date()).toISOString(),
  }
}

// Cấp (hoặc trả lại) worktree riêng của một MEMBER trong nhóm. Gọi LƯỜI ở lượt
// đầu của member (send-message); lead/gốc không bao giờ đi qua đây — caller
// tự siết điều đó. Mọi đường fail đều trả `null` kèm log warn: member khi đó
// làm việc trên cây chung của project như một phiên thường, không tệ hơn.
export async function ensureSessionWorkspace(session: {
  id: string
  projectId: string | null
}): Promise<SessionWorktree | null> {
  const owner: WorkspaceOwner = { kind: 'session', id: session.id }
  const fail = (reason: string): null => {
    log.warn('session member worktree unavailable — member works on the shared tree', {
      sessionId: session.id,
      reason,
    })
    return null
  }

  if (!session.projectId) return fail('no-project')
  const project = await loadProject(session.projectId).catch(() => null)
  if (!project?.path) return fail('unknown-project')
  const repoRoot = await resolveRepoRoot(project.path)
  if (!repoRoot) return fail('not-a-git-repo')
  if (!(await gitAtLeast(MIN_GIT_VERSION))) return fail(`git-older-than-${MIN_GIT_VERSION}`)

  const dir = join(worktreeRoot(owner), TEAM_SLUG)
  const branch = `${branchPrefix(owner)}${TEAM_SLUG}`

  // Idempotent: checkout đã tồn tại từ lần cấp trước ⇒ trả lại đúng bản ghi đã
  // neo (baseRef/repoPath đọc từ file neo, không tính lại). Checkout SỐNG mà
  // neo mất thì KHÔNG được rm — cây có thể còn việc chưa lưu; neo lại theo HEAD
  // hiện tại (ước đoán tốt nhất) rồi trả. Chỉ thư mục chết/rác mới bị dọn.
  if (await pathExists(dir)) {
    if (await isLiveCheckout(dir)) {
      let existing = await rememberedSessionWorktree(owner, dir, branch, repoRoot)
      if (!existing) {
        const baseNow = (await currentBranch(repoRoot)) ?? (await headSha(repoRoot))
        if (baseNow) {
          await rememberAnchor(owner, baseNow, repoRoot)
          existing = await rememberedSessionWorktree(owner, dir, branch, repoRoot)
        }
      }
      if (existing) return existing
      // Checkout sống nhưng không neo được gì nữa — giữ nguyên, degrade shared.
      return fail('live-checkout-no-anchor')
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await clearBaseBranch(owner)
  }

  // baseRef = tên nhánh đang checkout; HEAD detached thì là SHA — khác
  // acquireWorkspace (degrade ở detached): member vẫn được cấp vì integrate có
  // cổng kiểm riêng (base-not-checked-out). Repo chưa có commit ⇒ không neo
  // được gì ⇒ degrade.
  const baseRef = (await currentBranch(repoRoot)) ?? (await headSha(repoRoot))
  if (!baseRef) return fail('no-head')

  try {
    assertValidBranchName(branch)
    await mkdir(worktreeRoot(owner), { recursive: true, mode: 0o700 })
    // Neo baseRef (kể cả khi là SHA) + repo cho sweeper — member nhả theo
    // membership nên anchor sống lâu hơn một lượt chạy.
    await rememberAnchor(owner, baseRef, repoRoot)
    // Serialise với auto-commit + Git Manager trên cùng repo. Branch có thể còn
    // sót từ lần membership trước (release GIỮ branch) ⇒ gắn lại thay vì `-b`
    // trùng tên và mất luôn commit đã cứu trên đó.
    const branchExists =
      (await runGit(repoRoot, ['branch', '--list', branch], { throwOnNonZero: false }))
        .stdout.trim().length > 0
    const addArgs = branchExists
      ? ['worktree', 'add', dir, branch]
      : ['worktree', 'add', '-b', branch, dir, 'HEAD']
    await withWorkspaceLock(
      repoRoot,
      async () => {
        // Metadata `.git/worktrees/*` còn sót từ một lần remove dở sẽ khiến
        // git tưởng branch đang checkout ở đường cũ ⇒ prune trước cho chắc.
        await runGit(repoRoot, ['worktree', 'prune'], { throwOnNonZero: false })
        await runGit(repoRoot, addArgs, { timeoutMs: WORKTREE_TIMEOUT_MS })
      },
      { timeoutMs: REPO_LOCK_TIMEOUT_MS },
    )
  } catch (err) {
    // Dọn phần dang dở để lần sau không vướng "directory already exists".
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return fail(err instanceof Error ? err.message : String(err))
  }

  log.info('session member worktree ready', { sessionId: session.id, branch })
  return {
    repoPath: repoRoot,
    worktreePath: dir,
    branch,
    baseRef,
    createdAt: new Date().toISOString(),
  }
}

// Nhả worktree của member khi phiên rời nhóm / bị lưu trữ / bị xoá. Không bao
// giờ throw: cây còn việc chưa lưu thì commit WIP lên chính branch của member
// trước (lưới F8a), cứu không được thì GIỮ NGUYÊN checkout. Branch KHÔNG bao
// giờ bị xoá — kể cả rỗng: merge/xoá là nút bấm của người dùng (spec §4).
export async function releaseSessionWorkspace(sessionId: string): Promise<void> {
  const owner: WorkspaceOwner = { kind: 'session', id: sessionId }
  const dir = join(worktreeRoot(owner), TEAM_SLUG)
  const branch = `${branchPrefix(owner)}${TEAM_SLUG}`

  if (await pathExists(dir)) {
    const rescue = await rescueDirtyCheckout(dir, branch)
    if (rescue.kind === 'retained') {
      log.error('member worktree kept — uncommitted work could not be rescued', {
        sessionId,
        dir,
        branch,
        detail: rescue.detail,
      })
      return // checkout còn nguyên trên đĩa, caller báo UI
    }
    if (rescue.kind === 'rescued') {
      log.warn('member left uncommitted work — committed as WIP on its branch', {
        sessionId,
        branch,
        files: rescue.files,
      })
    }
    const repoRoot = await repoRootOfOwner(owner)
    try {
      if (repoRoot) {
        await withWorkspaceLock(
          repoRoot,
          async () => {
            await runGit(repoRoot, ['worktree', 'remove', '--force', dir], {
              throwOnNonZero: false,
              timeoutMs: WORKTREE_TIMEOUT_MS,
            })
            await runGit(repoRoot, ['worktree', 'prune'], { throwOnNonZero: false })
          },
          { timeoutMs: REPO_LOCK_TIMEOUT_MS },
        )
      }
    } catch (err) {
      log.warn('member worktree remove failed (sweeper will retry at boot)', {
        sessionId,
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    // `remove` có thể bỏ lại thư mục — xoá thẳng. An toàn vì tới đây cây đã
    // sạch hoặc mọi thay đổi đã nằm trong commit WIP trên branch của member.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }

  // Neo + repo file được dọn để một lần re-join sau (có thể trên nhánh khác)
  // ghi lại đúng base lúc đó — rememberAnchor chỉ ghi base khi file trống.
  await clearBaseBranch(owner)
  await rm(repoFile(owner), { force: true }).catch(() => undefined)
}

export interface MemberDiffResult {
  // `--shortstat` của git, vd "3 files changed, 10 insertions(+)" — rỗng khi
  // branch chưa lệch gì so với base.
  stat: string
  // Diff thô, cắt ở MEMBER_DIFF_MAX_CHARS (có đánh dấu chỗ cắt).
  diff: string
  files: number
}

// Diff `baseRef...branch` của một member — nguồn chung cho RPC
// `sessions.memberDiff` (chip "±n files" trên roster) và tool `member_diff`.
// Ba chấm: diff so với merge-base, nên base nhúc nhích sau lúc tạo worktree
// không kéo theo thay đổi của người khác. null khi member không có worktree
// (cây chung → không có gì để diff) hoặc git không trả lời được.
export async function memberDiff(session: {
  id: string
  worktree?: SessionWorktree
}): Promise<MemberDiffResult | null> {
  const wt = session.worktree
  if (!wt) return null
  const range = `${wt.baseRef}...${wt.branch}`
  try {
    const stat = await runGit(wt.repoPath, ['diff', '--shortstat', range], {
      throwOnNonZero: false,
    })
    if (stat.code !== 0) {
      const detail = sanitizeStderr(stat.stderr || stat.stdout)
        .trim()
        .slice(0, DETAIL_MAX_LEN)
      log.warn('member diff stat failed', { sessionId: session.id, detail })
      return null
    }
    const names = await runGit(wt.repoPath, ['diff', '--name-only', range], {
      throwOnNonZero: false,
    })
    const files =
      names.code === 0 ? names.stdout.split('\n').filter((l) => l.trim().length > 0).length : 0
    const full = await runGit(wt.repoPath, ['diff', range], { throwOnNonZero: false })
    let diff = full.code === 0 ? full.stdout : ''
    if (diff.length > MEMBER_DIFF_MAX_CHARS) {
      diff = `${diff.slice(0, MEMBER_DIFF_MAX_CHARS)}\n\n… diff truncated (${diff.length} chars total) — read the files on branch ${wt.branch} for the rest`
    }
    return { stat: stat.stdout.trim(), diff, files }
  } catch (err) {
    log.warn('member diff failed', {
      sessionId: session.id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export type IntegrateSessionResult =
  | { merged: true; commit: string }
  | { merged: false; reason: string }

// Merge branch của MỘT member về baseRef — CHỈ chạy từ RPC `sessions.integrateMember`
// (nút Merge của NGƯỜI DÙNG). Đây là cổng merge duy nhất của owner `session`:
// mọi luật an toàn của integrateTaskBranches được giữ nguyên —
//   • việc chưa commit trong worktree được gom thành commit WIP TRƯỚC (lưới
//     F8a) — merge không thấy thay đổi nằm trong index/cây làm việc;
//   • baseRef phải là nhánh repo ĐANG checkout — AWOG không checkout hộ người
//     dùng (luật F8b);
//   • conflict ⇒ `merge --abort`, cây của người dùng sạch, branch GIỮ NGUYÊN —
//     KHÔNG bao giờ xoá (khác integrateTaskBranches xoá sau merge thành công:
//     ở đây branch là sản phẩm của member, người dùng tự quyết định tiếp).
export async function integrateSessionBranch(input: {
  repoPath: string
  worktreePath: string
  branch: string
  baseRef: string
}): Promise<IntegrateSessionResult> {
  const { repoPath, worktreePath, branch, baseRef } = input

  const rescue = await rescueDirtyCheckout(worktreePath, branch)
  if (rescue.kind === 'retained') {
    return { merged: false, reason: `worktree-dirty: ${rescue.detail}` }
  }
  if (rescue.kind === 'rescued') {
    log.warn('member had uncommitted work — committed as WIP before merging', {
      branch,
      files: rescue.files,
    })
  }

  // Repo gốc mất (project bị xoá/di chuyển giữa chừng) thì nói thẳng thay vì
  // báo nhầm "HEAD detached".
  if (!(await resolveRepoRoot(repoPath))) {
    return { merged: false, reason: 'not-a-git-repo' }
  }

  // `git merge` hạ cánh xuống HEAD hiện tại. baseRef là SHA (neo khi detached)
  // hoặc repo đã chuyển nhánh ⇒ không merge, giải thích để UI nói cho người
  // dùng checkout lại đúng nhánh.
  const head = await currentBranch(repoPath)
  if (head !== baseRef) {
    const where = head ? `nhánh "${head}"` : 'HEAD detached'
    return {
      merged: false,
      reason:
        `base-not-checked-out: repo đang ở ${where} nhưng member neo vào "${baseRef}" — ` +
        `checkout lại "${baseRef}" rồi Merge lần nữa`,
    }
  }

  const message = `Merge session branch ${branch}`
  try {
    return await withWorkspaceLock(
      repoPath,
      async () => {
        suppressEchoFor(repoPath)
        const merge = await runGit(repoPath, ['merge', '--no-edit', '-m', message, branch], {
          throwOnNonZero: false,
        })
        if (merge.code !== 0) {
          // Huỷ merge dở (no-op khi merge chưa kịp bắt đầu).
          await runGit(repoPath, ['merge', '--abort'], { throwOnNonZero: false })
          // Cùng sanitizer với đường RPC: stderr thô có thể mang token + path
          // tuyệt đối, mà reason này đi thẳng lên UI.
          const detail = sanitizeStderr(merge.stderr || merge.stdout)
            .trim()
            .slice(0, DETAIL_MAX_LEN)
          // "CONFLICT … Automatic merge failed" của git đi ra STDOUT, không phải
          // stderr — classify trên cả hai luồng nếu không conflict sẽ báo nhầm
          // merge-failed.
          const isConflict =
            mapStderrToCode(merge.stderr) === GitErrorCode.MERGE_CONFLICT ||
            mapStderrToCode(merge.stdout) === GitErrorCode.MERGE_CONFLICT
          const reason = isConflict ? 'conflict' : `merge-failed: ${detail}`
          log.warn('session member branch merge failed — branch kept for manual merge', {
            branch,
            reason,
          })
          return { merged: false as const, reason }
        }
        // "Already up to date" cũng đi qua đây — branch không lệch gì vẫn là
        // một merge hợp lệ; commit trả về là HEAD sau merge.
        const headNow = await runGit(repoPath, ['rev-parse', 'HEAD'], { throwOnNonZero: false })
        const commit = headNow.code === 0 ? headNow.stdout.trim() : ''
        log.info('session member branch merged', { branch, commit })
        return { merged: true as const, commit }
      },
      { timeoutMs: REPO_LOCK_TIMEOUT_MS },
    )
  } catch (err) {
    const detail = sanitizeStderr(err instanceof Error ? err.message : String(err))
      .trim()
      .slice(0, DETAIL_MAX_LEN)
    log.warn('session member branch merge failed', { branch, detail })
    return { merged: false, reason: `merge-failed: ${detail}` }
  }
}
