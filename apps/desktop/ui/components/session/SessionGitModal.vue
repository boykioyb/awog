<template>
  <Teleport to="body">
    <Transition name="git-modal">
      <!-- @click.self closes on the dimmed backdrop only. GitManager's own
           sub-modals (branch menu, dirty checkout…) teleport to body as later
           siblings, so they layer above and never hit this backdrop. -->
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center p-3 backdrop-blur-sm"
        :style="{ background: t.overlay }"
        @click.self="emit('close')"
      >
        <div
          class="rounded-lg overflow-hidden flex flex-col"
          :style="{
            width: '92vw',
            height: '86vh',
            maxWidth: '1400px',
            background: overlay.background,
            border: `1px solid ${overlay.borderColor}`,
            backdropFilter: overlay.backdropFilter,
            boxShadow: overlay.boxShadow,
          }"
        >
          <div
            class="px-4 py-2.5 flex items-center gap-2 flex-shrink-0"
            :style="{ borderBottom: `1px solid ${t.border}` }"
          >
            <GitBranch :size="14" :style="{ color: t.textDim }" />
            <div class="text-[1em] font-medium truncate" :style="{ color: t.text }">
              {{ tr('session.git.title', { project: projectName }) }}
            </div>
            <button
              class="ml-auto p-1 rounded transition"
              :style="{ color: t.textDim }"
              :title="tr('common.close')"
              @click="emit('close')"
            >
              <X :size="15" />
            </button>
          </div>

          <!-- Definite-height flex host so GitManager's flex-1/overflow-hidden
               panes get a size to fill. -->
          <div class="flex-1 min-h-0 flex overflow-hidden">
            <GitManager :project-id="projectId" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { GitBranch, X } from 'lucide-vue-next'
import { computed, toRef } from 'vue'

const props = defineProps<{
  open: boolean
  projectId: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { overlay } = useGlass()
const { t: tr } = useI18n()
const workspace = useWorkspaceStore()

const projectName = computed(
  () => workspace.projects.find((p) => p.id === props.projectId)?.name ?? '',
)

// Escape closes the manager — but useEscape is a LIFO stack, so when one of
// GitManager's sub-modals is open it consumes Escape first.
useEscape(() => emit('close'), { enabled: toRef(props, 'open') })
</script>

<style scoped>
.git-modal-enter-active,
.git-modal-leave-active {
  transition: opacity 150ms ease;
}
.git-modal-enter-from,
.git-modal-leave-to {
  opacity: 0;
}
</style>
