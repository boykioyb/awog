<script setup lang="ts">
// Bottom sheet — the phone stand-in for the desktop's modals/popovers. Backdrop
// tap closes; the panel itself keeps the safe-area inset so it clears the home bar.
defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" class="scrim" @click.self="emit('close')">
        <div class="sheet">
          <div class="grab" />
          <header v-if="title" class="head">
            <span class="title">{{ title }}</span>
            <button class="x" title="Đóng" @click="emit('close')">✕</button>
          </header>
          <div class="body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  /* Bottom stops at the keyboard so a sheet with an input stays reachable. */
  top: 0;
  left: 0;
  right: 0;
  bottom: var(--kb, 0px);
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-width: 720px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 18px 18px 0 0;
  padding-bottom: var(--sab, env(safe-area-inset-bottom));
}
.grab {
  width: 38px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-3);
  margin: 8px auto 2px;
  flex-shrink: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 10px;
  border-bottom: 1px solid var(--border);
}
.title {
  font-weight: 600;
}
.x {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 15px;
}
.body {
  overflow-y: auto;
  padding: 14px 16px 18px;
  -webkit-overflow-scrolling: touch;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.22s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
