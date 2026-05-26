<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="!blocks"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      Select a conflicted file
    </div>
    <template v-else>
      <div
        class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <AlertTriangle :size="12" :style="{ color: t.gitConflict }" />
        <span class="text-xs font-mono truncate flex-1" :style="{ color: t.text }">{{ path }}</span>
        <span class="text-[10px]" :style="{ color: t.textDim }">
          {{ resolvedCount }} / {{ blocks.length }} resolved
        </span>
        <button
          class="text-[10px] px-2 py-1 rounded font-medium transition"
          :style="markBtnStyle"
          :disabled="!allResolved"
          @click="onMarkResolved"
        >
          Mark resolved
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-3">
        <div
          v-for="(block, i) in blocks"
          :key="i"
          class="rounded overflow-hidden"
          :style="{ border: `1px solid ${blockBorder(block)}` }"
        >
          <div
            class="px-3 py-1.5 flex items-center gap-2 text-[10px]"
            :style="{
              background: t.bgPanel,
              color: t.textDim,
              borderBottom: `1px solid ${t.border}`,
            }"
          >
            <span class="font-mono">Conflict #{{ i + 1 }}</span>
            <span :style="{ color: t.textFaint }">·</span>
            <span>lines {{ block.startLine }}–{{ block.endLine }}</span>
            <span class="ml-auto font-mono">{{ resolutionLabel(block) }}</span>
          </div>

          <div class="grid" :style="{ gridTemplateColumns: '1fr 1fr' }">
            <div
              class="p-3 cursor-pointer transition"
              :style="{
                background: pickBg(block, 'ours'),
                borderRight: `1px solid ${t.border}`,
              }"
              @click="onPick(i, 'ours')"
            >
              <div class="text-[10px] uppercase tracking-wider mb-1" :style="{ color: t.diffOurs }">
                Ours (HEAD)
              </div>
              <pre
                class="text-[12px] font-mono whitespace-pre-wrap"
                :style="{ color: t.text }"
              ><code>{{ block.ours }}</code></pre>
            </div>
            <div
              class="p-3 cursor-pointer transition"
              :style="{ background: pickBg(block, 'theirs') }"
              @click="onPick(i, 'theirs')"
            >
              <div
                class="text-[10px] uppercase tracking-wider mb-1"
                :style="{ color: t.diffTheirs }"
              >
                Theirs (incoming)
              </div>
              <pre
                class="text-[12px] font-mono whitespace-pre-wrap"
                :style="{ color: t.text }"
              ><code>{{ block.theirs }}</code></pre>
            </div>
          </div>

          <div
            class="px-3 py-2 flex items-center gap-1"
            :style="{ background: t.bgPanel, borderTop: `1px solid ${t.border}` }"
          >
            <button
              class="text-[10px] px-2 py-1 rounded transition"
              :style="pickBtnStyle(block, 'ours')"
              @click="onPick(i, 'ours')"
            >
              Use ours
            </button>
            <button
              class="text-[10px] px-2 py-1 rounded transition"
              :style="pickBtnStyle(block, 'theirs')"
              @click="onPick(i, 'theirs')"
            >
              Use theirs
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { GitConflictResolutionChoice, GitMergeConflictBlock } from '~/types'

const props = defineProps<{
  path: string | null
}>()

const { t } = useTheme()
const store = useGitStore()

const blocks = computed<GitMergeConflictBlock[] | null>(() => {
  if (!props.path) return null
  return store.conflictBlocksByPath[props.path] ?? null
})

const resolvedCount = computed(
  () => blocks.value?.filter((b) => b.resolution !== 'unresolved').length ?? 0,
)
const allResolved = computed(
  () => !!blocks.value && blocks.value.length > 0 && resolvedCount.value === blocks.value.length,
)

const onPick = (index: number, choice: GitConflictResolutionChoice) => {
  if (!props.path) return
  store.resolveConflict(props.path, index, choice)
}

const onMarkResolved = () => {
  // Block đã được resolve khi user pick — chỉ cần đảm bảo file đã staged.
  // Hành vi mark resolved thực ra đã chạy trong resolveConflict khi all resolved.
  // Đây là no-op visual; có thể navigate về tab Changes sau.
}

const pickBg = (block: GitMergeConflictBlock, side: 'ours' | 'theirs') => {
  if (block.resolution === side) {
    return side === 'ours' ? 'rgba(125, 211, 252, 0.12)' : 'rgba(196, 181, 253, 0.12)'
  }
  return t.value.bg
}

const pickBtnStyle = (block: GitMergeConflictBlock, side: 'ours' | 'theirs') => {
  const active = block.resolution === side
  const activeColor = side === 'ours' ? t.value.diffOurs : t.value.diffTheirs
  return {
    background: active ? activeColor : t.value.bgInput,
    color: active ? t.value.accentText : t.value.textMuted,
    border: `1px solid ${active ? 'transparent' : t.value.border}`,
  }
}

const blockBorder = (block: GitMergeConflictBlock) => {
  if (block.resolution === 'unresolved') return t.value.gitConflict
  return t.value.border
}

const resolutionLabel = (block: GitMergeConflictBlock) => {
  if (block.resolution === 'unresolved') return 'unresolved'
  if (block.resolution === 'ours') return '✓ ours'
  if (block.resolution === 'theirs') return '✓ theirs'
  return block.resolution
}

const markBtnStyle = computed(() => ({
  background: allResolved.value ? t.value.accent : t.value.bgInput,
  color: allResolved.value ? t.value.accentText : t.value.textDim,
  border: `1px solid ${allResolved.value ? t.value.accent : t.value.border}`,
  cursor: allResolved.value ? 'pointer' : 'not-allowed',
}))
</script>
