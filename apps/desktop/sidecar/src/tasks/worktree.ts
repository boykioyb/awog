// Cô lập working tree cho node chạy song song (ADR 0081).
//
// Vấn đề: scheduler chạy tới CONCURRENCY_CAP node cùng lúc, nhưng trước đây mọi
// node đều lấy `project.path` làm cwd — hai agent sửa cùng một cây làm việc, rồi
// `git add -A` của node này quét luôn file dở dang của node kia. Đây là tranh
// chấp thật, không phải thiếu tính năng.
//
// Mô hình "first-claim shared, phần còn lại vào worktree":
//   • Node ĐẦU TIÊN in-flight của một project giữ cây làm việc gốc (`project.path`)
//     → DAG tuần tự (đại đa số) chạy y hệt như trước: không mất node_modules,
//       không tốn thêm một lần checkout, không đổi hành vi auto-commit.
//   • Node in-flight THỨ HAI trở đi được cấp một `git worktree` riêng, branch
//     riêng `awog/task/<taskId>/<nodeId>-vN`, checkout tại HEAD lúc cấp phát.
//     Agent + auto-commit của node đó chỉ nhìn thấy cây của chính nó.
//   • Khi task "ráo" (không còn node nào chạy), engine gọi integrateTaskBranches()
//     để merge các branch node về nhánh hiện tại của repo — trước khi phát đợt
//     node kế tiếp, nên node hạ nguồn luôn thấy kết quả của các node song song.
//
// Danh sách branch cần merge được DERIVE TỪ GIT (`for-each-ref` theo prefix), không
// giữ trong bộ nhớ → sống sót qua restart. Checkout mồ côi (sidecar chết giữa
// chừng) được dọn ở boot bằng sweepOrphanWorktrees(); branch thì GIỮ LẠI vì nó là
// công sức của agent, chỉ xoá sau khi merge thành công.
//
// Degrade an toàn: không phải git repo / git < 2.20 / `worktree add` fail ⇒ quay
// về dùng chung `project.path` như cũ và log rõ ràng. Task vẫn chạy.
//
// Hai lưới an toàn chống mất dữ liệu (đính chính F8 của ADR 0081):
//   • KHÔNG xoá mù. Trước khi bỏ một checkout (release cuối node-run, hoặc sweep
//     ở boot) ta hỏi `git status --porcelain`. Còn thay đổi ⇒ commit WIP lên
//     chính branch của node; commit WIP cũng hỏng ⇒ GIỮ NGUYÊN checkout và báo
//     lên UI. Không có đường nào xoá một cây còn việc chưa lưu.
//   • Merge phải hạ cánh ĐÚNG nhánh. Nhánh đang checkout lúc cấp worktree đầu
//     tiên được ghi xuống `~/.awog/tasks/<taskId>/worktree-base`; lúc ráo, HEAD
//     lệch nhánh đó (người dùng tự `git checkout` giữa chừng) ⇒ KHÔNG merge, báo
//     conflict để engine pause. AWOG không checkout hộ người dùng.

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
import { sanitizeChild } from '../util/path.js'
import { listTaskIds, loadTask, taskDir } from './store.js'

// `git worktree` tồn tại từ 2.5 nhưng `worktree list --porcelain` + `remove` chỉ
// ổn định từ 2.17/2.20; 2.20 cũng đúng bằng mức Git Manager đang yêu cầu (ADR 0017)
// nên không phải giải thích cho người dùng thêm một ngưỡng thứ hai.
const MIN_GIT_VERSION = '2.20'
const WORKTREES_DIR = 'worktrees'
// Prefix branch: nhận diện được bằng mắt, và là khoá để tìm lại branch cần merge
// sau restart. Không được đổi mà không viết migration.
const BRANCH_PREFIX = 'awog/task'
// `worktree add` phải checkout cả cây — repo lớn có thể lâu hơn 30s mặc định.
const WORKTREE_TIMEOUT_MS = 120_000
const REPO_LOCK_TIMEOUT_MS = 60_000
// Nhánh mà task neo vào, ghi lúc cấp worktree ĐẦU TIÊN. Nằm trong thư mục task
// của AWOG (không đụng `.git/config` của người dùng) và bền qua restart — merge
// ở điểm ráo phải đối chiếu với nó.
const BASE_BRANCH_FILE = 'worktree-base'
// Độ dài tối đa của stderr git đưa lên UI (đã qua sanitizeStderr trước khi cắt).
const DETAIL_MAX_LEN = 500

