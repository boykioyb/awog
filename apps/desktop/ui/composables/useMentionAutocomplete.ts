import { FileText, Slash, Sparkles, User as UserIcon } from 'lucide-vue-next'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import type { Agent, AgentSource, Command, FsEntry, SkillSource } from '~/types'
import { agentSourcePath } from '~/utils/agent-source'
import { SESSION_COMMANDS } from '~/utils/session-catalog'
import type { AutoItem } from '~/components/session/SessionAutocomplete.vue'

// Max suggestions shown at once for any trigger ($agent, /command-or-skill,
// @file). The dropdown scrolls, so this only guards against pathological lists
// (a workspace with thousands of files); agent/skill/command sets are far
// smaller, so in practice the whole in-scope set is shown.
const RESULT_LIMIT = 50

// Surface the cap instead of silently truncating: when more than RESULT_LIMIT
// match, the dropdown title tells the user to keep typing to narrow (there is
// no load-more — the full set is already in memory, so the only lever is the
// query filter). Below the cap the plain base title is shown.
const narrowTitle = (base: string, shown: number, total: number): string =>
  total > shown ? `${base} · ${shown} of ${total} — type to narrow` : base

// Rank project-tier entries (.claude / .agents under the bound project) above
// user/global-tier ones so the picker surfaces the project's own agents/skills
// first. Stable within each tier, so the underlying scan order is preserved.
// `source` is the shared 5-tier union for both Agent and Skill.
const tierRank = (source: AgentSource | SkillSource): number =>
  source === 'project-claude' || source === 'project-agents' ? 0 : 1

const byProjectFirst = <T extends { source: AgentSource | SkillSource }>(items: T[]): T[] =>
  [...items].sort((a, b) => tierRank(a.source) - tierRank(b.source))

/**
 * Detect `@skill/file`, `$agent`, `/command` mentions in a textarea draft và
 * build danh sách autocomplete items theo trigger char + query token.
 *
 * Trả về state + actions cho component composer dùng — không bind keyboard
 * handler ở đây (composer xử lý ArrowUp/Down/Enter trực tiếp để tích hợp với
 * onSend logic).
 *
 * @param draft - reactive textarea value (two-way binding ở caller)
 * @param textareaRef - ref tới `<textarea>` DOM element (cần để đọc selection)
 * @param workspaceRoot - absolute path của project gắn với session (null = chưa
 *   gắn project → `@` không có file thật để gợi ý)
 * @param onCommand - gọi khi user pick một `/command` (id ví dụ `mode:plan`,
 *   `compact`). Command là *hành động*, không chèn text — composer dispatch.
 */
