<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="editing && !selectedKey ? '_creating' : selectedKey"
    list-width="20rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search skills..." />
        <button
          class="flex items-center gap-1 px-2 py-1.5 text-xs rounded transition"
          :style="{
            background: 'transparent',
            color: t.textMuted,
            border: `1px solid ${t.border}`,
          }"
          :title="refreshTitle"
          :disabled="refreshing"
          @click="onRefresh"
        >
          <RefreshCw :size="12" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          ref="newButtonRef"
          class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded font-medium transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="onNew"
        >
          <Plus :size="12" />
          New
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="skill in filtered"
          :key="skillKey(skill)"
          class="w-full px-3 py-2 cursor-pointer transition"
          :style="{
            background: selectedKey === skillKey(skill) ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedKey === skillKey(skill) ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(skill)"
          @contextmenu="onContextMenu($event, skill)"
          @mouseenter="
            (e: MouseEvent) => {
              if (selectedKey !== skillKey(skill))
                (e.currentTarget as HTMLElement).style.background = t.bgHover
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              if (selectedKey !== skillKey(skill))
                (e.currentTarget as HTMLElement).style.background = 'transparent'
            }
          "
        >
          <div class="flex items-center gap-2 mb-0.5">
            <span v-if="skill.icon" class="text-[12px]">{{ skill.icon }}</span>
            <Wand2 v-else :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingKey === skillKey(skill)"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[12px] font-mono flex-1 rounded px-1 py-0.5"
              :style="{
                background: t.bgInput,
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
                outline: 'none',
              }"
              @click.stop
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @blur="commitRename"
            />
            <span
              v-else
              class="text-[12px] font-mono flex-1 truncate"
              :style="{ color: t.text }"
              @dblclick.stop="startRename(skill)"
            >
              {{ skill.name }}
            </span>
            <span class="text-[10px]" :style="{ color: t.textFaint }">
              {{ agentCountFor(skill.id) }}
            </span>
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              title="Actions"
              @click.stop="openMenuFromButton($event, skill)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="flex items-center gap-1.5 pl-5">
            <span class="text-[10px] font-mono truncate" :style="{ color: t.textDim }">
              /{{ skill.id }}
            </span>
            <span
              class="text-[9px] px-1 py-0.5 rounded font-mono uppercase tracking-wider"
              :style="sourceBadgeStyle(skill)"
            >
              {{ sourceLabel(skill) }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <SkillEditor
        v-if="editing"
        :skill="selectedSkill ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <SkillDetail
        v-else-if="selectedSkill"
        :skill="selectedSkill"
        @edit="editing = true"
        @edit-body="onEditBody"
        @delete="askDelete"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Wand2" title="Select a skill" />
    </template>
  </MasterDetailShell>

  <SkillPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onSave"
    @edit-manually="onEditManually"
    @cancel="onCancelPromptModal"
  />

  <SkillBodyEditModal
    v-if="bodyEditing && selectedSkill"
    :skill="selectedSkill"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    title="Delete skill?"
    :description="deleteDescription"
    @confirm="confirmDelete"
    @cancel="pendingDelete = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />

  <div
    v-if="toasts.length > 0"
    class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="px-3 py-2 rounded text-xs shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Plus, RefreshCw, Wand2, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { Skill, SkillSource } from '~/types'
import type { SkillDraft } from '~/composables/useSkillGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const ws = useWorkspaceStore()

const skillKey = (s: Pick<Skill, 'id' | 'source' | 'projectId'>): string =>
  `${s.source}|${s.projectId ?? ''}|${s.id}`

const SOURCE_LABEL: Record<SkillSource, string> = {
  global: '~/.awog',
  'user-claude': '~/.claude',
  'user-agents': '~/.agents',
  'project-claude': '.claude',
  'project-agents': '.agents',
}

const sourceLabel = (s: Skill): string => SOURCE_LABEL[s.source]

const isProjectSkill = (s: Skill): boolean =>
  s.source === 'project-claude' || s.source === 'project-agents'

const searchQuery = ref('')
const editing = ref(false)
const bodyEditing = ref(false)
const bodyEditAnchor = ref<{ top: number; left: number } | null>(null)
const selectedKey = ref<string | null>(ws.skills[0] ? skillKey(ws.skills[0]) : null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDelete = ref<Skill | null>(null)
const manualSeed = ref<SkillDraft | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)

const selectedSkill = computed<Skill | undefined>(() =>
  ws.skills.find((s) => skillKey(s) === selectedKey.value),
)

const filtered = computed<Skill[]>(() =>
  ws.skills.filter((s) => {
    if (!searchQuery.value) return true
    const q = searchQuery.value.toLowerCase()
    return (
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    )
  }),
)

const sourceBadgeStyle = (s: Skill): CSSProperties => {
  const highlight = isProjectSkill(s)
  return {
    background: highlight ? t.value.accent : t.value.bgInput,
    color: highlight ? t.value.accentText : t.value.textDim,
    border: `1px solid ${highlight ? t.value.accent : t.value.border}`,
  }
}

const refreshing = ref(false)
type ToastKind = 'info' | 'success' | 'error'
const toasts = ref<{ id: string; text: string; kind: ToastKind }[]>([])

const pushToast = (text: string, kind: ToastKind = 'info') => {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((tt) => tt.id !== id)
  }, 3200)
}

const toastStyle = (kind: ToastKind): CSSProperties => {
  if (kind === 'success') {
    return {
      background: t.value.infoBg,
      color: t.value.info,
      border: `1px solid ${t.value.infoBorder}`,
    }
  }
  if (kind === 'error') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  return {
    background: t.value.bgPanel,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
  }
}

