<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.preview')" :icon="Eye" @close="close" />

    <div v-if="!artifacts.length" class="flex-1 flex items-center justify-center px-6 text-center">
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.preview.empty') }}</p>
    </div>

    <div v-else class="flex-1 flex flex-col overflow-hidden">
      <div
        v-if="artifacts.length > 1"
        class="flex items-center gap-1 px-1.5 py-1.5 overflow-x-auto flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <button
          v-for="(a, i) in artifacts"
          :key="a.name"
          type="button"
          class="px-2.5 py-1 rounded-lg text-[1em] truncate transition flex-shrink-0"
          :style="{
            background: i === selectedIdx ? t.bgActive : 'transparent',
            color: i === selectedIdx ? t.text : t.textDim,
            maxWidth: '160px',
          }"
          @click="selectedIdx = i"
        >
          {{ a.name }}
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-4 py-3">
        <MarkdownBodyView
          :title="selected?.name ?? ''"
          :content="selected?.preview ?? ''"
          :empty-text="tr('workspace.preview.no_content')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type { Session, SessionArtifactRef } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()

const close = () => panel.closeDrawer(props.session.id)

const selectedIdx = ref(0)

// Unique artifacts referenced across the session (latest definition wins).
const artifacts = computed<SessionArtifactRef[]>(() => {
  const byName = new Map<string, SessionArtifactRef>()
  props.session.messages.forEach((m) => {
    ;(m.artifacts ?? []).forEach((a) => byName.set(a.name, a))
  })
  return [...byName.values()]
})

const selected = computed<SessionArtifactRef | undefined>(
  () => artifacts.value[selectedIdx.value] ?? artifacts.value[0],
)
</script>
