<template>
  <!-- Chip gợi ý — hàng viền hairline, icon warning (là lời mời, không phải lỗi),
       nút hành động viền + × nhẹ. -->
  <div v-if="!dismissed" class="flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2">
    <Icon name="bulb" class="size-3.5 flex-none text-warning" />
    <div class="min-w-0 flex-1">
      <div class="text-lg font-medium text-foreground">{{ block.title }}</div>
      <div v-if="block.tldr" class="text-sm text-muted-foreground">{{ block.tldr }}</div>
    </div>
    <Button
      variant="outline"
      size="xs"
      class="flex-none px-2.5 text-base shadow-none"
      :title="t('sessionsSurfaces.suggestion.startTitle')"
      @click="start"
    >
      {{ t('sessionsSurfaces.suggestion.start') }}
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="size-5.5 flex-none text-muted-foreground [&_svg]:size-3"
      :title="t('sessionsSurfaces.suggestion.dismiss')"
      @click="dismiss"
    >
      <Icon name="x" />
    </Button>
  </div>
</template>

<script setup lang="ts">
// Out-of-scope work the model parked instead of doing (#27, suggest_task).
//
// "Start" creates a NEW session in the same project and drops the model's
// self-contained prompt into its composer (store.create → store.setDraft, the same
// pair the "+" button and the welcome starters use). The draft is set rather than
// sent: the user still reads and edits before spending a turn.
//
// Dismissal is per suggestion (its engine step id) and persisted in localStorage —
// the chip is part of the transcript on disk, so a component-local flag would come
// back on every reload and the model would look like it kept nagging. Only the
// *dismissal* is client state; the suggestion itself stays in the transcript.
import type { SuggestionBlock } from '~/composables/useSessionsData'

const props = defineProps<{ block: SuggestionBlock }>()
const { t } = useI18n()
const store = useSessionsStore()

const STORAGE_KEY = 'awog.sessions.dismissedSuggestions'
// Enough to cover any realistic history; oldest entries fall off the front.
const MAX_REMEMBERED = 200

function readDismissed(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

// Read once at setup: localStorage is the source of truth, and each suggestion has
// exactly one chip, so there is no second instance to stay in sync with.
const dismissed = ref(!!props.block.eid && readDismissed().includes(props.block.eid))

function dismiss(): void {
  dismissed.value = true
  const eid = props.block.eid
  if (!eid || typeof localStorage === 'undefined') return
  const next = [...readDismissed().filter((id) => id !== eid), eid].slice(-MAX_REMEMBERED)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full / disabled: the chip stays dismissed for this session only.
  }
}

function start(): void {
  const projectId = store.active?.project || undefined
  // Returns null when the quota guard refuses a new session (it toasts its own reason).
  const id = store.create(projectId)
  if (id == null) return
  store.setDraft(id, props.block.prompt)
  // Acted on = handled: don't leave the chip behind in the old session.
  dismiss()
}
</script>
