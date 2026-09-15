// Liệt kê ngữ cảnh hạ tầng khả dụng (ADR 0088 §1, §7): profile AWS, context
// kubectl, thư mục Terraform. Ba nhánh, ba nguồn đọc khác nhau, MỘT hình dạng
// trả về (`{ tool, contexts }`) để UI chỉ có một đường tải.
//
// Payload trả về KHÔNG bao giờ chứa giá trị secret (invariant #1):
//   · `infra/aws/ini.ts` vứt khoá ngay trong vòng lặp parse — chỉ còn hai boolean.
//   · `infra/kubectl/kubeconfig.ts` chỉ cắt ra tên context/cluster/namespace/user
//     + URL API server; `token`, `client-key-data`, khối `exec` bị bỏ tại chỗ.
//   · `infra/terraform/discover.ts` chỉ đọc tên file + khoá ĐỊA CHỈ của backend.
//
// Nhánh terraform cần biết quét ở đâu, nên `root` là tham số DUY NHẤT của RPC
// này — nó đi qua đúng hàng rào của `git.discoverRepos` (bắt đầu tuyệt đối, không
// `..`, phải là thư mục có thật) và chỉ dùng để ĐỌC tên file.
import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'
import { listAwsProfiles } from '../infra/aws/profiles.js'
import { listKubeContexts } from '../infra/kubectl/kubeconfig.js'
import { listTerraformDirs } from '../infra/terraform/discover.js'

const Params = z
  .object({
    tool: z.enum(['aws', 'terraform', 'kubectl']).default('aws'),
    /** Chỉ nhánh terraform dùng: thư mục gốc của project cần quét. */
    root: z.string().min(1).max(4096).optional(),
  })
  .default({ tool: 'aws' })

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

register('infra.contexts', async (raw) => {
  const p = Params.parse(raw ?? {})

  if (p.tool === 'kubectl') {
    const { contexts, paths } = await listKubeContexts()
    // `paths` đi kèm để UI nói được "đọc từ file nào" khi danh sách rỗng — người
    // dùng cần biết là do chưa có `~/.kube/config` hay do file rỗng.
    return { tool: 'kubectl' as const, contexts, paths }
  }

  if (p.tool === 'terraform') {
    // Không có root (project chưa gắn thư mục) ⇒ danh sách rỗng, KHÔNG ném: đây
    // là trạng thái bình thường của một project mới, và UI có câu hướng dẫn riêng.
    if (!p.root) return { tool: 'terraform' as const, contexts: [], root: '' }
    if (p.root.includes('..')) {
      throw new RpcError(-32602, 'Path must not contain ".."')
    }
    const expanded = expandHome(p.root)
    if (!isAbsolute(expanded)) {
      throw new RpcError(-32602, 'Path must be absolute (or start with "~/")')
    }
    const root = resolve(expanded)
    let stats
    try {
      stats = await stat(root)
    } catch {
      throw new RpcError(-32602, `Path does not exist: ${root}`)
    }
    if (!stats.isDirectory()) {
      throw new RpcError(-32602, `Path is not a directory: ${root}`)
    }
    return { tool: 'terraform' as const, contexts: await listTerraformDirs(root), root }
  }

  return { tool: 'aws' as const, contexts: await listAwsProfiles() }
})
