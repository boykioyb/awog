<template>
  <div class="h-full min-h-0 overflow-y-auto">
    <div v-if="!plan && !total" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.plan.empty') }}</div>
    </div>

    <div v-else class="flex flex-col gap-3">
      <template v-if="plan">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-foreground">{{ plan.title }}</span>
          <Badge :variant="badgeVariant">{{ statusLabel }}</Badge>
        </div>
        <SessionTextBlock :text="planMarkdown" />
      </template>

      <div
        v-if="total"
        class="flex flex-col gap-2"
        :class="{ 'border-t border-border pt-3': !!plan }"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-foreground">
            {{ t('sessions.workspace.plan.checklist') }}
          </span>
          <span class="ml-auto text-xs tabular-nums text-dim">{{ doneCount }}/{{ total }}</span>
        </div>
        <SessionTodoList :todos="todos" editable @cycle="cycleTodo" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Plan tab (§5/§10) — the active session's latest plan block plus its live checklist,
// both derived from the transcript (assistant `plan` blocks / the latest TodoWrite).
// One tab answers "what is the plan" and "how far along are we" together, so the
// answer survives scrolling and turn boundaries. Read-only view; approve/run is
// handled inline in the transcript gate cards.
import type { PlanBlock, Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()

// Same derivation the docked banner uses, so the two never disagree.
const { todos, total, doneCount, cycleTodo } = useSessionTodo(() => props.session)

// Latest plan block across the session, scanning messages + blocks newest-first.
const plan = computed<PlanBlock | null>(() => {
  const { msgs } = props.session
  for (let mi = msgs.length - 1; mi >= 0; mi -= 1) {
    const m = msgs[mi]
    if (!m || m.role !== 'assistant') continue
    for (let bi = m.blocks.length - 1; bi >= 0; bi -= 1) {
      const b = m.blocks[bi]
      if (b && b.kind === 'plan') return b
    }
  }
  return null
})

// Render the model's own markdown when present (headers/lists/bold survive); fall
// back to the flattened items as a bullet list (legacy steps). Mirrors
// SessionGateCard so the chat card and this tab show the same document.
const planMarkdown = computed<string>(() => {
  const p = plan.value
  if (!p) return ''
  if (p.markdown) return p.markdown
  return p.items.map((x) => `- ${x}`).join('\n')
})

const statusLabel = computed(() =>
  plan.value?.status === 'approved'
    ? t('sessions.workspace.plan.approved')
    : t('sessions.workspace.plan.pending'),
)

const badgeVariant = computed<'success' | 'warning'>(() =>
  plan.value?.status === 'approved' ? 'success' : 'warning',
)
</script>