const refreshTitle = computed(() => {
  const projectCount = ws.projects.length
  const scope = projectCount > 0 ? `${projectCount} project(s) + user dirs` : 'user dirs only'
  return `Refresh skills from filesystem (${scope})`
})

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const refresh = async (opts: { silent?: boolean } = {}) => {
  if (refreshing.value) return
  refreshing.value = true
  const before = ws.skills.length
  try {
    // Make sure projects are loaded first so the skill list can scan every
    // registered project's .claude/skills + .agents/skills (a fresh /skills
    // reload otherwise sees user-level dirs only).
    await ws.hydrateProjectsFromSidecar()
    // Run hydrate and a min-duration sleep in parallel so the spinner is at
    // least visible for one beat — local-mode hydrate is otherwise instant.
    await Promise.all([ws.hydrateSkillsFromSidecar(), sleep(450)])
    if (!selectedKey.value && ws.skills[0]) selectedKey.value = skillKey(ws.skills[0])
    if (!opts.silent) {
      const after = ws.skills.length
      const delta = after - before
      const sidecar = useSidecar()
      if (!sidecar.available) {
        pushToast('Sidecar offline — showing cached skills only', 'info')
      } else if (delta > 0) {
        pushToast(`Loaded ${after} skills (+${delta} new)`, 'success')
      } else if (delta < 0) {
        pushToast(`Loaded ${after} skills (${delta} removed)`, 'info')
      } else {
        pushToast(`No changes · ${after} skills`, 'info')
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] refresh failed', err)
    pushToast('Refresh failed — see console', 'error')
  } finally {
    refreshing.value = false
  }
}

const onRefresh = () => {
  void refresh()
}

onMounted(() => {
  void refresh({ silent: true })
})

const agentCountFor = (skillId: string): number =>
  ws.agents.filter((a) => a.skillIds.includes(skillId)).length

const WHERE_BY_SOURCE: Record<SkillSource, string> = {
  global: '~/.awog/skills/',
  'user-claude': '~/.claude/skills/',
  'user-agents': '~/.agents/skills/',
  'project-claude': '.claude/skills/',
  'project-agents': '.agents/skills/',
}

const deleteDescription = computed(() => {
  const s = pendingDelete.value
  if (!s) return ''
  const where = WHERE_BY_SOURCE[s.source]
  return `This will permanently delete the skill "${s.name}" from ${where}${s.id}/. Agents using it will lose this skill.`
})

const onSelect = (s: Skill) => {
  selectedKey.value = skillKey(s)
  editing.value = false
  manualSeed.value = null
  mobilePane.value = 'detail'
}

const onNew = () => {
  manualSeed.value = null
  editing.value = false
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onEditManually = (draft: SkillDraft) => {
  manualSeed.value = draft
  selectedKey.value = null
  showPromptModal.value = false
  editing.value = true
  mobilePane.value = 'detail'
}

const onEditBody = (anchor: { top: number; left: number } | null) => {
  bodyEditAnchor.value = anchor
  bodyEditing.value = true
}

const onApplyBodyEdit = async (updated: Skill) => {
  try {
    const saved = await ws.saveSkill(updated)
    selectedKey.value = skillKey(saved)
    pushToast('Skill updated', 'success')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] body edit save failed', err)
    pushToast('Failed to save edit — see console', 'error')
    return
  }
  bodyEditing.value = false
}

const onSave = async (payload: { skill: Skill; previousId?: string } | Skill) => {
  // SkillPromptCreator emits a bare Skill draft; SkillEditor emits a payload
  // with the optional previousId for slug renames.
  const data = 'skill' in payload ? payload.skill : payload
  const previousId = 'skill' in payload ? payload.previousId : undefined
  try {
    const saved = await ws.saveSkill(data, previousId)
    selectedKey.value = skillKey(saved)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[skills] save failed', err)
    return
  }
  editing.value = false
  manualSeed.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onCancel = () => {
  editing.value = false
  manualSeed.value = null
  if (!selectedSkill.value && ws.skills[0]) {
    selectedKey.value = skillKey(ws.skills[0])
  }
}

const onBack = () => {
  mobilePane.value = 'list'
  editing.value = false
}

const onCancelPromptModal = () => {
  showPromptModal.value = false
}

const askDelete = () => {
  if (selectedSkill.value) pendingDelete.value = selectedSkill.value
}

const confirmDelete = async () => {
  const s = pendingDelete.value
  if (!s) return
  const wasSelectedKey = selectedKey.value
  await ws.deleteSkill(s.id, s.source, s.projectId)
  if (wasSelectedKey === skillKey(s)) {
    selectedKey.value = ws.skills[0] ? skillKey(ws.skills[0]) : null
  }
  pendingDelete.value = null
}

const contextMenu = ref<{ x: number; y: number; skill: Skill } | null>(null)
const renamingKey = ref<string | null>(null)
const renamingSkill = ref<Skill | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, skill: Skill) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, skill }
}

const openMenuFromButton = (e: MouseEvent, skill: Skill) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, skill }
}

const startRename = (s: Skill) => {
  renamingSkill.value = s
  renamingKey.value = skillKey(s)
  renameValue.value = s.name
}

const commitRename = () => {
  const target = renamingSkill.value
  if (!target) return
  const trimmed = renameValue.value.trim()
  if (trimmed && trimmed !== target.name) {
    void ws.saveSkill({ ...target, name: trimmed })
  }
  renamingKey.value = null
  renamingSkill.value = null
}

const cancelRename = () => {
  renamingKey.value = null
  renamingSkill.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(ctx.skill) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDelete.value = ctx.skill
      },
    },
  ]
})
</script>
