<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      v-if="!file"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      Select a conflicted file
    </div>
    <template v-else-if="file.isBinary">
      <div
        class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <AlertTriangle :size="12" :style="{ color: t.gitConflict }" />
        <span class="text-xs font-mono truncate flex-1" :style="{ color: t.text }">
          {{ file.path }}
        </span>
        <span class="text-[0.71em]" :style="{ color: t.textDim }">binary</span>
      </div>
      <div class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div class="text-xs" :style="{ color: t.textDim }">
          Binary file — chỉ chọn version, không edit inline.
        </div>
        <div class="flex items-center gap-2">
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{ background: t.info, color: t.onAccent }"
            @click="onBinary('ours')"
          >
            Take ours (binary)
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{ background: t.warning, color: t.onAccent }"
            @click="onBinary('theirs')"
          >
            Take theirs (binary)
          </button>
        </div>
      </div>
    </template>
    <template v-else>
      <div
        class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <AlertTriangle :size="12" :style="{ color: t.gitConflict }" />
        <span class="text-xs font-mono truncate flex-1" :style="{ color: t.text }">
          {{ file.path }}
        </span>
        <span class="text-[0.71em]" :style="{ color: t.textDim }">
          {{ resolvedCount }} / {{ file.blocks.length }} resolved
        </span>
        <button
          class="text-[0.71em] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
          title="Take ours cho tất cả block"
          @click="onTakeAll('ours')"
        >
          Take all ours
        </button>
        <button
          class="text-[0.71em] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
          title="Take theirs cho tất cả block"
          @click="onTakeAll('theirs')"
        >
          Take all theirs
        </button>
        <button
          class="text-[0.71em] px-2 py-1 rounded font-medium transition"
          :style="markBtnStyle"
          :disabled="!allResolved"
          @click="onMarkResolved"
        >
          Mark resolved
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-3">
        <div
          v-for="block in file.blocks"
          :key="block.index"
          class="rounded overflow-hidden"
          :style="{ border: `1px solid ${blockBorder(block.index)}` }"
        >
          <div
            class="px-3 py-1.5 flex items-center gap-2 text-[0.71em]"
            :style="{
              background: t.bgPanel,
              color: t.textDim,
              borderBottom: `1px solid ${t.border}`,
            }"
          >
            <span class="font-mono">Conflict #{{ block.index + 1 }}</span>
            <span :style="{ color: t.textFaint }">·</span>
            <span>lines {{ block.startLine }}–{{ block.endLine }}</span>
            <span class="ml-auto font-mono">{{ resolutionLabel(block.index) }}</span>
          </div>

          <div class="grid" :style="{ gridTemplateColumns: '1fr 1fr' }">
            <div
              class="p-3 cursor-pointer transition"
              :style="{
                background: pickBg(block.index, 'ours'),
                borderRight: `1px solid ${t.border}`,
              }"
              @click="onPick(block.index, 'ours')"
            >
              <div class="text-[0.71em] uppercase tracking-wider mb-1" :style="{ color: t.info }">
                Ours ({{ block.oursLabel || 'HEAD' }})
              </div>
              <pre
                class="text-[0.86em] font-mono whitespace-pre-wrap"
                :style="{ color: t.text }"
              ><code>{{ block.ours.join('\n') }}</code></pre>
            </div>
            <div
              class="p-3 cursor-pointer transition"
              :style="{ background: pickBg(block.index, 'theirs') }"
              @click="onPick(block.index, 'theirs')"
            >
              <div class="text-[0.71em] uppercase tracking-wider mb-1" :style="{ color: t.warning }">
                Theirs ({{ block.theirsLabel || 'incoming' }})
              </div>
              <pre
                class="text-[0.86em] font-mono whitespace-pre-wrap"
                :style="{ color: t.text }"
              ><code>{{ block.theirs.join('\n') }}</code></pre>
            </div>
          </div>

          <div
            class="px-3 py-2 flex items-center gap-1"
            :style="{ background: t.bgPanel, borderTop: `1px solid ${t.border}` }"
          >
            <button
              class="text-[0.71em] px-2 py-1 rounded transition"
              :style="pickBtnStyle(block.index, 'ours')"
              @click="onPick(block.index, 'ours')"
            >
              Take ours
            </button>
            <button
              class="text-[0.71em] px-2 py-1 rounded transition"
              :style="pickBtnStyle(block.index, 'theirs')"
              @click="onPick(block.index, 'theirs')"
            >
              Take theirs
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import type { GitConflictFile } from '~/types'

