// `terraform workspace list` trong MỘT thư mục (ADR 0088 §7, việc 12 / P1).
//
// Vì sao là RPC riêng chứ không gộp vào `infra.contexts`: lệnh này TIÊU credential
// và chạm state thật (backend S3 ⇒ gọi mạng). Luật cứng #4 cấm tự gọi mạng, nên
// nó chỉ chạy khi người dùng bấm — `infra.contexts` phải trả lời được ngay cả khi
// chưa `terraform init`, còn lệnh này thì hỏng là chuyện thường và phải nói ra.
//
// Mọi lời gọi CLI đi qua `runInfra()` (luật cứng #3). Ở đây không có tham số nào
// để người gọi tự chèn cờ: `-chdir=` do ngữ cảnh ghim quyết định, `--workspace`
// không tồn tại (terraform chọn workspace qua `TF_WORKSPACE`/lệnh `select`).
import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'
import { runInfra } from '../infra/run.js'
import { classify } from '../infra/classify.js'
import { decide } from '../infra/policy.js'
import { loadInfraPolicy } from '../infra/policy-store.js'

const Params = z.object({ dir: z.string().min(1).max(4096) })

const WORKSPACES_TOOL = 'tf_workspaces'

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

/** Dòng `* default` / `  staging` → tên không kèm dấu sao. */
export function parseWorkspaceList(stdout: string): { workspaces: string[]; current: string } {
  const workspaces: string[] = []
  let current = ''
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const isCurrent = line.startsWith('*')
    const name = isCurrent ? line.slice(1).trim() : line
    if (name.length === 0) continue
    workspaces.push(name)
    if (isCurrent && !current) current = name
  }
  return { workspaces, current }
}

register('infra.tf-workspaces', async (raw) => {
  const params = Params.parse(raw)
  if (params.dir.includes('..')) {
    throw new RpcError(-32602, 'Path must not contain ".."')
  }
  const expanded = expandHome(params.dir)
  if (!isAbsolute(expanded)) {
    throw new RpcError(-32602, 'Path must be absolute (or start with "~/")')
  }
  const dir = resolve(expanded)
  let stats
  try {
    stats = await stat(dir)
  } catch {
    throw new RpcError(-32602, `Path does not exist: ${dir}`)
  }
  if (!stats.isDirectory()) {
    throw new RpcError(-32602, `Path is not a directory: ${dir}`)
  }

  // Cùng ma trận quyền với mọi đường hạ tầng khác: `terraform workspace list` là
  // lớp `read`, nên ở tài khoản production nó vẫn chạy tự động — nhưng KHÔNG có
  // đường nào ở đây gọi được lớp khác (args là hằng số).
  const args = ['workspace', 'list']
  const cls = classify('terraform', args)
  const decision = decide({ policy: await loadInfraPolicy(), class: cls })
  if (decision.mode === 'block') {
    return {
      ok: false as const,
      error:
        'The infrastructure permission matrix blocks read commands, so this was not run ' +
        '(Settings → Infrastructure).',
    }
  }

  const result = await runInfra({
    tool: 'terraform',
    args,
    context: { workspace: dir },
    actor: 'human',
    surface: 'explorer',
    toolName: WORKSPACES_TOOL,
    decision: decision.mode === 'auto' ? 'auto' : 'approved',
  })

  if (!result.ok) {
    // stderr của terraform dài và nhiều dòng; cắt còn dòng đầu để UI không vỡ.
    const first = result.stderr.split('\n').find((l) => l.trim().length > 0) ?? ''
    return {
      ok: false as const,
      error:
        first.trim().slice(0, 400) ||
        'terraform exited without saying why — usually it means `terraform init` has not run here.',
    }
  }
  return { ok: true as const, ...parseWorkspaceList(result.stdout) }
})
