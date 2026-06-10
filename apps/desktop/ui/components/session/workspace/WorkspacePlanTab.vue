<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.plan')" :icon="ListChecks" @close="close">
      <template #actions>
        <span
          v-if="plan?.planStatus"
          class="font-mono leading-none text-[12px] px-1.5 py-0.5 rounded"
          :style="statusBadgeStyle"
        >
          {{ plan.planStatus }}
        </span>
      </template>
    </WorkspaceDrawerHeader>

    <div v-if="!plan" class="flex-1 flex items-center justify-center px-6 text-center">
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.plan.empty') }}</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      <!-- Render the raw plan markdown as a document; legacy steps without
           planMarkdown fall back to the flattened rationale + numbered list. -->
      <div
        v-if="plan.planMarkdown"
        class="awog-md text-[1em]"
        :style="{ color: t.text, '--awog-accent': t.accent }"
      >
        <MarkdownRenderer :content="plan.planMarkdown" />
      </div>
      <template v-else>
        <p
          v-if="plan.planRationale"
          class="text-[1em] leading-relaxed"
          :style="{ color: t.textMuted }"
        >
          {{ plan.planRationale }}
        </p>

        <ol class="space-y-1.5">
          <li
            v-for="(item, i) in plan.planItems ?? []"
            :key="i"
            class="flex items-start gap-2 text-[1em]"
            :style="{ color: t.text }"
          >
            <span class="font-mono text-[12px] flex-shrink-0 mt-0.5" :style="{ color: t.textDim }">
              {{ i + 1 }}.
            </span>
            <span class="leading-relaxed">{{ item }}</span>
          </li>
        </ol>
      </template>

      <div v-if="canDecide" class="flex items-center gap-2 pt-1">
        <button
          type="button"
          class="px-3 py-1.5 rounded text-[1em] inline-flex items-center gap-1.5 transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="approve"
        >
          <Check :size="13" />
          {{ tr('workspace.plan.approve') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded text-[1em] inline-flex items-center gap-1.5 transition"
          :style="{
            background: t.dangerBg,
            color: t.danger,
            border: `1px solid ${t.dangerBorder}`,
          }"
          @click="reject"
        >
          <X :size="13" />
          {{ tr('workspace.plan.reject') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, ListChecks, X } from 'lucide-vue-next'
import { computed } from 'vue'
import type { Session, SessionStep } from '~/types'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()
const panel = useWorkspacePanelStore()

const close = () => panel.closeDrawer(props.session.id)

// Latest plan step across the session — scan messages newest-first.
const plan = computed<SessionStep | null>(() => {
  const { messages } = props.session
  for (let mi = messages.length - 1; mi >= 0; mi -= 1) {
    const steps = messages[mi]?.steps ?? []
    for (let si = steps.length - 1; si >= 0; si -= 1) {
      const s = steps[si]
      if (s && s.kind === 'plan') return s
    }
  }
  return null
})

// Approve/Reject act on the plan step itself (decoupled from the permission
// gate): offered while the latest plan is still pending. Approve flips the
// session to execute mode + runs; reject marks it rejected.
const canDecide = computed(() => !plan.value?.planStatus || plan.value.planStatus === 'pending')

const statusBadgeStyle = computed(() => {
  const status = plan.value?.planStatus
  if (status === 'approved') return { background: t.value.bgInput, color: t.value.statusOk }
  if (status === 'rejected') return { background: t.value.dangerBg, color: t.value.danger }
  return { background: t.value.bgInput, color: t.value.statusWarn }
})

const approve = () => {
  if (plan.value) store.resolvePlan(props.session.id, plan.value.id, 'approve')
}
const reject = () => {
  if (plan.value) store.resolvePlan(props.session.id, plan.value.id, 'reject')
}
</script>
