<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center p-3"
        :style="{ paddingTop: '15vh', background: t.overlay }"
      >
        <div
          ref="cardRef"
          class="w-full max-w-[640px] rounded-lg overflow-hidden flex flex-col"
          :style="{
            maxHeight: '70vh',
            background: overlay.background,
            border: `1px solid ${overlay.borderColor}`,
            backdropFilter: overlay.backdropFilter,
            boxShadow: overlay.boxShadow,
          }"
        >
          <!-- Search input -->
          <div
            class="flex items-center gap-2 px-3 py-2 flex-shrink-0"
            :style="{ borderBottom: `1px solid ${t.border}` }"
          >
            <component
              :is="mode === 'command' ? ChevronRight : Search"
              :size="15"
              :style="{ color: t.textDim }"
            />
            <input
              ref="inputRef"
              v-model="query"
              :placeholder="
                mode === 'command'
                  ? tr('code.palette.command_placeholder')
                  : tr('code.palette.file_placeholder')
              "
              class="flex-1 bg-transparent outline-none text-[1em]"
              :style="{ color: t.text }"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
              @keydown.enter.prevent="pick"
            />
          </div>

          <!-- Results -->
          <div class="flex-1 overflow-y-auto py-1 min-h-0">
            <p
              v-if="items.length === 0"
              class="px-3 py-3 text-[1em]"
              :style="{ color: t.textFaint }"
            >
              {{ tr('code.palette.no_matches') }}
            </p>
            <button
              v-for="(item, i) in items"
              :key="item.id"
              type="button"
              class="w-full text-left flex items-center gap-2 px-3 py-1.5 transition"
              :style="{ background: i === activeIndex ? t.bgActive : 'transparent', color: t.text }"
              @mouseenter="activeIndex = i"
              @click="pickItem(item)"
            >
              <component
                :is="iconOf(item)"
                :size="14"
                class="flex-shrink-0"
                :style="{ color: t.textDim }"
              />
              <span class="flex-1 min-w-0 flex flex-col">
                <span class="text-[1em] truncate">
                  <span
                    v-for="(seg, si) in primarySegs(item)"
                    :key="si"
                    :style="seg.match ? { color: t.accent, fontWeight: 600 } : undefined"
                  >
                    {{ seg.text }}
                  </span>
                </span>
                <span
                  v-if="item.kind === 'file'"
                  class="text-[12px] truncate"
                  :style="{ color: t.textFaint }"
                >
                  <span
                    v-for="(seg, si) in highlightSegments(item.path, item.positions)"
                    :key="si"
                    :style="seg.match ? { color: t.accent } : undefined"
                  >
                    {{ seg.text }}
                  </span>
                </span>
                <span
                  v-else-if="item.hint"
                  class="text-[12px] truncate"
                  :style="{ color: t.textFaint }"
                >
                  {{ item.hint }}
                </span>
              </span>
            </button>
          </div>

          <div
            v-if="capped"
            class="px-3 py-1 text-[12px] flex-shrink-0"
            :style="{ color: t.textFaint, borderTop: `1px solid ${t.border}` }"
          >
            {{ tr('code.palette.capped', { count: items.length }) }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ChevronRight, FileText, Search, TerminalSquare } from 'lucide-vue-next'
import { computed, nextTick, ref, toRef, useTemplateRef, watch } from 'vue'
import type { Component } from 'vue'
import {
  useCommandPalette,
  type PaletteCommand,
  type PaletteItem,
} from '~/composables/useCommandPalette'
import { highlightSegments } from '~/utils/fuzzy'

const props = defineProps<{
  open: boolean
  mode: 'file' | 'command'
  workspaceRoot: string
  commands: PaletteCommand[]
}>()

const emit = defineEmits<{
  close: []
  pickFile: [path: string]
  runCommand: [cmd: PaletteCommand]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const { overlay } = useGlass()

const query = ref('')
const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const cardRef = useTemplateRef<HTMLElement>('cardRef')

const { mode, items, activeIndex, active, capped, moveDown, moveUp } = useCommandPalette(
  query,
  toRef(props, 'workspaceRoot'),
  toRef(props, 'commands'),
)

// On open: seed the query (`>` → command mode prefill), reset cursor, focus.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = props.mode === 'command' ? '>' : ''
    activeIndex.value = 0
    nextTick(() => inputRef.value?.focus())
  },
)

const iconOf = (item: PaletteItem): Component =>
  item.kind === 'command' ? (item.icon ?? TerminalSquare) : FileText

// Primary line highlight. For files the basename is shown — map the path-relative
// match positions back into the basename so the highlight lines up.
const primarySegs = (item: PaletteItem) => {
  if (item.kind === 'command') return highlightSegments(item.label, item.positions)
  const start = item.path.lastIndexOf('/') + 1
  const rel = item.positions.filter((p) => p >= start).map((p) => p - start)
  return highlightSegments(item.label, rel)
}

const pickItem = (item: PaletteItem) => {
  if (item.kind === 'file') emit('pickFile', item.path)
  else emit('runCommand', item.command)
  emit('close')
}

const pick = () => {
  if (active.value) pickItem(active.value)
}

useEscape(() => emit('close'), { enabled: computed(() => props.open) })
useClickOutside(cardRef, () => {
  if (props.open) emit('close')
})
</script>

<style scoped>
.palette-enter-active,
.palette-leave-active {
  transition: opacity 120ms ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
</style>
