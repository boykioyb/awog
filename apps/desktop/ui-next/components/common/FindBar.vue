<template>
  <!-- Overlay ghim góc phải-trên của thẻ preview, nổi trên nội dung không đẩy layout
       (cùng kiểu overlay toolbar). -->
  <div
    class="absolute top-2.5 right-3.5 z-9 flex items-center gap-1 rounded-lg border bg-popover px-1.5 py-1 shadow-md"
    role="search"
  >
    <Icon name="search" class="mx-0.5 size-3.5 flex-none text-muted-foreground" />
    <Input
      ref="inputRef"
      v-model="query"
      unstyled
      class="h-ctrl-xs min-h-0 w-47.5 rounded-sm border border-transparent bg-muted px-1.5 text-foreground focus-visible:border-input focus-visible:ring-1 focus-visible:ring-ring"
      :class="{ 'border-destructive focus-visible:border-destructive': noresult }"
      spellcheck="false"
      :placeholder="placeholder"
      @keydown.enter.prevent="onEnter"
    />
    <span
      v-if="status || query.trim()"
      class="px-1 text-sm whitespace-nowrap tabular-nums"
      :class="noresult ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ status || (noresult ? t('common.find.noResults') : `${current}/${total}`) }}
    </span>
    <Toggle
      size="sm"
      class="h-ctrl-xs min-w-ctrl-xs px-1.5 font-normal text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-primary"
      :model-value="matchCase"
      :title="t('common.find.matchCase')"
      :aria-label="t('common.find.matchCase')"
      @update:model-value="(v: boolean) => (matchCase = v)"
    >
      Aa
    </Toggle>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground [&_svg]:size-4"
      :disabled="!total"
      :title="t('common.find.prev')"
      :aria-label="t('common.find.prev')"
      @click="emit('prev')"
    >
      <Icon name="chev-left" />
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground [&_svg]:size-4"
      :disabled="!total"
      :title="t('common.find.next')"
      :aria-label="t('common.find.next')"
      @click="emit('next')"
    >
      <Icon name="chev-right" />
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground"
      :title="t('common.find.close')"
      :aria-label="t('common.find.close')"
      @click="emit('close')"
    >
      <Icon name="x" />
    </Button>
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

// Input shadcn expose focus/select (template ref là instance).
const inputRef = useTemplateRef<{ focus: () => void; select: () => void }>('inputRef')
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
