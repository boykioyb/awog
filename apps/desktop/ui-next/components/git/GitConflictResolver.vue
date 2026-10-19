<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Toolbar: filename + progress chip + take-all + Mark resolved -->
    <!-- Header cao cố định: hairline bằng inset shadow để không ăn 1px chiều cao. -->
    <div
      class="flex h-12.5 flex-none items-center gap-2.5 px-5.5 shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      <!-- mono-ok: tên file -->
      <span class="flex min-w-0 items-center font-mono text-sm font-semibold">
        <span class="truncate" :title="path">{{ baseName }}</span>
      </span>
      <Badge
        v-if="mode === 'text'"
        variant="secondary"
        class="flex-none rounded-sm px-1.5 py-0 font-normal tabular-nums"
      >
        {{ t('git.conflict.chosenCount', { chosen, total }) }}
      </Badge>
      <span class="flex-1" />
      <template v-if="mode === 'text'">
        <Button variant="outline" size="sm" type="button" @click="pickAll('ours')">
          {{ t('git.conflict.takeAllOurs') }}
        </Button>
        <Button variant="outline" size="sm" type="button" @click="pickAll('theirs')">
          {{ t('git.conflict.takeAllTheirs') }}
        </Button>
        <Button size="sm" type="button" :disabled="!allChosen || isResolving" @click="markResolved">
          <Icon name="check" class="size-3.5" />
          {{ t('git.conflict.markResolved') }}
        </Button>
      </template>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <!-- Inline error (desync / gone) — keep resolver open, offer reload (CR-13) -->
      <div
        v-if="errorKey"
        class="mb-3 flex items-center gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"
      >
        <span class="flex-1">{{ t(errorKey) }}</span>
        <Button variant="outline" size="sm" type="button" @click="load">
          {{ t('git.conflict.reload') }}
        </Button>
      </div>

      <!-- Text mode: per-block 2-way pick -->
      <template v-if="mode === 'text'">
        <GitConflictBlock
          v-for="b in blocks"
          :key="b.index"
          :index="b.index"
          :total="total"
          :line="b.startLine"
          :ours="b.ours"
          :theirs="b.theirs"
          :ours-label="b.oursLabel"
          :theirs-label="b.theirsLabel"
          :choice="choices.get(b.index)"
          @pick="(c) => pick(b.index, c)"
        />
      </template>

      <!-- Binary mode: whole-side pick (CR-09) -->
      <div v-else-if="mode === 'binary'" class="rounded-md border p-4">
        <p class="mb-3 text-muted-foreground">{{ t('git.conflict.binary.title') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            type="button"
            :disabled="isResolving"
            @click="resolveBinary('ours')"
          >
            {{ t('git.conflict.binary.takeOurs') }}
          </Button>
          <Button
            variant="outline"
            type="button"
            :disabled="isResolving"
            @click="resolveBinary('theirs')"
          >
            {{ t('git.conflict.binary.takeTheirs') }}
          </Button>
        </div>
      </div>

      <!-- Encoding fallback: external editor + mark staged (CR-10) -->
      <div v-else-if="mode === 'encoding'" class="rounded-md border p-4">
        <p class="mb-3 text-muted-foreground">{{ t('git.conflict.encoding.title') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" type="button" @click="openExternal">
            {{ t('git.conflict.encoding.openExternal') }}
          </Button>
          <Button type="button" @click="markStaged">
            {{ t('git.conflict.encoding.markStaged') }}
          </Button>
          <Button variant="outline" type="button" @click="copyPath">
            {{ t('git.conflict.encoding.copyPath') }}
          </Button>
        </div>
      </div>

      <!-- File no longer in conflict / changed (ENOENT etc.) -->
      <div v-else-if="mode === 'gone'" class="rounded-md border p-4">
        <p class="mb-3 text-muted-foreground">{{ t('git.conflict.error.gone') }}</p>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" type="button" @click="load">
            {{ t('git.conflict.reload') }}
          </Button>
        </div>
      </div>

      <!-- Loading -->
      <div v-else class="rounded-md border p-4">
        <p class="mb-3 text-muted-foreground">…</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Right-pane conflict resolver (replaces the diff viewer for a conflicted file).
// v1 is 2-way pick only — NO Monaco, NO inline edit (QĐ-1). Reads the file via
// store.loadConflictFile, then renders one of four modes: text (per-block ours/
// theirs), binary (whole-side pick), encoding fallback (external editor), or gone.
// All state + handlers live in useConflictResolver(); this SFC is template + bind.
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import { baseNameOf } from './git-types'
import { useConflictResolver } from '~/composables/useConflictResolver'

const props = defineProps<{ path: string }>()

// Abort lives in the page header (global merge/rebase abort), not the resolver —
// so there is no `abort-request`. The resolver only reports a completed resolve.
const emit = defineEmits<{
  (e: 'resolved'): void
}>()

const { t } = useI18n()

const {
  mode,
  blocks,
  choices,
  errorKey,
  isResolving,
  total,
  chosen,
  allChosen,
  load,
  pick,
  pickAll,
  markResolved,
  resolveBinary,
  openExternal,
  markStaged,
  copyPath,
} = useConflictResolver(
  () => props.path,
  () => emit('resolved'),
)

const baseName = computed(() => baseNameOf(props.path))
</script>
