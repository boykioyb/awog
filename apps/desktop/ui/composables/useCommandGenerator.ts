import type { CommandArg, CommandScope, CommandType, SlashCommand } from '~/types'

export type CommandDraft = Omit<SlashCommand, 'id'> & { id: string }

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'and',
  'or',
  'with',
  'on',
  'in',
  'of',
  'i',
  'me',
  'my',
  'when',
  'if',
  'should',
  'want',
])

const inferType = (prompt: string): CommandType => {
  const lower = prompt.toLowerCase()
  if (/(run\s+(tests?|build|lint)|shell|terminal|command|npm |pnpm |git\s)/.test(lower))
    return 'shell'
  if (/(switch\s+(to\s+)?agent|use\s+(agent|the)\s)/.test(lower)) return 'agent-switch'
  if (/(trigger|start)\s+(a\s+)?workflow|pipeline/.test(lower)) return 'workflow'
  return 'prompt'
}

const slugifyName = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 3)
  return words.length ? words.join('-') : 'new-command'
}

const inferArgs = (prompt: string, type: CommandType): CommandArg[] => {
  if (type === 'shell' || type === 'agent-switch') return []
  const lower = prompt.toLowerCase()
  const args: CommandArg[] = []
  if (/(focus|aspect|area)/.test(lower)) {
    args.push({
      name: 'focus',
      type: 'string',
      required: false,
      description: 'Khía cạnh tập trung',
    })
  }
  if (/(file|path)/.test(lower)) {
    args.push({
      name: 'file',
      type: 'file',
      required: false,
      description: 'File mục tiêu (mặc định: artifact gần nhất)',
    })
  }
  if (/(issue|bug|problem)/.test(lower) && type === 'workflow') {
    args.push({
      name: 'issue',
      type: 'string',
      required: true,
      description: 'Mô tả issue',
    })
  }
  return args
}

const inferBody = (prompt: string, type: CommandType, args: CommandArg[]): string => {
  const lower = prompt.toLowerCase()
  if (type === 'shell') {
    if (/test/.test(lower)) return 'pnpm test'
    if (/build/.test(lower)) return 'pnpm build'
    if (/lint/.test(lower)) return 'pnpm lint'
    if (/git status|status/.test(lower)) return 'git status --short'
    return 'echo "{{arg.input}}"'
  }
  if (type === 'agent-switch') return 'ag3'
  if (type === 'workflow') return 'wf2'
  const focusPart = args.find((a) => a.name === 'focus')
    ? ' với focus vào {{arg.focus | default("toàn bộ")}}'
    : ''
  const filePart = args.find((a) => a.name === 'file')
    ? '{{arg.file | default(context.lastArtifact.path)}}'
    : '{{context.lastArtifact.path}}'
  return `${prompt}\n\nĐối tượng: ${filePart}${focusPart}`
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockGenerate = (prompt: string): CommandDraft => {
  const type = inferType(prompt)
  const id = slugifyName(prompt)
  const args = inferArgs(prompt, type)
  const body = inferBody(prompt, type, args)

  return {
    id,
    name: id,
    aliases: [],
    description: firstSentence(prompt),
    type,
    args,
    body,
    scope: 'global' as CommandScope,
    timeoutMs: type === 'shell' ? 60000 : undefined,
  }
}

export const useCommandGenerator = () => useMockGenerator<CommandDraft>({ generate: mockGenerate })
