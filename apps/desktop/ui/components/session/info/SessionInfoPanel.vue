<template>
  <!-- Session metadata as a workspace tab — shares the split-pane drawer with
       Files / Terminal / …. The only tab that renders without a bound project. -->
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('sessionInfo.title')" :icon="Info" @close="close" />

    <div class="flex-1 overflow-y-auto">
      <SessionInfoSection :label="tr('sessionInfo.meta')">
        <dl class="space-y-1.5">
          <div v-for="row in meta" :key="row.key" class="flex items-start gap-3">
            <dt class="text-[1em] flex-shrink-0" :style="{ color: t.textDim, minWidth: '92px' }">
              {{ row.label }}
            </dt>
            <dd
              class="text-[1em] flex-1 min-w-0 break-words text-right"
              :class="row.mono ? 'font-mono' : ''"
              :style="{ color: t.text }"
            >
              {{ row.value }}
            </dd>
          </div>
        </dl>
      </SessionInfoSection>

      <SessionInfoSection :label="tr('sessionInfo.project')">
        <div v-if="project" class="space-y-2">
          <div class="flex items-center gap-2 min-w-0">
            <FolderGit2 :size="14" class="flex-shrink-0" :style="{ color: t.accent }" />
            <span class="text-[1em] font-medium truncate" :style="{ color: t.text }">
              {{ project.name }}
            </span>
          </div>
          <div
            class="text-[1em] font-mono break-all"
            :style="{ color: t.textDim }"
            :title="project.path"
          >
            {{ project.path }}
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[1em] transition"
            :style="{ background: t.bgSubtle, color: t.text, border: `1px solid ${t.border}` }"
            @click="viewInFinder()"
          >
            <FolderOpen :size="13" />
            {{ tr('sessionInfo.project.view_in_finder') }}
          </button>
        </div>
        <p v-else class="text-[1em]" :style="{ color: t.textFaint }">
          {{ tr('sessionInfo.project.none') }}
        </p>
      </SessionInfoSection>

      <SessionInfoSection
        :label="tr('sessionInfo.files')"
        :count="contextFiles.length || undefined"
      >
        <div v-if="contextFiles.length" class="space-y-1.5">
          <SessionInfoFileRow
            v-for="file in contextFiles"
            :key="file.key"
            :file="file"
            :can-reveal="projectRoot !== null"
            @open="openAttachment"
            @reveal="revealFile"
            @open-file="openFile"
          />
        </div>
        <p v-else class="text-[1em]" :style="{ color: t.textFaint }">
          {{ tr('sessionInfo.files.empty') }}
        </p>
      </SessionInfoSection>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2, FolderOpen, Info } from 'lucide-vue-next'
import { inject, toRef } from 'vue'
import type { Session } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { OPEN_ATTACHMENT_KEY } from '~/utils/attachment-context'
import WorkspaceDrawerHeader from '../workspace/WorkspaceDrawerHeader.vue'
import SessionInfoSection from './SessionInfoSection.vue'
import SessionInfoFileRow from './SessionInfoFileRow.vue'

const props = defineProps<{
  session: Session
  // Accepted for the workspace-tab contract; Info doesn't use the project root.
  workspaceRoot?: string | null
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()

// Surface a context file in the chat's full-screen lightbox (provided by
// SessionChat); no-op outside a session context.
const openAttachment = inject(OPEN_ATTACHMENT_KEY, () => {})

const { project, projectRoot, meta, contextFiles, viewInFinder, revealFile, openFile } =
  useSessionInfo(toRef(props, 'session'))

const close = () => panel.closeDrawer(props.session.id)
</script>
