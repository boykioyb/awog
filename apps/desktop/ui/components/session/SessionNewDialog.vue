<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    :style="{ background: t.overlay }"
    @click.self="onCancel"
  >
    <div
      class="w-full max-w-md rounded-lg shadow-xl"
      :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="px-4 py-3 flex items-center justify-between"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="text-[1em] font-semibold" :style="{ color: t.text }">New session</div>
        <button
          type="button"
          class="p-1 rounded transition flex items-center"
          :style="{ color: t.textDim }"
          aria-label="Close"
          @click="onCancel"
        >
          <X :size="14" />
        </button>
      </div>

      <form class="px-4 py-4 space-y-4" @submit.prevent="onSubmit">
        <div class="space-y-1.5">
          <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
            Title
          </label>
          <input
            ref="titleRef"
            v-model="title"
            type="text"
            placeholder="Untitled session"
            class="w-full px-3 py-2 rounded text-[1em] outline-none"
            :style="{
              background: t.bgSubtle,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
            @keydown.escape="onCancel"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
            Project
          </label>
          <div class="relative" tabindex="0" @blur="closeProjectMenu">
            <button
              type="button"
              class="w-full px-3 py-2 rounded text-[1em] flex items-center justify-between gap-2"
              :style="{
                background: t.bgSubtle,
                color: t.text,
                border: `1px solid ${t.border}`,
              }"
              @click="showProjectMenu = !showProjectMenu"
            >
              <span class="inline-flex items-center gap-2 truncate">
                <FolderGit2 :size="12" :style="{ color: t.textDim }" />
                {{ selectedProjectName }}
              </span>
              <ChevronDown :size="12" :style="{ color: t.textDim }" />
            </button>

            <div
              v-if="showProjectMenu"
              class="absolute left-0 right-0 top-full mt-1 rounded-md shadow-lg overflow-hidden z-10 flex flex-col"
              :style="{
                background: t.bgPanel,
                border: `1px solid ${t.border}`,
                maxHeight: '280px',
              }"
            >
              <div class="p-1.5" :style="{ borderBottom: `1px solid ${t.border}` }">
                <div class="relative">
                  <Search
                    :size="11"
                    class="absolute left-2 top-1/2 -translate-y-1/2"
                    :style="{ color: t.textDim }"
                  />
                  <input
                    ref="searchRef"
                    v-model="projectQuery"
                    type="text"
                    placeholder="Search projects…"
                    class="w-full pl-7 pr-2 py-1 rounded text-[1em] outline-none"
                    :style="{
                      background: t.bgSubtle,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                    }"
                    @keydown.escape.stop="showProjectMenu = false"
                  />
                </div>
              </div>
              <div class="flex-1 overflow-y-auto">
                <button
                  v-if="!projectQuery"
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-[1em] transition flex items-center gap-2"
                  :style="{
                    color: projectId === null ? t.accent : t.text,
                    background: projectId === null ? t.bgSubtle : 'transparent',
                  }"
                  @click="selectProject(null)"
                >
                  <FolderGit2 :size="11" />
                  <span>No project</span>
                </button>
                <div
                  v-if="!projectQuery && filteredProjects.length"
                  class="h-px"
                  :style="{ background: t.border }"
                />
                <button
                  v-for="p in filteredProjects"
                  :key="p.id"
                  type="button"
                  class="w-full text-left px-3 py-1.5 text-[1em] transition flex items-center gap-2"
                  :style="{
                    color: projectId === p.id ? t.accent : t.text,
                    background: projectId === p.id ? t.bgSubtle : 'transparent',
                  }"
                  @click="selectProject(p.id)"
                >
                  <FolderGit2 :size="11" />
                  <span class="truncate">{{ p.name }}</span>
                </button>
                <div
                  v-if="projectQuery && !filteredProjects.length"
                  class="px-3 py-2 text-[1em]"
                  :style="{ color: t.textDim }"
                >
                  No matches for “{{ projectQuery }}”.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded text-[1em] transition"
            :style="{ color: t.textDim, background: 'transparent' }"
            @click="onCancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-3 py-1.5 rounded text-[1em] font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, FolderGit2, Search, X } from 'lucide-vue-next'
import { nextTick, ref, computed, watch } from 'vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  create: [payload: { title: string; projectId: string | null }]
}>()

const { t } = useTheme()
const workspace = useWorkspaceStore()

const title = ref('')
const projectId = ref<string | null>(null)
const showProjectMenu = ref(false)
const projectQuery = ref('')
const titleRef = ref<HTMLInputElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)

const selectedProjectName = computed(() => {
  if (!projectId.value) return 'No project'
  return workspace.projectById(projectId.value)?.name ?? 'No project'
})

const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase()
  if (!q) return workspace.projects
  return workspace.projects.filter((p) => p.name.toLowerCase().includes(q))
})

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      title.value = ''
      projectId.value = null
      projectQuery.value = ''
      showProjectMenu.value = false
      return
    }
    // Refresh projects whenever the dialog opens — first visit to /sessions
    // may have raced the dialog open before hydrate finished.
    workspace.hydrateProjectsFromSidecar()
    await nextTick()
    titleRef.value?.focus()
  },
)

// Focus the search input as soon as the menu opens — keystrokes go straight
// into the filter without an extra click.
watch(showProjectMenu, async (open) => {
  if (!open) {
    projectQuery.value = ''
    return
  }
  await nextTick()
  searchRef.value?.focus()
})

const selectProject = (id: string | null) => {
  projectId.value = id
  showProjectMenu.value = false
}

const closeProjectMenu = (e: FocusEvent) => {
  // Tabindex=0 wrapper blurs when focus moves to the search input inside the
  // menu. Ignore if focus stays within the wrapper; only close on outside.
  const wrapper = e.currentTarget as HTMLElement | null
  const next = e.relatedTarget as Node | null
  if (wrapper && next && wrapper.contains(next)) return
  setTimeout(() => {
    showProjectMenu.value = false
  }, 120)
}

const onCancel = () => emit('close')

const onSubmit = () => {
  const trimmed = title.value.trim() || 'Untitled session'
  emit('create', { title: trimmed, projectId: projectId.value })
}
</script>
