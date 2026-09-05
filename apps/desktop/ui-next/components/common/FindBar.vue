<template>
  <div class="pvfind" role="search">
    <Icon name="search" class="pvfico" />
    <input
      ref="inputRef"
      v-model="query"
      class="pvfinput"
      :class="{ noresult }"
      spellcheck="false"
      :placeholder="placeholder"
      @keydown.enter.prevent="onEnter"
    />
    <span v-if="status || query.trim()" class="pvfcount" :class="{ noresult }">
      {{ status || (noresult ? t('common.find.noResults') : `${current}/${total}`) }}
    </span>
    <button
      class="pvfbtn"
      :class="{ on: matchCase }"
      :title="t('common.find.matchCase')"
      :aria-label="t('common.find.matchCase')"
      :aria-pressed="matchCase"
      @click="matchCase = !matchCase"
    >
      Aa
    </button>
    <button
      class="pvfbtn"
      :disabled="!total"
      :title="t('common.find.prev')"
      :aria-label="t('common.find.prev')"
      @click="emit('prev')"
    >
      <Icon name="chev-left" style="width: 15px; height: 15px" />
    </button>
    <button
      class="pvfbtn"
      :disabled="!total"
      :title="t('common.find.next')"
      :aria-label="t('common.find.next')"
      @click="emit('next')"
    >
      <Icon name="chev-right" style="width: 15px; height: 15px" />
    </button>
    <button
      class="pvfbtn"
      :title="t('common.find.close')"
      :aria-label="t('common.find.close')"
      @click="emit('close')"
    >
      <Icon name="x" style="width: 14px; height: 14px" />
    </button>
  </div>
</template>

<script setup lang="ts">
// Find-in-page bar for the PreviewModal markdown-render surface. Thin: state lives in
// usePreviewFind (owned by usePreviewModal); this component binds query + match-case
// and emits next/prev/close. Keyboard: Enter = next, Shift+Enter = prev; Esc and a
// repeat ⌘/Ctrl+F are handled by the modal's window key handler.
const props = defineProps<{
  total: number
  current: number
  focusTick: number
  placeholder: string
  // Overrides the counter while the surface can't answer yet (session-find shows
  // "Loading transcript…" until the lazy transcript arrives — reporting 0/0 there
  // would claim the text isn't in the session). Empty/absent = normal counter.
  status?: string
}>()
const emit = defineEmits<{ next: []; prev: []; close: [] }>()
const query = defineModel<string>('query', { required: true })
const matchCase = defineModel<boolean>('matchCase', { required: true })

const { t } = useI18n()

// No match found for a non-empty query → danger state on input + counter.
const noresult = computed(() => !props.status && !!query.value.trim() && props.total === 0)

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
function focusInput() {
  const el = inputRef.value
  if (!el) return
  el.focus()
  el.select()
}
onMounted(focusInput)
// The modal bumps focusTick on open and on a repeat ⌘F → refocus + select.
watch(() => props.focusTick, focusInput)

function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) emit('prev')
  else emit('next')
}
</script>

<style scoped>
/* Overlay pinned to the top-right of the preview card, floating over the content
   without shifting layout (mirrors the toolbar overlay idiom). */
.pvfind {
  position: absolute;
  top: 10px;
  right: 14px;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.pvfico {
  width: 14px;
  height: 14px;
  color: var(--textDim);
  flex: none;
  margin: 0 2px;
}
.pvfinput {
  width: 190px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  outline: none;
}
.pvfinput:focus {
  border-color: var(--accent);
}
.pvfinput.noresult {
  border-color: var(--danger);
}
.pvfcount {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--textDim);
  white-space: nowrap;
  padding: 0 4px;
}
.pvfcount.noresult {
  color: var(--danger);
}
.pvfbtn {
  display: grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
}
.pvfbtn:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.pvfbtn.on {
  background: var(--bgActive);
  color: var(--accent);
}
.pvfbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
