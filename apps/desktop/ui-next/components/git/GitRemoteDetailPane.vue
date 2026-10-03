<template>
  <div class="gdetailpane">
    <div v-if="!remote" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
    <div v-else style="max-width: 560px">
      <div class="gdph">
        <Icon name="conn" class="size-[18px] text-primary" />
        <span class="gdpt">{{ remote.name }}</span>
        <span style="flex: 1" />
        <button
          v-if="!editing"
          class="gdp-edit"
          :title="t('git.remote.edit')"
          :aria-label="t('git.remote.edit')"
          @click="startEdit"
        >
          <Icon name="edit" class="size-3.5" />
        </button>
      </div>

      <!-- Read-only view -->
      <div v-if="!editing" class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm">
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.fetchUrl') }}</span>
          <span class="kvv mono">{{ remote.fetchUrl }}</span>
        </div>
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.pushUrl') }}</span>
          <span class="kvv mono">{{ remote.pushUrl }}</span>
        </div>
        <div class="gdpactions">
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('fetch')">
            <Icon name="refresh" :class="{ gdpspin: syncOp?.op === 'fetch' }" class="size-3.5" />
            {{ t('git.ops.fetch') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('pull')">
            <Icon v-if="syncOp?.op === 'pull'" name="refresh" class="gdpspin size-3.5" />
            {{ t('git.ops.pullWord') }}
          </Button>
          <Button size="sm" :disabled="busy" @click="emit('push')">
            <Icon v-if="syncOp?.op === 'push'" name="refresh" class="gdpspin size-3.5" />
            {{ t('git.ops.pushWord') }}
          </Button>
          <Button
            v-if="syncOp"
            variant="destructive"
            size="iconSm"
            :title="t('git.ops.cancel')"
            @click="cancelActive"
          >
            <Icon name="x" class="size-3.5" />
          </Button>
        </div>
      </div>

      <!-- Edit view -->
      <div v-else class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-sm">
        <label class="gdp-field">
          <span class="kvk">{{ t('git.remote.fetchUrl') }}</span>
          <Input
            v-model="fetchDraft"
            class="font-mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <label class="gdp-field">
          <span class="kvk">{{ t('git.remote.pushUrl') }}</span>
          <Input
            v-model="pushDraft"
            class="font-mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <div class="gdpactions">
          <span style="flex: 1" />
          <Button variant="outline" size="sm" @click="cancelEdit">{{ t('common.cancel') }}</Button>
          <Button size="sm" :disabled="!canSave" @click="onSave">
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Remote detail pane — fetch/push URLs + ops, with inline URL editing
// (`git remote set-url`). Only changed, non-empty URLs are emitted so we never
// create a redundant separate push-url when fetch === push.
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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
  color: var(--muted-foreground);
  transition: background 0.12s;
}
.gdp-edit:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
.gdp-field {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
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
