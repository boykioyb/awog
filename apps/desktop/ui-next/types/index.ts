// Shared entity types for ui-next. Ported from apps/desktop/ui/types/index.ts —
// only the shapes the git store + useGitApi consume (kept minimal on purpose).

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

// Status of one checklist row (mirrors the sidecar TodoItem union in
// sidecar/src/types/shared.ts). Declared HERE, not in a composable/store: both the
// sessions domain (`Todo`) and the tasks store (`TodoItem`) build on it, and those
// two dirs are auto-import roots — exporting the same name from both makes Nuxt
// pick one at random and warn about the duplicate.
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface ProjectLlmDefaults {
  provider: ProviderName
  modelId: string
  // undefined = follow the global default (Settings → Defaults → thinkingLevel).
  // Pinned only when the project intentionally overrides the global level, so
  // changing the global default later still propagates to non-pinned projects.
  level?: ThinkingLevel
  accountId?: string
  // MCP server ids new sessions opt into. Mirrors `Session.mcpServerIds`:
  // undefined = all currently enabled servers (default); [] = none; [id…] =
  // whitelist.
  mcpServerIds?: string[]
  // Response style (ADR 0046) new sessions inherit. Mirrors SessionSettings:
  // undefined = "Normal" (no style). `responseStyleNoMarkdown` strips markdown.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

// Ngữ cảnh hạ tầng đang ghim (ADR 0088 §7) — AWS profile/region/account, kubectl
// context/namespace, thư mục làm việc của terraform. Mirror của `InfraContext` ở
// sidecar (`infra/run.ts`), nơi các giá trị này trở thành cờ `--profile`/`--context`
// mà sidecar TỰ chèn vào argv.
//
// Kế thừa ba tầng theo TỪNG TRƯỜNG: phiên → project → toàn app.
//   - field vắng mặt → kế thừa tiếp xuống tầng dưới
//   - field ''       → cố ý KHÔNG ghim, DỪNG kế thừa
//   - field có giá trị → ghim
// Đây đúng ngữ nghĩa `githubAccount` đang dùng (xem utils/project-gh-account.ts).
/** Ba CLI mà sidecar gọi trực tiếp bằng arg array (mirror `InfraTool` của sidecar). */
export type InfraTool = 'aws' | 'terraform' | 'kubectl'

export interface InfraContext {
  // AWS profile name (`--profile`).
  profile?: string
  // AWS region (`--region`).
  region?: string
  // AWS account id — chỉ để hiển thị + ghi nhật ký + phân loại production; KHÔNG
  // bao giờ thành cờ.
  accountId?: string
  // kubectl context (`--context`).
  cluster?: string
  // kubectl namespace (`--namespace`).
  namespace?: string
  // Thư mục làm việc của terraform (`-chdir=`).
  workspace?: string
}

// Profile AWS — mirror 1-1 của `AwsProfile`/`AwsProfileKind`/`AwsProfileSource` ở
// sidecar (apps/desktop/sidecar/src/infra/aws/profiles.ts). Đường ĐỌC (`infra.contexts`)
// KHÔNG BAO GIỜ trả giá trị secret — chỉ hai boolean `hasStaticKeys`/`hasSessionToken`
// (ADR 0088 §1, invariant #1). Đừng thêm field secret vào type này.
export type AwsProfileKind = 'sso' | 'login' | 'assume-role' | 'process' | 'static' | 'unknown'

/** Profile khai ở file nào. `both` = có cả config lẫn credentials. */
export type AwsProfileSource = 'config' | 'credentials' | 'both'

export type AwsProfile = {
  name: string
  region?: string
  output?: string
  kind: AwsProfileKind
  ssoStartUrl?: string
  ssoSession?: string
  ssoAccountId?: string
  ssoRoleName?: string
  roleArn?: string
  sourceProfile?: string
  mfaSerial?: string
  hasStaticKeys: boolean
  hasSessionToken: boolean
  /** ISO 8601, từ `x_security_token_expires` (credential tạm). */
  expiresAt?: string
  /**
   * `login_session` của profile `login` (`aws login`): ARN định danh phiên, dạng
   * `arn:aws:iam::<account id>:root`. KHÔNG phải secret — token nằm trong cache
   * của CLI và AWOG không đọc tới. Là thứ duy nhất nói được profile này đang có
   * phiên nào, và hai profile cùng ARN nghĩa là cùng một phiên.
   */
  loginSession?: string
  source: AwsProfileSource
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
  createdAt: string
  color?: string
  // Session LLM defaults (provider/account/model/effort) for this project. New
  // sessions inherit these; undefined = use the global app defaults.
  llmDefaults?: ProjectLlmDefaults
  // GitHub (gh CLI) account this project authenticates as — for git
  // push/fetch/pull AND the GH Issues/PR tabs. '' = active gh account; undefined
  // = inherit the app-level default (settings.githubAccount); a login pins it.
  githubAccount?: string
  // Ngữ cảnh hạ tầng mặc định của project (ADR 0088 §7) — tầng giữa giữa phiên và
  // `settings.infra`. Phiên mới trong project này ĐÓNG BĂNG giá trị hiệu lực lúc
  // tạo, nên sửa ở đây không đổi tài khoản của phiên đang chạy dở.
  infra?: InfraContext
}

// A git repo discovered inside a project folder. A project may be a container
// holding several repos in subfolders — surfaced via `git.discoverRepos` so the
// Git header can show a repo picker. Mirror of sidecar GitRepoEntry.
export type GitRepoEntry = {
  path: string
  name: string
  relativePath: string
  isRoot: boolean
}

export interface ProjectsListResponse {
  projects: Project[]
}
