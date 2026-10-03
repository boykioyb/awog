// member_diff — đọc diff trên branch riêng của một member trong nhóm (Session
// Teams, docs/features/session-teams.md §5/§7).
//
// Đây là tool REVIEW: lead dùng nó để đọc việc của một member trước khi quyết
// "merge hay trả về sửa", member cũng đọc được diff của chính mình. Merge vẫn
// là của NGƯỜI DÙNG (RPC sessions.integrateMember) — tool này chỉ ĐỌC.
//
// Chỉ cấp cho chat session NẰM TRONG NHÓM: caller truyền `runId` (gốc của
// nhóm chứa phiên đang chạy — resolve từ listSessionSummaries + runRootOf
// phía trên); để `undefined` thì factory tự resolve qua resolveRunRoot của
// channel-tools; null = phiên lẻ ⇒ trả null, không tốn token schema.
//
// RUNNERS + hai vỏ: `createMemberRunners` là phần thân dùng chung. Nhánh Pi
// bọc nó thành AgentTool qua `createMemberTools`; nhánh Claude SDK bọc thành
// MCP tool qua `claude-sdk/team-sdk-server.ts`.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { listSessionSummaries } from '../../sessions/store.js'
import { memberDiff } from '../../tasks/worktree.js'
import { resolveRunRoot } from './channel-tools.js'

export const MEMBER_TOOL_NAMES = ['member_diff'] as const

// ─── Văn bản tool (một nguồn — nhánh Pi dựng schema TypeBox, nhánh Claude SDK
// dựng schema zod từ đây) ────────────────────────────────────────────────────
export const MEMBER_TOOLS_TEXT = {
  diffDescription:
    'Read what a member of this team changed on its own branch: a shortstat plus a bounded diff of base…branch. ' +
    'Use it to review a teammate’s work before reporting to the user, or to inspect your own worktree. ' +
    'Only sessions in THIS team can be diffed, and merging is never your call — the user merges from the UI.',
  diffSessionId:
    'Id of the member session whose branch you want to diff — a teammate in this team or yourself (the roster in the <team> block lists them).',
} as const

const Params = Type.Object({
  session_id: Type.String({ description: MEMBER_TOOLS_TEXT.diffSessionId }),
})

interface MemberDiffDetails {
  files?: number
  isError?: true
}

// ─── Runner (thân dùng chung cho cả hai runtime) ─────────────────────────────

export interface MemberToolRunResult {
  text: string
  files?: number
  isError?: true
}

export interface MemberRunners {
  diff: (params: { session_id: string }) => Promise<MemberToolRunResult>
}

export function createMemberRunners(input: {
  sessionId: string
  // Ba trạng thái: undefined ⇒ tự resolve từ bản đồ ấm; null ⇒ đã biết là phiên
  // lẻ ⇒ trả null; string ⇒ dùng luôn.
  runId?: string | null | undefined
}): MemberRunners | null {
  const runId =
    input.runId === undefined ? resolveRunRoot(input.sessionId) : input.runId
  if (!runId) return null

  async function diff(params: { session_id: string }): Promise<MemberToolRunResult> {
    const target = (await listSessionSummaries()).find((s) => s.id === params.session_id)
    // Đích phải là member CÙNG nhóm: con của gốc nhóm mình, hoặc chính phiên
    // đang gọi (đọc diff của chính mình).
    if (!target || (target.id !== input.sessionId && target.teamRunId !== runId)) {
      return {
        text: `Session ${params.session_id} is not a member of this team — you can only diff teammates listed in the <team> block.`,
        isError: true,
      }
    }
    const result = await memberDiff(target)
    if (!result) {
      return { text: 'That member works on the shared tree — nothing to diff.' }
    }
    const head = result.stat.length > 0 ? result.stat : 'no changes'
    const body =
      result.diff.length > 0
        ? result.diff
        : '(empty diff — the branch has no changes versus its base)'
    return {
      text: `${result.files} file(s) changed — ${head}\n\n${body}`,
      files: result.files,
    }
  }

  return { diff }
}

// ─── Vỏ AgentTool (nhánh Pi) ─────────────────────────────────────────────────

export function createMemberTools(input: {
  sessionId: string
  // Id của phiên GỐC trong nhóm chứa phiên đang chạy; null ⇒ không có tool nào.
  runId: string | null
}): AgentTool[] {
  const run = createMemberRunners(input)
  if (!run) return []

  const diffTool: AgentTool<typeof Params, MemberDiffDetails> = {
    name: 'member_diff',
    label: 'Member diff',
    description: MEMBER_TOOLS_TEXT.diffDescription,
    parameters: Params,
    async execute(_id, params) {
      const r = await run.diff(params)
      return {
        content: [{ type: 'text', text: r.text }],
        details: {
          ...(r.files !== undefined ? { files: r.files } : {}),
          ...(r.isError ? { isError: true } : {}),
        },
      }
    },
  }

  return [diffTool] as AgentTool[]
}
