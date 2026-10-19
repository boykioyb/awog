// Tool snippet của terminal — agent đọc / lưu / xoá / chạy snippet trong thư viện lệnh
// hay dùng của người dùng (terminal/snippets.ts). Cùng họ với `read_terminal` nên đi
// chung server `awogterm` trên nhánh Claude SDK: chạy một snippet rồi đọc output của
// nó bằng `read_terminal` là một vòng làm việc.
//
// PHẠM VI: project của lượt + tầng Global. Agent không thấy và không đụng được snippet
// của project khác — cùng ranh giới với wiki / memory theo project.
//
// QUYỀN (runtime/permission.ts): `save` / `delete` gate như `wiki_write` (ghi vào
// không gian của người dùng); `run` gate như `Bash` vì nó GÕ LỆNH vào shell người dùng
// đang mở — cùng mức rủi ro, chỉ khác là người dùng nhìn thấy và can thiệp được. Plan
// mode chặn cứng cả ba. `list` chỉ đọc, không gate.
//
// `run` ghi thẳng vào PTY qua terminal manager (không vòng qua renderer) nên trả về
// được terminal nào đã nhận lệnh; output thì đọc lại bằng `read_terminal`.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { listTerminalsForWorkspace, terminalManager } from '../../terminal/manager.js'
import { loadSession } from '../../sessions/store.js'
import {
  MAX_SNIPPET_COMMAND_LEN,
  MAX_SNIPPET_NAME_LEN,
  SnippetError,
  deleteSnippet,
  listSnippetsFor,
  upsertSnippet,
  type TerminalSnippet,
} from '../../terminal/snippets.js'

// Tên tool sống ở lá `tool-names.ts` (bridged/permission import từ đó, tránh kéo
// sessions/store vào đồ thị init của step-mapper); re-export cho chỗ dùng cũ.
export { TERMINAL_SNIPPET_MUTATING_TOOL_NAMES, TERMINAL_SNIPPET_TOOL_NAMES } from './tool-names.js'

// Mọi chuỗi model ĐỌC về các tool này, ở một chỗ — nhánh Pi dựng TypeBox, nhánh
// Claude SDK dựng zod từ đây (claude-sdk/terminal-sdk-server.ts).
export const TERMINAL_SNIPPET_TEXT = {
  list: {
    description:
      "List the user's saved terminal snippets (reusable shell commands) for this project plus the shared Global ones. " +
      'Check it before working out a build / test / deploy / migrate command from scratch — the user may already have the exact command saved.',
  },
  save: {
    description:
      "Save a reusable shell command into the user's terminal snippet library, or update one (pass its id). " +
      'Use it when you worked out a command the user will run again, or when they ask you to save / fix a snippet. Keep the name short and recognisable.',
    id: 'Id of an existing snippet to update. Omit to create a new one.',
    name: `Short name shown in the snippets list (max ${MAX_SNIPPET_NAME_LEN} chars).`,
    command: `The shell command exactly as it should be typed (max ${MAX_SNIPPET_COMMAND_LEN} chars). Multi-line is allowed.`,
    scope: '"project" (default) = only this project; "global" = every project.',
  },
  delete: {
    description: "Delete a snippet from the user's terminal snippet library by id. Only snippets of this project or Global can be deleted.",
    id: 'Id of the snippet to delete (from terminal_snippet_list).',
  },
  run: {
    description:
      "Run a saved snippet by TYPING it into an interactive terminal the USER has open in this workspace (the shell they watch and type in — not your own Bash). " +
      'Use it when the user asks you to run one of their snippets there. It does not wait for the command: call read_terminal afterwards to see the output. ' +
      'Fails if no terminal is open — then ask the user to open the Terminal dock, or run the command yourself with Bash.',
    id: 'Id of the snippet to run (from terminal_snippet_list).',
    terminalId: 'Which terminal to type into. Omit to use the most recently opened terminal of this workspace.',
  },
} as const

export interface SnippetToolResult {
  text: string
  isError?: true
}

const ok = (text: string): SnippetToolResult => ({ text })
const fail = (text: string): SnippetToolResult => ({ text, isError: true })

function scopeOf(s: TerminalSnippet): string {
  return s.project === null ? 'global' : 'project'
}

function describe(s: TerminalSnippet): string {
  return `- ${s.id} [${scopeOf(s)}] ${s.name}\n  $ ${s.command.replace(/\n/g, '\n    ')}`
}

// Project của phiên — tra lúc GỌI (ToolFilter không mang project; phiên có thể được
// gắn project sau khi lượt bắt đầu). Không có project ⇒ chỉ tầng Global.
export async function snippetProjectOf(sessionId: string): Promise<string | null> {
  return (await loadSession(sessionId))?.projectId ?? null
}

// Snippet THẤY được từ project này — chặn mọi thao tác trên snippet của project khác.
async function findVisible(project: string | null, id: string): Promise<TerminalSnippet | null> {
  return (await listSnippetsFor(project)).find((s) => s.id === id) ?? null
}

export async function runSnippetList(project: string | null): Promise<SnippetToolResult> {
  const list = await listSnippetsFor(project)
  if (list.length === 0) {
    return ok('No terminal snippets saved for this project or Global yet.')
  }
  return ok(`${list.length} snippet(s) — id [scope] name, then the command:\n${list.map(describe).join('\n')}`)
}

