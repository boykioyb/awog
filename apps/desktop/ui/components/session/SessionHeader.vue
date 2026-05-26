<template>
  <div
    class="px-4 md:px-6 py-3 flex items-center gap-2"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <div class="min-w-0 flex-1">
      <input
        v-model="titleDraft"
        class="text-[14px] font-semibold bg-transparent outline-none w-full truncate"
        :style="{ color: t.text }"
        @blur="commitTitle"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <div class="text-[10px] mt-0.5 flex items-center gap-1.5" :style="{ color: t.textDim }">
        <span class="font-mono">{{ session.id }}</span>
        <span :style="{ color: t.textFaint }">·</span>
        <span>{{ session.messages.length }} messages</span>
        <span :style="{ color: t.textFaint }">·</span>
        <span>Updated {{ session.updatedAt }}</span>
        <span v-if="project" :style="{ color: t.textFaint }">·</span>
        <span v-if="project" class="inline-flex items-center gap-1">
          <FolderGit2 :size="10" />
          {{ project.name }}
        </span>
      </div>
    </div>
    <button
      class="p-1.5 rounded transition flex-shrink-0"
      :style="{ color: t.textDim }"
      title="Delete session"
      @click="emit('delete')"
    >
      <Trash2 :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2, Trash2 } from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'
import type { Session } from '~/types'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{
  rename: [title: string]
  delete: []
}>()

const { t } = useTheme()
const workspace = useWorkspaceStore()

const titleDraft = ref(props.session.title)

watch(
  () => props.session.id,
  () => {
    titleDraft.value = props.session.title
  },
)

const project = computed(() =>
  props.session.projectId ? workspace.projectById(props.session.projectId) : undefined,
)

const commitTitle = () => {
  const next = titleDraft.value.trim() || 'Untitled session'
  titleDraft.value = next
  if (next !== props.session.title) emit('rename', next)
}
</script>
