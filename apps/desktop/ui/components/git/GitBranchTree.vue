<template>
  <div>
    <template v-for="row in rows" :key="`${row.kind}:${row.depth}:${row.id}`">
      <div
        v-if="row.kind === 'folder'"
        class="flex items-center gap-1 px-3 py-1.5 cursor-pointer transition select-none"
        :style="{
          background: hovered === `folder:${row.id}` ? t.bgHover : 'transparent',
          paddingLeft: `${12 + row.depth * 14}px`,
        }"
        @mouseenter="hovered = `folder:${row.id}`"
        @mouseleave="hovered = null"
        @click="emit('toggle-folder', row.id)"
      >
        <ChevronRight
          v-if="collapsedFolders.has(row.id)"
          :size="11"
          :style="{ color: t.textDim }"
        />
        <ChevronDown v-else :size="11" :style="{ color: t.textDim }" />
        <Folder :size="12" :style="{ color: t.textDim }" />
        <span
          class="text-[1em] font-medium truncate"
          :class="isRemote ? 'font-mono' : ''"
          :style="{ color: t.textMuted }"
        >
          {{ row.displayName }}
        </span>
        <span class="text-[1em]" :style="{ color: t.textFaint }">({{ row.leafCount }})</span>
      </div>
      <div
        v-else
        class="group flex items-center gap-2 px-3 py-2 cursor-pointer transition"
        :style="{
          background: hovered === `${hoverPrefix}${row.branch.name}` ? t.bgHover : 'transparent',
          borderLeft:
            !isRemote && row.branch.isCurrent ? `2px solid ${t.accent}` : '2px solid transparent',
          paddingLeft: `${12 + row.depth * 14}px`,
        }"
        @mouseenter="hovered = `${hoverPrefix}${row.branch.name}`"
        @mouseleave="hovered = null"
        @click="!isRemote && emit('checkout', row.branch.name, row.branch.isCurrent)"
        @contextmenu.prevent="
          emit('context-menu', $event, row.branch.name, isRemote, row.branch.isCurrent)
        "
      >
        <Cloud v-if="isRemote" :size="12" :style="{ color: t.textDim }" />
        <GitBranchIcon
          v-else
          :size="12"
          :style="{ color: row.branch.isCurrent ? t.accent : t.textDim }"
        />
        <span
          class="text-[1em] flex-1 truncate"
          :class="isRemote ? 'font-mono' : ''"
          :style="{ color: isRemote ? t.textMuted : t.text }"
        >
          {{ row.displayName }}
        </span>
        <span
          v-if="!isRemote && row.branch.isCurrent"
          class="text-[1em]"
          :style="{ color: t.textDim }"
        >
          current
        </span>
        <span
          v-if="!isRemote && (row.branch.ahead > 0 || row.branch.behind > 0)"
          class="text-[1em] font-mono"
          :style="{ color: t.textDim }"
        >
          {{ row.branch.ahead > 0 ? `↑${row.branch.ahead}` : ''
          }}{{ row.branch.behind > 0 ? ` ↓${row.branch.behind}` : '' }}
        </span>
        <button
          v-if="!hideActions"
          class="opacity-0 group-hover:opacity-100 p-1 rounded transition"
          title="More actions"
          :style="{ color: t.textDim }"
          @click.stop="onMoreClick($event, row.branch.name, row.branch.isCurrent)"
        >
          <MoreHorizontal :size="11" />
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  GitBranch as GitBranchIcon,
  MoreHorizontal,
} from 'lucide-vue-next'
import type { Row } from '~/utils/branch-tree'

type Props = {
  rows: Row[]
  collapsedFolders: ReadonlySet<string>
  isRemote?: boolean
  // Hide the per-row "more actions" button (used by the compact branch picker in
  // the Git header, which only needs checkout + folder toggle).
  hideActions?: boolean
}

const props = withDefaults(defineProps<Props>(), { isRemote: false, hideActions: false })

const emit = defineEmits<{
  'toggle-folder': [path: string]
  checkout: [name: string, isCurrent: boolean]
  'context-menu': [event: MouseEvent, name: string, isRemote: boolean, isCurrent: boolean]
  'more-menu': [event: MouseEvent, name: string, isRemote: boolean, isCurrent: boolean]
}>()

const { t } = useTheme()
const hovered = ref<string | null>(null)

const hoverPrefix = computed(() => (props.isRemote ? 'rbranch:' : 'branch:'))

const onMoreClick = (e: MouseEvent, name: string, isCurrent: boolean) => {
  emit('more-menu', e, name, props.isRemote, isCurrent)
}
</script>