export async function runSnippetSave(
  project: string | null,
  args: { id?: string | undefined; name: string; command: string; scope?: 'project' | 'global' | undefined },
): Promise<SnippetToolResult> {
  // Phiên không có project thì chỉ có tầng Global.
  const owner = args.scope === 'global' || project === null ? null : project
  try {
    if (args.id && !(await findVisible(project, args.id))) {
      return fail(`No snippet "${args.id}" in this project or Global.`)
    }
    const saved = await upsertSnippet({ id: args.id, name: args.name, command: args.command, project: owner })
    return ok(`${args.id ? 'Updated' : 'Saved'} snippet ${saved.id} [${scopeOf(saved)}] "${saved.name}".`)
  } catch (err) {
    if (err instanceof SnippetError) return fail(err.message)
    throw err
  }
}

export async function runSnippetDelete(project: string | null, args: { id: string }): Promise<SnippetToolResult> {
  if (!(await findVisible(project, args.id))) return fail(`No snippet "${args.id}" in this project or Global.`)
  try {
    const gone = await deleteSnippet(args.id)
    return ok(`Deleted snippet ${gone.id} "${gone.name}".`)
  } catch (err) {
    if (err instanceof SnippetError) return fail(err.message)
    throw err
  }
}

export async function runSnippetRun(
  cwd: string,
  project: string | null,
  args: { id: string; terminalId?: string | undefined },
): Promise<SnippetToolResult> {
  const snippet = await findVisible(project, args.id)
  if (!snippet) return fail(`No snippet "${args.id}" in this project or Global.`)
  const open = listTerminalsForWorkspace(cwd)
  if (open.length === 0) {
    return fail(
      `No terminal is open in this workspace (${cwd}). Ask the user to open the Terminal dock, or run the command yourself with Bash.`,
    )
  }
  const target = args.terminalId ?? open[0]!.terminalId
  if (!open.some((t) => t.terminalId === target)) {
    return fail(`No terminal "${target}" is open in this workspace. Open terminals: ${open.map((t) => t.terminalId).join(', ')}.`)
  }
  try {
    // Newline cuối để shell thực thi — đúng như nút Run trên rail của UI.
    terminalManager.write(target, `${snippet.command}\n`)
  } catch {
    return fail(`Terminal "${target}" just exited.`)
  }
  return ok(`Typed snippet "${snippet.name}" into terminal ${target}. Call read_terminal to see its output.`)
}

// ── Vỏ AgentTool của nhánh Pi (Codex nhận qua cầu dynamicTools) ────────────────

const ListParams = Type.Object({})
const SaveParams = Type.Object({
  id: Type.Optional(Type.String({ description: TERMINAL_SNIPPET_TEXT.save.id })),
  name: Type.String({ description: TERMINAL_SNIPPET_TEXT.save.name }),
  command: Type.String({ description: TERMINAL_SNIPPET_TEXT.save.command }),
  scope: Type.Optional(
    Type.Union([Type.Literal('project'), Type.Literal('global')], { description: TERMINAL_SNIPPET_TEXT.save.scope }),
  ),
})
const DeleteParams = Type.Object({ id: Type.String({ description: TERMINAL_SNIPPET_TEXT.delete.id }) })
const RunParams = Type.Object({
  id: Type.String({ description: TERMINAL_SNIPPET_TEXT.run.id }),
  terminalId: Type.Optional(Type.String({ description: TERMINAL_SNIPPET_TEXT.run.terminalId })),
})

type Details = { isError?: true }

function wrap(r: SnippetToolResult): AgentToolResult<Details> {
  return {
    content: [{ type: 'text', text: r.text }],
    details: r.isError ? { isError: true } : {},
  }
}

export function createTerminalSnippetTools(opts: { cwd: string; sessionId: string }): AgentTool[] {
  const { cwd, sessionId } = opts
  const project = (): Promise<string | null> => snippetProjectOf(sessionId)
  const list: AgentTool<typeof ListParams, Details> = {
    name: 'terminal_snippet_list',
    label: 'Terminal snippets',
    description: TERMINAL_SNIPPET_TEXT.list.description,
    parameters: ListParams,
    execute: async () => wrap(await runSnippetList(await project())),
  }
  const save: AgentTool<typeof SaveParams, Details> = {
    name: 'terminal_snippet_save',
    label: 'Save snippet',
    description: TERMINAL_SNIPPET_TEXT.save.description,
    parameters: SaveParams,
    execute: async (_id, p) => wrap(await runSnippetSave(await project(), p)),
  }
  const del: AgentTool<typeof DeleteParams, Details> = {
    name: 'terminal_snippet_delete',
    label: 'Delete snippet',
    description: TERMINAL_SNIPPET_TEXT.delete.description,
    parameters: DeleteParams,
    execute: async (_id, p) => wrap(await runSnippetDelete(await project(), p)),
  }
  const run: AgentTool<typeof RunParams, Details> = {
    name: 'terminal_snippet_run',
    label: 'Run snippet',
    description: TERMINAL_SNIPPET_TEXT.run.description,
    parameters: RunParams,
    execute: async (_id, p) => wrap(await runSnippetRun(cwd, await project(), p)),
  }
  return [list, save, del, run] as unknown as AgentTool[]
}
