<template>
  <div class="px-1 pb-1">
    <button
      class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
      :style="{
        color: t.textDim,
        background: hover ? t.bgHover : 'transparent',
      }"
      @click="collapsed = !collapsed"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
    >
      <ChevronDown
        :size="10"
        :style="{
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s',
        }"
      />
      <span class="text-[0.71em] uppercase tracking-wider font-medium flex-1 text-left truncate">
        {{ label }}
      </span>
      <span class="text-[0.71em]" :style="{ color: t.textFaint }">
        {{ files.length }}
      </span>
    </button>
    <template v-if="!collapsed">
      <!-- Naive render when small — virtualize when > VIRTUAL_THRESHOLD (AC-44). -->
      <template v-if="files.length <= VIRTUAL_THRESHOLD">
        <div
          v-for="file in files"
          :key="file.path"
          class="group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition"
          :style="{
            background: selectedPath === file.path ? t.bgActive : 'transparent',
          }"
          @click="emit('select', file.path)"
          @contextmenu.prevent="emit('context-menu', $event, file)"
        >
          <input
            v-if="showStage"
            type="checkbox"
            class="cursor-pointer flex-shrink-0"
            :checked="file.isStaged"
            :style="{ accentColor: t.accent }"
            @click.stop
            @change="onToggle(file)"
          />
          <span
            class="text-[0.71em] font-mono w-3.5 text-center flex-shrink-0"
            :style="{ color: badgeColor(file) }"
          >
            {{ badgeChar(file) }}
          </span>
          <span class="text-xs truncate flex-1 font-mono" :style="{ color: t.text }">
            {{ file.path }}
          </span>
          <button
            class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
            title="Discard changes"
            :style="{ color: t.textDim }"
            @click.stop="emit('discard', file.path)"
          >
            <Trash2 :size="11" />
          </button>
        </div>
      </template>
      <div
        v-else
        ref="virtualContainer"
        class="overflow-auto"
        :style="{ maxHeight: `${VIRTUAL_MAX_HEIGHT}px` }"
        @scroll="onScroll"
      >
        <div :style="{ height: `${files.length * ROW_HEIGHT}px`, position: 'relative' }">
          <div
            :style="{
              position: 'absolute',
              top: `${startIndex * ROW_HEIGHT}px`,
              left: 0,
              right: 0,
            }"
          >
            <div
              v-for="i in visibleRange"
              :key="files[i]?.path ?? i"
              class="group flex items-center gap-2 px-3 cursor-pointer transition"
              :style="{
                height: `${ROW_HEIGHT}px`,
                background: selectedPath === files[i]?.path ? t.bgActive : 'transparent',
              }"
              @click="files[i] && emit('select', files[i]!.path)"
              @contextmenu.prevent="files[i] && emit('context-menu', $event, files[i]!)"
            >
              <input
                v-if="showStage && files[i]"
                type="checkbox"
                class="cursor-pointer flex-shrink-0"
                :checked="files[i]!.isStaged"
                :style="{ accentColor: t.accent }"
                @click.stop
                @change="files[i] && onToggle(files[i]!)"
              />
              <span
                v-if="files[i]"
                class="text-[0.71em] font-mono w-3.5 text-center flex-shrink-0"
                :style="{ color: badgeColor(files[i]!) }"
              >
                {{ badgeChar(files[i]!) }}
              </span>
              <span
                v-if="files[i]"
                class="text-xs truncate flex-1 font-mono"
                :style="{ color: t.text }"
              >
                {{ files[i]!.path }}
              </span>
              <button
                v-if="files[i]"
                class="opacity-0 group-hover:opacity-100 transition p-1 rounded"
                title="Discard changes"
                :style="{ color: t.textDim }"
                @click.stop="emit('discard', files[i]!.path)"
              >
                <Trash2 :size="11" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, Trash2 } from 'lucide-vue-next'
import type { GitFileStatus } from '~/types'

const props = defineProps<{
  label: string
  files: GitFileStatus[]
  selectedPath: string | null
  showStage: boolean
  isStagedSection?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  stage: [path: string]
  unstage: [path: string]
  discard: [path: string]
  'context-menu': [event: MouseEvent, file: GitFileStatus]
}>()

const { t } = useTheme()
const collapsed = ref(false)
const hover = ref(false)

// Virtual scroll (AC-44). Switch on when section has > VIRTUAL_THRESHOLD files
// — naive `v-for` handles small lists faster without DOM overhead.
const VIRTUAL_THRESHOLD = 200
const ROW_HEIGHT = 28 // px — keep in sync with row inline height style
const VIRTUAL_MAX_HEIGHT = 480 // px — section caps; outer scroll still handles overflow
const BUFFER = 10

const virtualContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(VIRTUAL_MAX_HEIGHT)

const onScroll = (e: Event) => {
  const el = e.target as HTMLElement
  scrollTop.value = el.scrollTop
  containerHeight.value = el.clientHeight
}

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER))
const endIndex = computed(() =>
  Math.min(
    props.files.length,
    Math.ceil((scrollTop.value + containerHeight.value) / ROW_HEIGHT) + BUFFER,
  ),
)
const visibleRange = computed(() => {
  const range: number[] = []
  for (let i = startIndex.value; i < endIndex.value; i += 1) range.push(i)
  return range
})

const onToggle = (file: GitFileStatus) => {
  if (file.isStaged) emit('unstage', file.path)
  else emit('stage', file.path)
}

const badgeChar = (file: GitFileStatus): string => {
  if (file.hasConflict) return 'U'
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return '?'
    case 'conflicted':
      return 'U'
    default:
      return '·'
  }
}

const badgeColor = (file: GitFileStatus): string => {
  if (file.hasConflict) return t.value.gitConflict
  const code = file.isStaged ? file.index : file.workTree
  switch (code) {
    case 'added':
      return t.value.gitAdded
    case 'modified':
    case 'renamed':
    case 'copied':
      return t.value.gitModified
    case 'deleted':
      return t.value.gitDeleted
    case 'untracked':
      return t.value.gitUntracked
    default:
      return t.value.textDim
  }
}

// isStagedSection: reserved cho overload (vd. ẩn Discard ở Staged) — chưa dùng v1.
</script>
