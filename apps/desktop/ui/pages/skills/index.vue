<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="editing && !selectedSkillId ? '_creating' : selectedSkillId"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search skills..." />
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
      <div
        class="px-2 py-2 flex items-center gap-1 overflow-x-auto"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <button
          v-for="cat in categories"
          :key="cat"
          class="px-2 py-0.5 text-[11px] rounded transition flex-shrink-0 capitalize"
          :style="{
            background: categoryFilter === cat ? t.bgActive : 'transparent',
            color: categoryFilter === cat ? t.text : t.textDim,
            border: `1px solid ${categoryFilter === cat ? t.borderStrong : 'transparent'}`,
          }"
          @click="categoryFilter = cat"
        >
          {{ cat }}
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="skill in filtered"
          :key="skill.id"
          class="w-full px-3 py-2 cursor-pointer transition"
          :style="{
            background: selectedSkillId === skill.id ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedSkillId === skill.id ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(skill.id)"
          @contextmenu="onContextMenu($event, skill.id)"
          @mouseenter="
            (e: MouseEvent) => {
              if (selectedSkillId !== skill.id)
                (e.currentTarget as HTMLElement).style.background = t.bgHover
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              if (selectedSkillId !== skill.id)
                (e.currentTarget as HTMLElement).style.background = 'transparent'
            }
          "
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Wand2 :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === skill.id"
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
              @dblclick.stop="startRename(skill.id, skill.name)"
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
              @click.stop="openMenuFromButton($event, skill.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[10px] truncate pl-5" :style="{ color: t.textDim }">
            {{ skill.category }}
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

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete skill?"
    :description="deleteDescription"
    @confirm="confirmDelete"
    @cancel="pendingDeleteId = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />
</template>

<script setup lang="ts">
import { Plus, Wand2, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { Skill } from '~/types'
import type { SkillDraft } from '~/composables/useSkillGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const ws = useWorkspaceStore()

const searchQuery = ref('')
const categoryFilter = ref<string>('all')
const editing = ref(false)
const selectedSkillId = ref<string | null>(ws.skills[0]?.id ?? null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDeleteId = ref<string | null>(null)
const manualSeed = ref<SkillDraft | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)

const selectedSkill = computed<Skill | undefined>(() =>
  ws.skills.find((s) => s.id === selectedSkillId.value),
)

const categories = computed<string[]>(() => [
  'all',
  ...Array.from(new Set(ws.skills.map((s) => s.category))),
])

const filtered = computed<Skill[]>(() =>
  ws.skills.filter((s) => {
    if (categoryFilter.value !== 'all' && s.category !== categoryFilter.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q))
        return false
    }
    return true
  }),
)

const agentCountFor = (skillId: string): number =>
  ws.agents.filter((a) => a.skillIds.includes(skillId)).length

const pendingDeleteName = computed(
  () => ws.skills.find((s) => s.id === pendingDeleteId.value)?.name ?? '',
)

const deleteDescription = computed(
  () =>
    `This will permanently delete the skill "${pendingDeleteName.value}". Agents using it will lose this skill.`,
)

const onSelect = (id: string) => {
  selectedSkillId.value = id
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
  selectedSkillId.value = null
  showPromptModal.value = false
  editing.value = true
  mobilePane.value = 'detail'
}

const onSave = (data: Skill) => {
  const isNew = !data.id
  if (isNew) {
    const newId = `sk${Date.now()}`
    const toSave: Skill = { ...data, id: newId }
    ws.saveSkill(toSave)
    selectedSkillId.value = newId
  } else {
    ws.saveSkill(data)
    selectedSkillId.value = data.id
  }
  editing.value = false
  manualSeed.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onCancel = () => {
  editing.value = false
  manualSeed.value = null
  if (!selectedSkill.value) {
    selectedSkillId.value = ws.skills[0]?.id ?? null
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
  if (selectedSkill.value) pendingDeleteId.value = selectedSkill.value.id
}

const confirmDelete = () => {
  const id = pendingDeleteId.value
  if (!id) return
  ws.deleteSkill(id)
  if (selectedSkillId.value === id) {
    selectedSkillId.value = ws.skills[0]?.id ?? null
  }
  pendingDeleteId.value = null
}

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, id: string) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, id }
}

const openMenuFromButton = (e: MouseEvent, id: string) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, id }
}

const startRename = (id: string, current: string) => {
  renamingId.value = id
  renameValue.value = current
}

const commitRename = () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const item = ws.skills.find((s) => s.id === id)
  if (trimmed && item && trimmed !== item.name) {
    ws.saveSkill({ ...item, name: trimmed })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.skills.find((s) => s.id === ctx.id)
  if (!item) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.name) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = item.id
      },
    },
  ]
})
</script>
