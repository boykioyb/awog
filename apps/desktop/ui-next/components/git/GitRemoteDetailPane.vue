<template>
  <div class="gdetailpane">
    <div v-if="!remote" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
    <div v-else style="max-width: 560px">
      <div class="gdph">
        <Icon name="conn" style="width: 18px; height: 18px; color: var(--accent)" />
        <span class="gdpt">{{ remote.name }}</span>
        <span style="flex: 1" />
        <button
          v-if="!editing"
          class="gdp-edit"
          :title="t('git.remote.edit')"
          :aria-label="t('git.remote.edit')"
          @click="startEdit"
        >
          <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <!-- Read-only view -->
      <div v-if="!editing" class="gcard">
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.fetchUrl') }}</span>
          <span class="kvv mono">{{ remote.fetchUrl }}</span>
        </div>
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.pushUrl') }}</span>
          <span class="kvv mono">{{ remote.pushUrl }}</span>
        </div>
        <div class="gdpactions">
          <button class="btn sm" :disabled="busy" @click="emit('fetch')">
            <Icon
              name="refresh"
              :class="{ gdpspin: syncOp?.op === 'fetch' }"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('git.ops.fetch') }}
          </button>
          <button class="btn sm" :disabled="busy" @click="emit('pull')">
            <Icon
              v-if="syncOp?.op === 'pull'"
              name="refresh"
              class="gdpspin"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('git.ops.pullWord') }}
          </button>
          <button class="btn pri sm" :disabled="busy" @click="emit('push')">
            <Icon
              v-if="syncOp?.op === 'push'"
              name="refresh"
              class="gdpspin"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('git.ops.pushWord') }}
          </button>
          <button
            v-if="syncOp"
            class="btn sm gdanger"
            :title="t('git.ops.cancel')"
            @click="cancelActive"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
      </div>

      <!-- Edit view -->
      <div v-else class="gcard">
        <label class="gdp-field">
          <span class="kvk">{{ t('git.remote.fetchUrl') }}</span>
          <input
            v-model="fetchDraft"
            class="gdp-input mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <label class="gdp-field">
          <span class="kvk">{{ t('git.remote.pushUrl') }}</span>
          <input
            v-model="pushDraft"
            class="gdp-input mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <div class="gdpactions">
          <span style="flex: 1" />
          <button class="btn sm" @click="cancelEdit">{{ t('common.cancel') }}</button>
          <button class="btn pri sm" :disabled="!canSave" @click="onSave">
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Remote detail pane — fetch/push URLs + ops, with inline URL editing
// (`git remote set-url`). Only changed, non-empty URLs are emitted so we never
// create a redundant separate push-url when fetch === push.
import type { RemoteInfo } from './git-types'

type SyncOp = { op: 'fetch' | 'pull' | 'push'; phase: string; pct: number | null }

const props = defineProps<{
  name: string
  remotes: RemoteInfo[]
  // In-flight network op from the git store — disables fetch/pull/push and spins
  // the active one (mirrors GitPageHeader) so the pane can't race a second op.
  syncOp?: SyncOp | null
  // Open straight into URL-edit mode (driven by the sidebar's "Edit URLs…"
  // context-menu action). Consumed once via `edit-consumed`.
  autoEdit?: boolean
}>()

const emit = defineEmits<{
  (e: 'fetch'): void
  (e: 'pull'): void
  (e: 'push'): void
  (e: 'cancel', op: 'fetch' | 'pull' | 'push'): void
  (e: 'set-url', payload: { name: string; fetchUrl?: string; pushUrl?: string }): void
  (e: 'edit-consumed'): void
}>()

const { t } = useI18n()
const remote = computed(() => props.remotes.find((r) => r.name === props.name))
const busy = computed(() => props.syncOp != null)

// Cancel whichever remote-sync op is currently in flight (only one runs at a time).
function cancelActive() {
  if (props.syncOp) emit('cancel', props.syncOp.op)
}

const editing = ref(false)
const fetchDraft = ref('')
const pushDraft = ref('')

function startEdit() {
  fetchDraft.value = remote.value?.fetchUrl ?? ''
  pushDraft.value = remote.value?.pushUrl ?? ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

// Save is enabled only when at least one URL is non-empty and differs from current.
const canSave = computed(() => {
  const r = remote.value
  if (!r) return false
  const f = fetchDraft.value.trim()
  const p = pushDraft.value.trim()
  return (!!f && f !== r.fetchUrl) || (!!p && p !== r.pushUrl)
})

function onSave() {
  const r = remote.value
  if (!r || !canSave.value) return
  const f = fetchDraft.value.trim()
  const p = pushDraft.value.trim()
  const payload: { name: string; fetchUrl?: string; pushUrl?: string } = { name: r.name }
  if (f && f !== r.fetchUrl) payload.fetchUrl = f
  if (p && p !== r.pushUrl) payload.pushUrl = p
  emit('set-url', payload)
  editing.value = false
}

// Reset edit state when a different remote is selected.
watch(
  () => props.name,
  () => {
    editing.value = false
  },
)

// Parent requested edit mode ("Edit URLs…" context action). Immediate so a
// freshly-mounted pane (navigating from another section) also honours it.
// Registered after the name-reset watch so it wins when both fire in one flush.
watch(
  () => props.autoEdit,
  (want) => {
    if (!want) return
    startEdit()
    emit('edit-consumed')
  },
  { immediate: true },
)
</script>

<style scoped>
.gdp-edit {
  flex: none;
  padding: 4px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  transition: background 0.12s;
}
.gdp-edit:hover {
  background: var(--bgHover);
  color: var(--text);
}
.gdp-field {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
}
.gdp-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
}
.gdp-input:focus {
  border-color: var(--accent);
}
.gdpactions .btn:disabled {
  opacity: 0.55;
  cursor: default;
}
/* Spinner for the in-flight fetch/pull/push op (no rotate keyframe in the shared
   prototype.css). Disabled under reduced-motion. */
.gdpspin {
  animation: gdpspin 0.8s linear infinite;
}
@keyframes gdpspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gdpspin {
    animation: none;
  }
}
</style>
