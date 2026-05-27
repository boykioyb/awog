// Shared types across sidecar modules. Names mirror RPC payload shape.

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type AuthMode = 'oauth' | 'apikey'

export type AccountStatus = 'connected' | 'expired' | 'disconnected'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope?: string
  tokenUuid?: string
}

export interface AccountOrg {
  uuid: string
  name: string
}

export interface AccountIdentity {
  uuid: string
  email: string
}

export interface AccountRecord {
  id: string
  label: string
  authMode: AuthMode
  oauth?: OAuthTokens
  apiKey?: string
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface AccountSafe {
  id: string
  label: string
  authMode: AuthMode
  fingerprint: string
  status: AccountStatus
  expiresAt?: number
  organization?: AccountOrg
  account?: AccountIdentity
  version: number
  createdAt: string
}

export interface ProviderBucket {
  accounts: AccountRecord[]
  activeAccountId: string | null
}

export interface CredentialsFile {
  version: 1
  providers: Record<ProviderName, ProviderBucket>
}

export interface OAuthState {
  verifier: string
  createdAt: number
}

// ─── Session (chat) ────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui/types/index.ts). Sidecar M4 keeps these
// in-memory only via per-request snapshots from the UI.
// TODO M6: persist sessions to JSONL; M4 keeps in-memory only.

export type ThinkingLevel = 'standard' | 'high' | 'extra-high'

export type AgentMode = 'ask' | 'accept-edits' | 'plan' | 'execute'

export interface SessionSettings {
  provider: ProviderName
  modelId: string
  level: ThinkingLevel
  mode: AgentMode
  accountId?: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agentId?: string
  text: string
  at: string
  modeAtSend?: AgentMode
  // Metadata persisted so UI re-hydrate from JSONL keeps assistant features
  // (markdown rendering, latency badge, model name, token counters).
  startedAt?: number
  completedAt?: number
  modelUsed?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface Session {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  pinned?: boolean
  invitedAgentIds: string[]
  messages: SessionMessage[]
  pendingAgentIds: string[]
  settings: SessionSettings
}

// ─── Project ───────────────────────────────────────────────────────────────
// Mirror of UI shape (apps/desktop/ui/types/index.ts). Stored as plain JSON
// at ~/.awog/projects/<id>.json — see ADR 0012.

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
}
