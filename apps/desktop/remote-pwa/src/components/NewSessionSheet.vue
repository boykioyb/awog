<script setup lang="ts">
import { ref, watch } from 'vue'
import AppSheet from './AppSheet.vue'
import SessionConfigFields from './SessionConfigFields.vue'
import { projects } from '../catalog'
import { createSession } from '../store'
import type { SessionConfig } from '../types'

// "New session" from the phone. The phone sends INTENT only (title, project, an
// optional model/account choice); the gateway resolves cwd + system prompt
// server-side and validates the account. Fields left on "Mặc định" are omitted
// entirely so the project's LLM defaults still apply.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const blank = (): SessionConfig => ({
  provider: '',
  accountId: '',
  modelId: '',
  level: '',
  mode: 'ask',
  responseStyle: 'Default',
  responseStyleNoMarkdown: false,
})

const title = ref('')
const projectId = ref<string>('')
const config = ref<SessionConfig>(blank())
const busy = ref(false)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    projectId.value = ''
    config.value = blank()
  },
)

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  await createSession({
    ...(title.value.trim() ? { title: title.value.trim() } : {}),
    projectId: projectId.value || null,
    config: config.value,
  })
  busy.value = false
  emit('close')
}
</script>

<template>
  <AppSheet :open="open" title="Session mới" @close="emit('close')">
    <label class="field">
      <span>Tiêu đề</span>
      <input v-model="title" type="text" placeholder="Để trống → tự đặt sau lượt đầu" />
    </label>

    <label class="field">
      <span>Project</span>
      <select v-model="projectId">
        <option value="">Không gắn project</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <SessionConfigFields v-model="config" inheritable />

    <p class="note muted">
      Lượt chạy từ điện thoại luôn bật cổng duyệt — mọi tool cần bạn bấm Cho phép.
    </p>

    <button class="btn btn-accent go" :disabled="busy" @click="submit">
      <span v-if="busy" class="spin" />
      <span v-else>Tạo session</span>
    </button>
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
.field input,
.field select {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  outline: none;
  color: var(--text);
  font-size: 15px;
}
.field input:focus,
.field select:focus {
  border-color: var(--accent);
}
.note {
  font-size: 12px;
  margin: 0 0 14px;
}
.go {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
