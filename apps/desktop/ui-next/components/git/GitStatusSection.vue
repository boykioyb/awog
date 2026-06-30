<template>
  <div>
    <!-- Section header -->
    <div class="gstatsec" @click="collapsed = !collapsed">
      <svg class="icn gchv" :class="{ col: collapsed }"><use href="#i-chev" /></svg>
      <span class="gstatlbl">{{ label }}</span>
      <span class="gstatct">{{ files.length }}</span>
      <span
        v-if="!staged && files.length"
        class="gstatact"
        :title="t('git.status.discardAll')"
        @click.stop="discardAll"
      >
        <Icon name="revert" style="width: 11px; height: 11px" />
      </span>
    </div>

    <template v-if="!collapsed">
      <!-- Tree view: real nested folders (single-child chains collapsed) -->
      <template v-if="chTree">
        <template v-for="row in treeRows" :key="row.id">
          <div
            v-if="row.kind === 'dir'"
            class="gtdir"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="toggleDir(row.path)"
            @contextmenu.prevent="emit('context-folder', $event, row.path, staged)"
          >
            <svg class="icn fchv" :class="{ col: collapsedDirs.has(row.path) }">
              <use href="#i-chev" />
            </svg>
            <Icon name="folder" style="width: 12px; height: 12px" />
            <span class="gtrunc">{{ row.label }}</span>
          </div>
          <div
            v-else
            class="gfile"
            :class="{ on: sel?.path === row.path && sel?.staged === staged }"
            :style="{ paddingLeft: pad(row.depth) }"
            @click="emit('select', row.path, staged)"
            @contextmenu.prevent="emit('context-file', $event, row.path, staged)"
          >
            <input
              type="checkbox"
              class="gck"
              :checked="staged"
              @click.stop
              @change="emit('toggle-stage', row.path, staged)"
            />
            <span class="gm" :style="{ color: statusColor(row.item.st) }">{{ row.item.st }}</span>
            <span class="gnm2">
              <span class="gn">{{ row.label }}</span>
            </span>
            <span
              class="gstage"
              :title="t('git.changes.discard')"
              @click.stop="emit('discard', row.path)"
            >
              <Icon name="revert" style="width: 12px; height: 12px" />
            </span>
          </div>
        </template>
      </template>

      <!-- Flat view: full path per row -->
      <template v-else>
        <div
          v-for="x in files"
          :key="x.f"
          class="gfile"
          :class="{ on: sel?.path === x.f && sel?.staged === staged }"
          @click="emit('select', x.f, staged)"
          @contextmenu.prevent="emit('context-file', $event, x.f, staged)"
        >
          <input
            type="checkbox"
            class="gck"
            :checked="staged"
            @click.stop
            @change="emit('toggle-stage', x.f, staged)"
          />
          <span class="gm" :style="{ color: statusColor(x.st) }">{{ x.st }}</span>
          <span class="gnm2">
            <span class="gp">{{ dirName(x.f) }}</span>
            <span class="gn">{{ baseName(x.f) }}</span>
          </span>
          <span class="gstage" :title="t('git.changes.discard')" @click.stop="emit('discard', x.f)">
            <Icon name="revert" style="width: 12px; height: 12px" />
          </span>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// One working-tree section (Staged / Changes) — collapsible header + a real
// nested folder tree (or flat full-path rows). Mirrors production GitStatusSection.
import type { GitFile, GitSelection } from './git-types'
import { baseNameOf, buildPathTreeRows, shortPath, statusColor } from './git-types'

const props = defineProps<{
  label: string
  files: GitFile[]
  staged: boolean
  chTree: boolean
  sel: GitSelection | null
}>()

const emit = defineEmits<{
  (e: 'select', file: string, staged: boolean): void
  (e: 'discard', file: string): void
  (e: 'discard-all', files: string[]): void
  (e: 'toggle-stage', file: string, staged: boolean): void
  (e: 'context-file', event: MouseEvent, file: string, staged: boolean): void
  (e: 'context-folder', event: MouseEvent, path: string, staged: boolean): void
}>()

const { t } = useI18n()

const collapsed = ref(false)
const collapsedDirs = ref<Set<string>>(new Set())

const treeRows = computed(() => buildPathTreeRows(props.files, collapsedDirs.value))

function toggleDir(path: string) {
  const next = new Set(collapsedDirs.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsedDirs.value = next
}

// Indent: dirs at depth d, files at depth d+1 → files nest one step deeper.
const pad = (depth: number) => `${8 + depth * 14}px`

const baseName = (f: string) => baseNameOf(f)
const dirName = (f: string) => shortPath(f)[0]

function discardAll() {
  // Emit once with the full list so the parent can gate it behind a single
  // confirm — looping per-file `discard` here would pop one dialog per file.
  emit(
    'discard-all',
    props.files.map((x) => x.f),
  )
}
</script>
