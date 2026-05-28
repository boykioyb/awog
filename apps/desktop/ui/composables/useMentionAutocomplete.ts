import { FileText, Sparkles, User as UserIcon } from 'lucide-vue-next'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import type { Agent } from '~/types'
import { COMMANDS, PROJECT_FILES } from '~/utils/session-catalog'
import type { AutoItem } from '~/components/session/SessionAutocomplete.vue'

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
 */
export const useMentionAutocomplete = (
  draft: Ref<string>,
  textareaRef: Ref<HTMLTextAreaElement | null>,
) => {
  const workspace = useWorkspaceStore()

  const mentionToken = ref<string | null>(null)
  const mentionTrigger = ref<'@' | '$' | '/' | null>(null)
  const mentionStart = ref(0)
  const activeIndex = ref(0)

  const agentHandle = (ag: Agent) => ag.name.toLowerCase().replace(/\s+/g, '-')

  const autocomplete = computed<{ title: string; items: AutoItem[] }>(() => {
    if (mentionToken.value === null) return { title: '', items: [] }
    const trigger = mentionTrigger.value
    const q = mentionToken.value.toLowerCase()

    if (trigger === '$') {
      const items: AutoItem[] = workspace.agents
        .filter((a) => {
          const h = agentHandle(a)
          return (
            q === '' ||
            h.startsWith(q) ||
            a.role.toLowerCase().startsWith(q) ||
            a.name.toLowerCase().includes(q)
          )
        })
        .slice(0, 6)
        .map((a) => ({
          kind: 'agent',
          id: a.id,
          label: a.name,
          hint: `$${agentHandle(a)} · ${a.role}`,
          icon: UserIcon,
          insertHandle: `$${agentHandle(a)}`,
        }))
      return { title: 'Invoke agent', items }
    }

    if (trigger === '/') {
      const commandItems: AutoItem[] = COMMANDS.filter((c) => q === '' || c.name.startsWith(q))
        .slice(0, 4)
        .map((c) => ({
          kind: 'command',
          id: c.id,
          label: `/${c.name}`,
          hint: c.description,
          icon: c.icon,
          insertHandle: `/${c.name}`,
        }))
      const skillItems: AutoItem[] = workspace.skills
        .filter(
          (s) => q === '' || s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q),
        )
        .slice(0, 6)
        .map((s) => ({
          kind: 'skill',
          id: s.id,
          label: `/${s.id}`,
          hint: s.description,
          icon: Sparkles,
          insertHandle: `/${s.id}`,
        }))
      return { title: 'Run command or skill', items: [...commandItems, ...skillItems] }
    }

    // trigger '@' → files only (skills moved to '/' to match Claude Code SDK
    // slash-command convention; see plan peppy-napping-crystal.md)
    const fileItems: AutoItem[] = PROJECT_FILES.filter(
      (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    )
      .slice(0, 10)
      .map((f) => ({
        kind: 'file',
        id: f.id,
        label: f.name,
        hint: f.path,
        icon: FileText,
        insertHandle: `@${f.path}`,
      }))

    return { title: 'Insert file', items: fileItems }
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
