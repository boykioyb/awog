<script setup lang="ts">
import { computed, ref } from 'vue'

const emit = defineEmits<{ (e: 'send', text: string): void }>()

const text = ref('')
const canSend = computed(() => text.value.trim().length > 0)

function send(): void {
  if (!canSend.value) return
  emit('send', text.value)
  text.value = ''
}
</script>

<template>
  <div class="composer">
    <textarea
      v-model="text"
      rows="1"
      placeholder="Nhắn cho agent…"
      @keydown.enter.exact.prevent="send"
    />
    <button class="send" :disabled="!canSend" title="Gửi" @click="send">↑</button>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--bg);
}
textarea {
  flex: 1;
  resize: none;
  max-height: 140px;
  min-height: 42px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 10px 14px;
  outline: none;
  line-height: 1.4;
}
textarea:focus {
  border-color: var(--accent);
}
.send {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: #04120d;
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.send:disabled {
  opacity: 0.4;
}
</style>
