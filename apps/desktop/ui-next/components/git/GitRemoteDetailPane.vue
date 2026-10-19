<template>
  <div class="flex-1 overflow-auto p-6">
    <div v-if="!remote" class="py-1.5 pr-2.5 pl-7 text-sm text-muted-foreground italic">
      {{ t('git.sidebar.empty') }}
    </div>
    <div v-else class="max-w-140">
      <div class="mb-3.5 flex items-center gap-2 px-3 py-2.5">
        <Icon name="conn" class="size-4.5 text-primary" />
        <span class="text-lg font-semibold text-foreground">{{ remote.name }}</span>
        <span class="flex-1" />
        <Button
          v-if="!editing"
          variant="ghost"
          size="iconSm"
          class="flex-none text-muted-foreground"
          :title="t('git.remote.edit')"
          :aria-label="t('git.remote.edit')"
          @click="startEdit"
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
      </div>

      <!-- Read-only view -->
      <div v-if="!editing" class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs">
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('git.remote.fetchUrl') }}</span>
          <!-- mono-ok: URL remote -->
          <span :class="KV_V">{{ remote.fetchUrl }}</span>
        </div>
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('git.remote.pushUrl') }}</span>
          <!-- mono-ok: URL remote -->
          <span :class="KV_V">{{ remote.pushUrl }}</span>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('fetch')">
            <Icon name="refresh" :class="{ [SPIN]: syncOp?.op === 'fetch' }" class="size-3.5" />
            {{ t('git.ops.fetch') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('pull')">
            <Icon v-if="syncOp?.op === 'pull'" name="refresh" :class="[SPIN, 'size-3.5']" />
            {{ t('git.ops.pullWord') }}
          </Button>
          <Button size="sm" :disabled="busy" @click="emit('push')">
            <Icon v-if="syncOp?.op === 'push'" name="refresh" :class="[SPIN, 'size-3.5']" />
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
      <div v-else class="rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs">
        <label :class="FIELD">
          <span :class="KV_K">{{ t('git.remote.fetchUrl') }}</span>
          <Input
            v-model="fetchDraft"
            class="font-mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <label :class="FIELD">
          <span :class="KV_K">{{ t('git.remote.pushUrl') }}</span>
          <Input
            v-model="pushDraft"
            class="font-mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="onSave"
            @keydown.esc.prevent="cancelEdit"
          />
        </label>
        <div class="mt-4 flex items-center gap-2">
          <span class="flex-1" />
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

const KV_ROW = 'mb-2.5 flex items-center gap-3 text-sm'
const KV_K = 'w-16 flex-none text-xs text-dim'
const KV_V = 'min-w-0 flex-1 break-words font-mono text-sm text-foreground'
const FIELD = 'flex items-center gap-3 py-1.5'
// Icon xoay của thao tác mạng đang chạy (tắt khi reduced-motion).
const SPIN = 'animate-spin motion-reduce:animate-none'

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