type Choice = 'ours' | 'theirs'

const props = defineProps<{
  path: string | null
}>()

const { t } = useTheme()
const store = useGitStore()

// Per-file resolution map. Cleared whenever the selected path changes.
const resolutions = ref<Map<number, Choice>>(new Map())

const file = computed<GitConflictFile | null>(() => {
  if (!props.path) return null
  if (store.currentConflictFile?.path === props.path) return store.currentConflictFile
  return null
})

watch(
  () => props.path,
  async (next, prev) => {
    if (next === prev) return
    resolutions.value = new Map()
    if (next) await store.loadConflictFile(next)
    else store.clearConflictFile()
  },
  { immediate: true },
)

const resolvedCount = computed(() => {
  if (!file.value) return 0
  return file.value.blocks.filter((b) => resolutions.value.has(b.index)).length
})
const allResolved = computed(() => {
  if (!file.value || file.value.isBinary) return false
  return file.value.blocks.length > 0 && resolvedCount.value === file.value.blocks.length
})

const onPick = (blockIndex: number, choice: Choice) => {
  const next = new Map(resolutions.value)
  next.set(blockIndex, choice)
  resolutions.value = next
}

const onTakeAll = (choice: Choice) => {
  if (!file.value) return
  const next = new Map<number, Choice>()
  for (const block of file.value.blocks) next.set(block.index, choice)
  resolutions.value = next
}

const onMarkResolved = async () => {
  if (!file.value || !allResolved.value) return
  const payload = file.value.blocks.map((b) => {
    // `allResolved` guarantees presence — Map fallback keeps the type narrow.
    const choice = resolutions.value.get(b.index) ?? 'ours'
    return { blockIndex: b.index, choice }
  })
  await store.resolveConflict(file.value.path, payload)
  resolutions.value = new Map()
}

const onBinary = async (choice: Choice) => {
  if (!file.value) return
  await store.resolveConflictBinary(file.value.path, choice)
}

const pickBg = (blockIndex: number, side: Choice) => {
  if (resolutions.value.get(blockIndex) === side) {
    return side === 'ours' ? t.value.diffOurs : t.value.diffTheirs
  }
  return t.value.bg
}

const pickBtnStyle = (blockIndex: number, side: Choice) => {
  const active = resolutions.value.get(blockIndex) === side
  return {
    background: active ? (side === 'ours' ? t.value.info : t.value.warning) : t.value.bgInput,
    color: active ? t.value.onAccent : t.value.textMuted,
    border: `1px solid ${active ? 'transparent' : t.value.border}`,
  }
}

const blockBorder = (blockIndex: number) => {
  if (!resolutions.value.has(blockIndex)) return t.value.gitConflict
  return t.value.border
}

const resolutionLabel = (blockIndex: number) => {
  const choice = resolutions.value.get(blockIndex)
  if (!choice) return 'unresolved'
  return choice === 'ours' ? 'check ours' : 'check theirs'
}

const markBtnStyle = computed(() => ({
  background: allResolved.value ? t.value.accent : t.value.bgInput,
  color: allResolved.value ? t.value.accentText : t.value.textDim,
  border: `1px solid ${allResolved.value ? t.value.accent : t.value.border}`,
  cursor: allResolved.value ? 'pointer' : 'not-allowed',
}))
</script>
