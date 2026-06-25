<template>
  <div ref="rootRef" class="asel" :style="{ width }">
    <button
      type="button"
      class="aseltrigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span class="aselval" :class="{ ph: !selectedLabel }">
        {{ selectedLabel || placeholder }}
      </span>
      <Icon name="chev" class="aselchev" :class="{ open }" />
    </button>
    <div v-if="open" class="aselmenu" role="listbox">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="aselopt"
        :class="{ on: opt.value === model }"
        role="option"
        :aria-selected="opt.value === model"
        @click="select(opt.value)"
      >
        <span class="aseloptlbl">{{ opt.label }}</span>
        <Icon v-if="opt.value === model" name="check" class="aseltick" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Theme-token dropdown — replaces the native <select> (which WKWebView/Chromium
// render with non-themable chrome). v-model carries the option value; options are
// { label, value }. Closes on outside click (window mousedown) + Escape. Keeps the
// prototype's input/seg visual vocabulary (bgInput surface, accent active row).
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

export type AppSelectOption = { label: string; value: string }

const props = withDefaults(
  defineProps<{
    options: readonly AppSelectOption[]
    placeholder?: string
    width?: string
  }>(),
  { placeholder: '', width: 'auto' },
)

const model = defineModel<string>({ required: true })

const open = ref(false)
const rootRef = useTemplateRef<HTMLElement>('rootRef')

const selectedLabel = computed(
  () => props.options.find((o) => o.value === model.value)?.label ?? '',
)

function toggle() {
  open.value = !open.value
}
function select(value: string) {
  model.value = value
  open.value = false
}

function onWindowDown(e: MouseEvent) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (open.value && e.key === 'Escape') open.value = false
}

onMounted(() => {
  window.addEventListener('mousedown', onWindowDown)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowDown)
  window.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.asel {
  position: relative;
  display: inline-block;
}
.aseltrigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bgInput);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 0.9615rem;
  color: var(--text);
  cursor: pointer;
  font-family: var(--sans);
}
.aseltrigger:hover {
  border-color: var(--borderStrong);
}
.aselval {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.aselval.ph {
  color: var(--textDim);
}
.aselchev {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--textDim);
  transition: transform 0.15s;
}
.aselchev.open {
  transform: rotate(180deg);
}
.aselmenu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}
.aselopt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 0.9615rem;
  color: var(--textMuted);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}
.aselopt:hover {
  background: var(--bgHover);
  color: var(--text);
}
.aselopt.on {
  color: var(--text);
  background: var(--bgActive);
}
.aseltick {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--accent);
}
</style>
