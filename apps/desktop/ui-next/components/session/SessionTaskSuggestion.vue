<template>
  <div v-if="!dismissed" class="sugg">
    <Icon name="bulb" style="width: var(--icon-sm); height: var(--icon-sm)" />
    <div class="suggmain">
      <div class="suggtitle">{{ block.title }}</div>
      <div v-if="block.tldr" class="suggtldr">{{ block.tldr }}</div>
    </div>
    <button class="suggbtn" :title="t('sessionsSurfaces.suggestion.startTitle')" @click="start">
      {{ t('sessionsSurfaces.suggestion.start') }}
    </button>
    <button class="suggx" :title="t('sessionsSurfaces.suggestion.dismiss')" @click="dismiss">
      <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>
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

<style scoped>
.sugg {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
}
.sugg .icn {
  flex: 0 0 auto;
  color: var(--amber);
}
.suggmain {
  flex: 1;
  min-width: 0;
}
.suggtitle {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}
.suggtldr {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.suggbtn {
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.suggbtn:hover {
  background: var(--bgHover);
  border-color: var(--borderStrong);
}
.suggx {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.suggx:hover {
  background: var(--bgHover);
  color: var(--text);
}
@media (prefers-reduced-motion: reduce) {
  .suggbtn {
    transition: none;
  }
}
</style>
