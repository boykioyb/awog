<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppSheet from './AppSheet.vue'
import SessionConfigFields from './SessionConfigFields.vue'
import { accountLabel, modelName, projectName } from '../catalog'
import {
  current,
  deleteSession,
  refetchCurrent,
  renameSession,
  updateSessionConfig,
} from '../store'
import type { SessionConfig } from '../types'

// Per-session actions the desktop keeps in its detail header + config popover:
// rename, provider/account/model/effort/mode/style, reload, delete.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const cur = computed(() => current.value)
const title = ref('')
const config = ref<SessionConfig>(fromSession())
const saving = ref(false)
const confirming = ref(false)

function fromSession(): SessionConfig {
  const s = current.value?.settings
  return {
    provider: s?.provider ?? '',
    accountId: s?.accountId ?? '',
    modelId: s?.modelId ?? '',
    level: s?.level ?? 'high',
    mode: current.value?.mode ?? 'ask',
    responseStyle: s?.responseStyle || 'Default',
    responseStyleNoMarkdown: s?.responseStyleNoMarkdown ?? false,
  }
}

const dirty = computed(() => {
  const base = fromSession()
  return (Object.keys(base) as (keyof SessionConfig)[]).some((k) => base[k] !== config.value[k])
})

watch(
  () => props.open,
  (open) => {
    if (!open || !cur.value) return
    title.value = cur.value.title
    config.value = fromSession()
    confirming.value = false
  },
)

async function saveTitle(): Promise<void> {
  if (!cur.value || !title.value.trim() || title.value.trim() === cur.value.title) return
  await renameSession(cur.value.id, title.value)
}

async function saveConfig(): Promise<void> {
  if (!dirty.value || saving.value) return
  saving.value = true
  await updateSessionConfig(config.value)
  config.value = fromSession()
  saving.value = false
}

async function reload(): Promise<void> {
  await refetchCurrent()
  emit('close')
}

async function remove(): Promise<void> {
  if (!cur.value) return
  await deleteSession(cur.value.id)
  emit('close')
}
</script>

<template>
  <AppSheet :open="open" title="Session" @close="emit('close')">
    <template v-if="cur">
      <label class="field">
        <span>Tiêu đề</span>
        <div class="inline">
          <input v-model="title" type="text" @keyup.enter="saveTitle" />
          <button class="btn" :disabled="!title.trim() || title === cur.title" @click="saveTitle">
            Lưu
          </button>
        </div>
      </label>

      <div class="meta">
        <div class="mrow">
          <span class="k muted">Project</span>
          <span class="v">{{ cur.projectId ? projectName(cur.projectId) : '—' }}</span>
        </div>
        <div class="mrow">
          <span class="k muted">Đang dùng</span>
          <span class="v">
            {{ cur.settings ? modelName(cur.settings.modelId) : '—' }} ·
            {{ cur.settings ? accountLabel(cur.settings.provider, cur.settings.accountId) : '—' }}
          </span>
        </div>
      </div>

      <SessionConfigFields v-model="config" />
      <button class="btn wide" :disabled="!dirty || saving" @click="saveConfig">
        <span v-if="saving" class="spin" />
        <span v-else>Lưu cấu hình</span>
      </button>

      <button class="btn wide" @click="reload">Tải lại transcript</button>

      <template v-if="confirming">
        <p class="warn">Xoá session này? Không hoàn tác được.</p>
        <div class="row">
          <button class="btn grow" @click="confirming = false">Huỷ</button>
          <button class="btn btn-danger grow" @click="remove">Xoá</button>
        </div>
      </template>
      <button v-else class="btn btn-danger wide" @click="confirming = true">Xoá session</button>
    </template>
  </AppSheet>
</template>

<style scoped>
.field {
  display: block;
  margin-bottom: 14px;
}
.field > span {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.field input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  outline: none;
  color: var(--text);
  font-size: 15px;
}
.field input:focus {
  border-color: var(--accent);
}
.inline {
  display: flex;
  gap: 8px;
}
.inline input {
  flex: 1;
  min-width: 0;
}
.meta {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  margin-bottom: 14px;
}
.mrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  font-size: 13px;
}
.mrow + .mrow {
  border-top: 1px solid var(--border);
}
.v {
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.wide {
  width: 100%;
  min-height: 44px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.warn {
  font-size: 13px;
  color: var(--danger);
  margin: 4px 0 10px;
}
</style>