export interface NodeWorkspace {
  // cwd cho agent + cho auto-commit của node.
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
  // Branch của node (chỉ khi isolated).
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

// Node đang giữ cây gốc của mỗi project. Claim đặt ĐỒNG BỘ ở đầu
// acquireNodeWorkspace nên hai node dispatch trong cùng một tick không thể cùng
// nhận cây gốc (giống cách git/mutex.ts claim đồng bộ).
const sharedClaims = new Map<string, string>()

// Ký tự an toàn cho tên branch + tên thư mục. Id nội bộ (taskId/nodeId) về lý
// thuyết là do AWOG sinh, nhưng nodeId đến từ workflow snapshot người dùng sửa
// được ⇒ vẫn coi là L1 và chuẩn hoá trước khi ghép vào ref/path.
function safeSegment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'node'
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

function worktreeRoot(taskId: string): string {
  return join(taskDir(taskId), WORKTREES_DIR)
}

function baseBranchFile(taskId: string): string {
  return join(taskDir(taskId), BASE_BRANCH_FILE)
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

async function readBaseBranch(taskId: string): Promise<string | null> {
  try {
    const name = (await readFile(baseBranchFile(taskId), 'utf8')).trim()
    return name.length > 0 ? name : null
  } catch {
    return null
  }
}

// Ghi neo MỘT LẦN cho mỗi đợt cô lập, TRƯỚC khi branch node đầu tiên tồn tại —
// không bao giờ có branch chờ merge mà thiếu neo. Neo được xoá khi mọi branch
// của task đã merge xong, nên lần resume sau (có thể trên nhánh khác) neo lại
// đúng nhánh lúc đó.
async function rememberBaseBranch(taskId: string, branch: string): Promise<void> {
  if (await readBaseBranch(taskId)) return
  await mkdir(taskDir(taskId), { recursive: true, mode: 0o700 })
  await writeFile(baseBranchFile(taskId), `${branch}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function clearBaseBranch(taskId: string): Promise<void> {
  await rm(baseBranchFile(taskId), { force: true }).catch(() => undefined)
}

// Prefix branch của MỘT task — cũng là namespace `for-each-ref` quét khi tìm
// branch cần merge.
function branchPrefix(taskId: string): string {
  return `${BRANCH_PREFIX}/${safeSegment(taskId)}/`
}

export interface AcquireArgs {
  taskId: string
  nodeId: string
  version: number
  // `project.path` — cây làm việc gốc, do sidecar đọc từ projects store (KHÔNG
  // nhận path từ payload UI).
  projectPath: string
  // Node này CÓ commit vào cây của nó khi xong không (auto-commit per-phase bật
  // + scope 'workspace')? Nếu không thì worktree là bẫy mất dữ liệu: thay đổi
  // chưa commit sẽ biến mất cùng checkout, và cũng chẳng có commit nào để merge
  // về. Trường hợp đó ta giữ nguyên hành vi cũ (dùng chung cây gốc).
  canCommit: boolean
}

// Cấp workspace cho một node-run. Luôn trả về một workspace dùng được: nhánh
// degrade rơi về `projectPath` y như hành vi cũ.
export async function acquireNodeWorkspace(args: AcquireArgs): Promise<NodeWorkspace> {
  const { taskId, nodeId, version, projectPath } = args
  const holder = `${taskId}:${nodeId}:v${version}`

  // Claim đồng bộ — không await trước dòng này.
  if (!sharedClaims.has(projectPath)) {
    sharedClaims.set(projectPath, holder)
    return { cwd: projectPath, isolated: false, claimKey: projectPath }
  }

  const degrade = (reason: string): NodeWorkspace => {
    log.warn('task node worktree unavailable — sharing the project tree', {
      taskId,
      nodeId,
      version,
      reason,
    })
    return { cwd: projectPath, isolated: false, claimKey: '' }
  }

  if (!args.canCommit) return degrade('per-phase-auto-commit-off')
  const repoRoot = await resolveRepoRoot(projectPath)
  if (!repoRoot) return degrade('not-a-git-repo')
  if (!(await gitAtLeast(MIN_GIT_VERSION))) return degrade(`git-older-than-${MIN_GIT_VERSION}`)
  // HEAD detached ⇒ không có nhánh nào để neo, mà merge vào một HEAD rời cũng
  // không phải thứ người dùng chờ đợi. Quay về cây gốc: đúng bằng hành vi khi
  // chưa có ADR 0081, không tệ hơn.
  const base = await currentBranch(repoRoot)
  if (!base) return degrade('detached-head')

  const slug = sanitizeChild(`${safeSegment(nodeId)}-v${version}`)
  const dir = join(worktreeRoot(taskId), slug)
  const branch = `${branchPrefix(taskId)}${slug}`
  try {
    assertValidBranchName(branch)
    await mkdir(worktreeRoot(taskId), { recursive: true, mode: 0o700 })
    await rememberBaseBranch(taskId, base)
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

  log.info('task node running in an isolated worktree', { taskId, nodeId, version, branch })
  return { cwd: dir, isolated: true, branch, repoRoot, claimKey: '' }
}

type RescueResult =
  { kind: 'clean' } | { kind: 'rescued'; files: number } | { kind: 'retained'; detail: string }

// `canCommit` chỉ nói auto-commit ĐƯỢC BẬT, không nói commit ĐÃ XẢY RA: node fail
// giữa chừng, hook `pre-commit` chặn, `add` trượt… đều để lại một cây còn việc mà
// không có commit nào. Xoá checkout lúc đó là mất trắng, không hồi lại được.
//
// Nên trước mọi lần bỏ checkout: còn thay đổi ⇒ gom vào MỘT commit WIP trên chính
// branch của node (branch vẫn được integrateTaskBranches() merge về như thường).
// Commit rescue cố tình bỏ qua hook và ký GPG — nó là lưới an toàn, không phải
// commit "đẹp"; để một hook chặn nó thì lại quay về đúng chỗ mất dữ liệu.
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
  const message = `WIP: rescued uncommitted work from task node branch ${branch}`
  const commit = await runGit(dir, ['commit', '--no-verify', '--no-gpg-sign', '-m', message], {
    throwOnNonZero: false,
  })
  if (commit.code !== 0) return fail(commit.stderr || commit.stdout)
  return { kind: 'rescued', files }
}

// Nhả workspace khi node-run kết thúc (thành công hay không). Cây sạch ⇒ checkout
// bị xoá ngay để không tích rác; commit của node vẫn sống trên branch và sẽ được
// integrateTaskBranches() merge về ở điểm ráo kế tiếp. Cây còn việc chưa lưu ⇒
// commit WIP trước (xem rescueDirtyCheckout); cứu không được ⇒ KHÔNG xoá gì cả,
// trả 'retained' để caller báo lên UI.
export async function releaseNodeWorkspace(
  taskId: string,
  ws: NodeWorkspace,
): Promise<ReleaseOutcome> {
  if (!ws.isolated) {
    if (ws.claimKey) sharedClaims.delete(ws.claimKey)
    return { status: 'clean' }
  }
  const branch = ws.branch ?? ''
  const rescue = await rescueDirtyCheckout(ws.cwd, branch || '(unknown)')
  if (rescue.kind === 'retained') {
    log.error('node worktree kept — uncommitted work could not be rescued', {
      taskId,
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
    log.warn('node left uncommitted work — committed as WIP before releasing the worktree', {
      taskId,
      branch,
      files: rescue.files,
    })
  }
  const repoRoot = ws.repoRoot
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
        },
        { timeoutMs: REPO_LOCK_TIMEOUT_MS },
      )
    }
  } catch (err) {
    log.warn('worktree remove failed (sweeper will retry at boot)', {
      taskId,
      dir: ws.cwd,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  // `remove` có thể bỏ lại thư mục — xoá thẳng. An toàn vì tới đây cây đã sạch
  // (hoặc mọi thay đổi đã nằm trong commit WIP trên branch).
  await rm(ws.cwd, { recursive: true, force: true }).catch(() => undefined)
  return {
    status: rescue.kind === 'rescued' ? 'rescued' : 'clean',
    ...(branch ? { branch } : {}),
  }
}

// Liệt kê branch node còn tồn của một task — nguồn sự thật là git, nên restart
// không làm mất dấu công việc đã commit trong worktree.
async function listTaskBranches(repoRoot: string, taskId: string): Promise<string[]> {
  const prefix = branchPrefix(taskId)
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

// Merge mọi branch node của task về nhánh hiện tại của repo. CHỈ được gọi khi
// task đã ráo (không node nào đang chạy) — lúc đó cây gốc không có ai ghi vào.
//
// Conflict ⇒ `merge --abort`, GIỮ branch, báo lên caller. Engine dừng task có
// trật tự để người dùng tự merge; AWOG không đoán hộ khi hai node song song sửa
// cùng một chỗ.
export async function integrateTaskBranches(
  taskId: string,
  projectPath: string,
): Promise<IntegrationOutcome[]> {
  const repoRoot = await resolveRepoRoot(projectPath)
  if (!repoRoot) return []
  let branches: string[]
  try {
    branches = await listTaskBranches(repoRoot, taskId)
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
    await clearBaseBranch(taskId)
    return []
  }

  // `git merge` hạ cánh xuống HEAD hiện tại. Người dùng lỡ `git checkout` giữa
  // lúc task chạy thì HEAD không còn là nhánh task đã neo — merge lúc đó đổ commit
  // của agent xuống nhầm nhánh. Lệch ⇒ không merge, báo conflict để engine pause;
  // AWOG không checkout hộ người dùng.
  const expected = await readBaseBranch(taskId)
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
  if (outcomes.every((o) => o.status === 'merged')) await clearBaseBranch(taskId)
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

// Dọn checkout mồ côi ở boot: sidecar chết giữa node-run để lại thư mục worktree
// + metadata trong `.git`. Đây cũng là một đường xoá hàng loạt, nên nó đi qua
// ĐÚNG lưới an toàn của release: cây nào còn việc chưa lưu thì commit WIP trước,
// cứu không được thì giữ nguyên (lần boot sau thử lại). Xong mới `worktree prune`.
// Branch KHÔNG bị xoá — đó là commit của agent; integrateTaskBranches() sẽ merge
// khi task được resume.
export async function sweepOrphanWorktrees(): Promise<number> {
  let taskIds: string[]
  try {
    taskIds = await listTaskIds()
  } catch (err) {
    log.warn('worktree sweep: listing tasks failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
  let removed = 0
  for (const taskId of taskIds) {
    const root = worktreeRoot(taskId)
    let entries: string[]
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await readdir(root)
    } catch {
      continue // task không dùng worktree
    }
    for (const entry of entries) {
      const dir = join(root, entry)
      // eslint-disable-next-line no-await-in-loop
      const rescue = await rescueDirtyCheckout(dir, entry)
      if (rescue.kind === 'retained') {
        log.error('orphan worktree kept — uncommitted work could not be rescued', {
          taskId,
          dir,
          detail: rescue.detail,
        })
        continue
      }
      if (rescue.kind === 'rescued') {
        log.warn('orphan worktree had uncommitted work — committed as WIP before sweeping', {
          taskId,
          dir,
          files: rescue.files,
        })
      }
      // eslint-disable-next-line no-await-in-loop
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      removed += 1
    }
    // Chỉ xoá thư mục cha khi đã rỗng — checkout giữ lại phải sống sót.
    // eslint-disable-next-line no-await-in-loop
    await rmdir(root).catch(() => undefined)
    // eslint-disable-next-line no-await-in-loop
    const repoRoot = await repoRootOfTask(taskId)
    if (!repoRoot) continue
    try {
      // eslint-disable-next-line no-await-in-loop
      await runGit(repoRoot, ['worktree', 'prune'], { throwOnNonZero: false })
    } catch {
      /* prune là dọn dẹp cơ hội — thất bại không chặn boot */
    }
  }
  if (removed > 0) log.info('swept orphan task worktrees', { removed })
  return removed
}

async function repoRootOfTask(taskId: string): Promise<string | null> {
  try {
    const task = await loadTask(taskId)
    if (!task) return null
    const project = await loadProject(task.projectId)
    if (!project?.path) return null
    return resolveRepoRoot(project.path)
  } catch {
    return null
  }
}