export const useMentionAutocomplete = (
  draft: Ref<string>,
  // Read-only Ref so a useTemplateRef('textareaRef') (the preferred template-ref
  // idiom — see useClickOutside) is accepted; this composable only reads `.value`.
  textareaRef: Readonly<Ref<HTMLTextAreaElement | null>>,
  workspaceRoot: Ref<string | null>,
  onCommand?: (commandId: string) => void,
) => {
  const workspace = useWorkspaceStore()
  const fileIndex = useWorkspaceFileIndex()

  const mentionToken = ref<string | null>(null)
  const mentionTrigger = ref<'@' | '$' | '/' | null>(null)
  const mentionStart = ref(0)
  const activeIndex = ref(0)

  // Lazy file load: `ensureLoaded` fetches the workspace file index the first
  // time the user opens an `@` mention (deduped + cached per workspace). Reading
  // the returned ref's `.value` here ties the autocomplete to it, so the list
  // recomputes when the sidecar fetch resolves.
  const files = computed<FsEntry[]>(() => {
    const root = mentionTrigger.value === '@' ? workspaceRoot.value : null
    return root ? fileIndex.ensureLoaded(root).value : []
  })

  const agentHandle = (ag: Agent) => ag.name.toLowerCase().replace(/\s+/g, '-')

  // Enabled user commands in scope for this session: global + user-imported
  // always; project + project-imported only when the composer is bound to that
  // project (derived from workspaceRoot).
  const applicableUserCommands = computed<Command[]>(() => {
    const root = workspaceRoot.value
    const projectId = root ? (workspace.projects.find((p) => p.path === root)?.id ?? null) : null
    return workspace.commands.filter((c) => {
      if (c.enabled === false) return false
      const source = c.source ?? 'global'
      if (source === 'global' || source === 'claude-user') return true
      return !!projectId && c.projectId === projectId
    })
  })

  const autocomplete = computed<{ title: string; items: AutoItem[] }>(() => {
    if (mentionToken.value === null) return { title: '', items: [] }
    const trigger = mentionTrigger.value
    const q = mentionToken.value.toLowerCase()

    if (trigger === '$') {
      const matched = byProjectFirst(
        workspace.agents.filter((a) => {
          const h = agentHandle(a)
          return (
            q === '' ||
            h.startsWith(q) ||
            a.role.toLowerCase().startsWith(q) ||
            a.name.toLowerCase().includes(q)
          )
        }),
      )
      const items: AutoItem[] = matched.slice(0, RESULT_LIMIT).map((a) => ({
        kind: 'agent',
        id: a.id,
        label: a.name,
        // Show the on-disk path so same-named agents across tiers (e.g. three
        // `ba` in ~/.claude, ~/.awog, and a project) are distinguishable.
        hint: agentSourcePath(a, workspace.projects),
        icon: UserIcon,
        insertHandle: `$${agentHandle(a)}`,
      }))
      return { title: narrowTitle('Invoke agent', items.length, matched.length), items }
    }

    if (trigger === '/') {
      const matchedCommands = SESSION_COMMANDS.filter((c) => q === '' || c.name.startsWith(q))
      // User-authored slash commands applicable to this session (global + user
      // imported always; project + project-imported only when bound). Inserted
      // as text (`/id `) — expanded into the prompt on send, NOT dispatched.
      const matchedUserCommands = applicableUserCommands.value.filter(
        (c) => q === '' || c.id.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q),
      )
      const matchedSkills = byProjectFirst(
        workspace.skills.filter(
          (s) => q === '' || s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q),
        ),
      )
      const commandItems: AutoItem[] = matchedCommands.slice(0, RESULT_LIMIT).map((c) => ({
        kind: 'command',
        id: c.id,
        label: `/${c.name}`,
        hint: c.description,
        icon: c.icon,
        insertHandle: `/${c.name}`,
      }))
      const userCommandItems: AutoItem[] = matchedUserCommands.slice(0, RESULT_LIMIT).map((c) => ({
        kind: 'usercommand',
        id: c.id,
        label: `/${c.id}`,
        hint: c.description,
        icon: Slash,
        insertHandle: `/${c.id}`,
      }))
      const skillItems: AutoItem[] = matchedSkills.slice(0, RESULT_LIMIT).map((s) => ({
        kind: 'skill',
        id: s.id,
        label: `/${s.id}`,
        hint: s.description,
        icon: Sparkles,
        insertHandle: `/${s.id}`,
      }))
      const items = [...commandItems, ...userCommandItems, ...skillItems]
      return {
        title: narrowTitle(
          'Run command or skill',
          items.length,
          matchedCommands.length + matchedUserCommands.length + matchedSkills.length,
        ),
        items,
      }
    }

    // trigger '@' → real workspace files (fuzzy across the whole tree). Skills
    // moved to '/' to match the Claude Code SDK slash-command convention.
    const matched = files.value.filter(
      (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    )
    // Rank filename matches above path-only matches (typing `redis` should
    // surface redis_client.py before src/x/uses-redis.ts); stable by path.
    const ranked = q
      ? [...matched].sort((a, b) => {
          const an = a.name.toLowerCase().includes(q) ? 0 : 1
          const bn = b.name.toLowerCase().includes(q) ? 0 : 1
          return an - bn || a.path.localeCompare(b.path)
        })
      : matched
    const fileItems: AutoItem[] = ranked.slice(0, RESULT_LIMIT).map((f) => ({
      kind: 'file',
      id: f.path,
      label: f.name,
      hint: f.path,
      icon: FileText,
      insertHandle: `@${f.path}`,
    }))

    // Cap is intentional — surface it (don't silently truncate) so the user
    // knows to keep typing to narrow when there are more matches than shown.
    const title = narrowTitle('Insert file', fileItems.length, matched.length)
    return { title, items: fileItems }
  })

  const detect = () => {
    const el = textareaRef.value
    if (!el) {
      mentionToken.value = null
      return
    }
    const pos = el.selectionStart ?? 0
    const before = draft.value.slice(0, pos)
    const triggers: ('@' | '$' | '/')[] = ['@', '$', '/']
    let triggerIdx = -1
    let triggerChar: '@' | '$' | '/' | null = null
    triggers.forEach((c) => {
      const idx = before.lastIndexOf(c)
      if (idx > triggerIdx) {
        triggerIdx = idx
        triggerChar = c
      }
    })
    if (triggerIdx < 0 || triggerChar === null) {
      mentionToken.value = null
      return
    }
    // valid if trigger is at start or after whitespace
    if (triggerIdx > 0 && !/\s/.test(before[triggerIdx - 1] ?? '')) {
      mentionToken.value = null
      return
    }
    const token = before.slice(triggerIdx + 1)
    if (/\s/.test(token)) {
      mentionToken.value = null
      return
    }
    mentionToken.value = token
    mentionTrigger.value = triggerChar
    mentionStart.value = triggerIdx
    activeIndex.value = 0
  }

  const apply = (item: AutoItem) => {
    if (mentionToken.value === null) return
    const before = draft.value.slice(0, mentionStart.value)
    const afterPos = mentionStart.value + 1 + mentionToken.value.length
    const after = draft.value.slice(afterPos)
    // Commands are actions, not text: strip the typed `/token` and dispatch
    // instead of inserting a handle. The composer owns the actual behavior.
    if (item.kind === 'command') {
      draft.value = `${before}${after}`
      const newPos = before.length
      mentionToken.value = null
      onCommand?.(item.id)
      nextTick(() => {
        const el = textareaRef.value
        if (!el) return
        el.focus()
        el.setSelectionRange(newPos, newPos)
      })
      return
    }
    const inserted = `${item.insertHandle} `
    draft.value = `${before}${inserted}${after}`
    const newPos = before.length + inserted.length
    mentionToken.value = null
    nextTick(() => {
      const el = textareaRef.value
      if (!el) return
      el.focus()
      el.setSelectionRange(newPos, newPos)
    })
  }

  const close = () => {
    mentionToken.value = null
  }

  const moveDown = () => {
    const n = autocomplete.value.items.length
    if (n === 0) return
    activeIndex.value = (activeIndex.value + 1) % n
  }

  const moveUp = () => {
    const n = autocomplete.value.items.length
    if (n === 0) return
    activeIndex.value = (activeIndex.value - 1 + n) % n
  }

  const pickActive = () => {
    const item = autocomplete.value.items[activeIndex.value]
    if (item) apply(item)
  }

  return {
    autocomplete,
    activeIndex,
    detect,
    apply,
    close,
    moveDown,
    moveUp,
    pickActive,
  }
}
