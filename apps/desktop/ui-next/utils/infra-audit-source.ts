// "Dòng nhật ký này chạy CLI nào" — câu hỏi mà bảng Nhật ký không trả lời được.
//
// Nhật ký KHÔNG ghi tên binary. `InfraAuditEntry.tool` là tên TOOL AWOG
// (`aws_cli`, `infra_view`, `kube_pods`, `profile_save`…), còn `argv` đã bị cắt
// mất token đầu — đúng khuôn của command-log, nơi argv là phần SAU tên binary.
// Với lệnh `aws` thì token bị cắt đó chính là DỊCH VỤ, vì AWS CLI có dạng
// `<dịch vụ> <thao tác> [cờ]` (`ec2 describe-instances`, `logs describe-log-groups`,
// `s3api list-buckets` — classify.ts mở đầu bằng đúng nhận xét này). Nên muốn nói
// "dòng này từ ec2 / từ CloudWatch" thì phải suy binary từ tên tool trước, rồi mới
// đọc `argv[0]` làm tên dịch vụ.
//
// Bảng dưới đây là nguồn DUY NHẤT của luật đó. Tool lạ ⇒ `null` và bảng hiện thẳng
// tên tool, KHÔNG đoán là `aws`: `argv[0]` của một thao tác nội bộ không phải tên
// dịch vụ (`profile_save` ghi `argv: ['save', '--name', …]` — in "save" lên cột
// Nguồn là bịa một nguồn không tồn tại). Thêm tool mới chạy CLI thì thêm một dòng
// ở đây; quên thì hỏng theo hướng an toàn — hiện tên tool, không hiện tên dịch vụ
// sai. Về lâu dài nhật ký nên tự ghi `binary` tại chỗ ghi (xem
// `infra/run.ts` — nơi DUY NHẤT biết cả `tool` lẫn `toolName`), nhưng nó có ~10
// chỗ ghi khác nữa nên chưa làm.

/** CLI đứng sau một tool AWOG. */
export type InfraBinary = 'aws' | 'terraform' | 'kubectl'

const TOOL_BINARY: Record<string, InfraBinary> = {
  // ── AWS CLI ────────────────────────────────────────────────────────────────
  aws_cli: 'aws',
  // Explorer (bảng tài nguyên + hành động) chạy thẳng `aws`.
  infra_view: 'aws',
  infra_action: 'aws',
  // Triển khai: CodePipeline / CodeBuild / Amplify đều qua `aws`.
  infra_pipeline: 'aws',
  infra_pipeline_action: 'aws',
  // Tài khoản: đăng nhập Console, SSO, STS.
  identity_check: 'aws',
  sso_list_account_roles: 'aws',
  console_login: 'aws',
  resolve_account_id: 'aws',
  // CloudWatch Logs (Insights) — CLI gọi dịch vụ này là `logs`.
  logs_estimate: 'aws',
  logs_groups: 'aws',
  logs_query: 'aws',
  logs_tail_window: 'aws',

  // ── terraform ──────────────────────────────────────────────────────────────
  tf_cli: 'terraform',

  // ── kubectl ────────────────────────────────────────────────────────────────
  kubectl_cli: 'kubectl',
  kube_namespaces: 'kubectl',
  kube_pods: 'kubectl',
  kube_containers: 'kubectl',
  kube_deployments: 'kubectl',
  kube_describe: 'kubectl',
  kube_logs: 'kubectl',
  kube_restart: 'kubectl',
  kube_delete_pod: 'kubectl',
  kube_eks_clusters: 'kubectl',
  kube_add_cluster: 'kubectl',
}

/**
 * CLI đứng sau một tool AWOG. `null` = dòng này không phải một lệnh CLI mà là thao
 * tác nội bộ AWOG (lưu/xoá profile, ghim ngữ cảnh phiên, dọn nhật ký, nạp binary…).
 */
export function infraBinaryOf(tool: string): InfraBinary | null {
  return TOOL_BINARY[tool] ?? null
}

/**
 * Nhãn "nguồn" của một dòng, để đọc trên bảng: tên DỊCH VỤ với lệnh `aws`
 * (`ec2`, `logs`, `s3api`), tên CLI với terraform/kubectl, và tên tool với thao tác
 * nội bộ AWOG.
 */
export function infraAuditSource(entry: { tool: string; argv: readonly string[] }): string {
  const binary = infraBinaryOf(entry.tool)
  if (binary === 'aws') return entry.argv[0] ?? binary
  return binary ?? entry.tool
}
