<template>
  <div class="flex flex-none items-center gap-0.5 border-b px-3.5 py-1.5">
    <Tabs :model-value="tab" @update:model-value="(v) => emit('set-tab', v as CommitTab)">
      <TabsList class="h-auto gap-0.5 bg-transparent p-0">
        <TabsTrigger value="commit" :class="TAB">{{ t('git.detail.tabCommit') }}</TabsTrigger>
        <TabsTrigger value="changes" :class="TAB">{{ t('git.detail.tabChanges') }}</TabsTrigger>
        <TabsTrigger value="tree" :class="TAB">{{ t('git.detail.tabTree') }}</TabsTrigger>
      </TabsList>
    </Tabs>
    <span class="flex-1" />
    <!-- mono-ok: SHA rút gọn -->
    <span class="font-mono text-xs text-primary">{{ commit.h }}</span>
  </div>

  <div v-if="tab === 'commit'" class="flex-1 overflow-y-auto p-4">
    <!-- Message first, metadata under it. The subject is what the reader opened
         the commit for; author/SHA/parent are the inspector, not the headline. -->
    <div class="mb-2 text-lg font-semibold text-foreground">{{ commit.m }}</div>
    <div v-if="commit.body" class="max-w-190 text-base whitespace-pre-wrap text-muted-foreground">
      {{ commit.body }}
    </div>
    <!-- Khối inspector: không khung card — chỉ một hairline phía trên. -->
    <div class="mt-4.5 max-w-190 border-t pt-3.5">
      <div :class="KV_ROW">
        <span :class="KV_K">{{ t('git.detail.author') }}</span>
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <span
            class="grid size-4.5 flex-none place-items-center rounded-full bg-selected text-xs font-semibold text-primary"
          >
            {{ avatarOf(commit.a) }}
          </span>
          <span class="text-sm font-semibold text-foreground">{{ commit.a }}</span>
          <!-- mono-ok: địa chỉ email -->
          <span v-if="commit.email" class="truncate font-mono text-xs text-dim">
            {{ commit.email }}
          </span>
          <span class="flex-1" />
          <span class="flex-none text-xs text-dim">{{ commit.w }}</span>
        </span>
      </div>
      <div :class="KV_ROW">
        <span :class="KV_K">{{ t('git.detail.sha') }}</span>
        <!-- mono-ok: SHA đầy đủ (select-all để copy) -->
        <span class="font-mono text-sm text-muted-foreground select-all">
          {{ commit.sha || commit.h }}
        </span>
      </div>
      <div :class="KV_ROW">
        <span :class="KV_K">{{ t('git.detail.parent') }}</span>
        <!-- mono-ok: SHA commit cha -->
        <Button
          v-if="parent"
          variant="outline"
          size="xs"
          class="h-auto rounded-sm px-1.5 py-0.5 font-mono font-normal text-primary hover:border-ring hover:text-primary"
          @click="emit('select-commit', parent)"
        >
          {{ parent }}
        </Button>
        <span v-else class="min-w-0 flex-1 text-muted-foreground">
          {{ t('git.detail.root') }}
        </span>
      </div>
    </div>
  </div>

  <!-- 2-pane: changed-files list (left) ↔ selected file's diff (right), mỗi cột tự cuộn. -->
  <div v-else-if="tab === 'changes'" class="flex min-h-0 flex-1 overflow-hidden">
    <div class="w-62 min-w-42 flex-none overflow-y-auto border-r px-2.5 py-3">
      <div class="mb-2 text-xs font-semibold text-dim">
        {{ t('git.detail.filesChanged', { n: files.length }) }}
      </div>
      <div
        v-for="f in files"
        :key="f.f"
        :class="[FILE_ROW, { [FILE_ROW_ON]: activeFile === f.f }]"
        @click="picked = f.f"
        @contextmenu.prevent="emit('context-file', $event, f.f)"
      >
        <span
          :class="[STATUS_LETTER, statusVisual(f.st).cls]"
          :title="t(`git.fileStatus.${statusVisual(f.st).key}`)"
        >
          {{ statusVisual(f.st).letter }}
        </span>
        <span :class="FILE_NAME">
          <!-- mono-ok: phần thư mục của path -->
          <span :class="FILE_DIR">{{ dir(f.f) }}</span>
          <span :class="[FILE_BASE, { 'text-foreground': activeFile === f.f }]">
            {{ base(f.f) }}
          </span>
        </span>
      </div>
    </div>
    <!-- Diff tràn viền (giống viewer Local Changes): không khung card. -->
    <div class="min-w-0 flex-1 overflow-auto">
      <!-- mono-ok: nội dung diff -->
      <div v-if="activeFile && activeDiffRows.length" class="overflow-x-hidden font-mono text-sm">
        <GitDiffLine v-for="(l, i) in activeDiffRows" :key="i" :line="l" />
      </div>
      <div v-else class="px-1 py-2 text-sm text-muted-foreground">
        {{ t('git.detail.noDiff') }}
      </div>
    </div>
  </div>

  <div v-else class="flex-1 overflow-y-auto p-4">
    <!-- mono-ok: cây file của commit -->
    <div class="font-mono text-sm leading-(--lh-xl)">
      <div v-for="f in files" :key="f.f" @contextmenu.prevent="emit('context-file', $event, f.f)">
        <span v-if="f.st === 'A'" class="text-diff-add">A</span>
        <span v-else class="text-diff-mod">M</span>
        {{ f.f }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Git commit detail — COMMIT / CHANGES / FILE TREE tabs.
// Ported from commitDetail in awog-prototype.html.
import type { Commit, CommitTab, DiffLine, DiffRow, GitFile } from './git-types'
import { avatarOf, baseNameOf, shortPath, statusVisual } from './git-types'
import { FILE_BASE, FILE_DIR, FILE_NAME, FILE_ROW, FILE_ROW_ON, STATUS_LETTER } from './git-ui'
import Button from '~/components/ui/button/Button.vue'
import Tabs from '~/components/ui/tabs/Tabs.vue'
import TabsList from '~/components/ui/tabs/TabsList.vue'
import TabsTrigger from '~/components/ui/tabs/TabsTrigger.vue'

const props = defineProps<{
  commit: Commit
  parent: string | null
  tab: CommitTab
  files?: GitFile[]
  // Per-file diff lines keyed by path (built by store.loadCommitDiff).
  diffByPath?: Record<string, DiffLine[]>
}>()

const emit = defineEmits<{
  (e: 'set-tab', tab: CommitTab): void
  (e: 'select-commit', hash: string): void
  (e: 'context-file', event: MouseEvent, file: string): void
}>()

const { t } = useI18n()

// Tab COMMIT / CHANGES / FILE TREE: đang chọn = accent-tint.
const TAB =
  'rounded-sm px-3 py-1 text-xs font-semibold text-dim shadow-none hover:bg-accent hover:text-foreground data-[state=active]:bg-selected data-[state=active]:text-primary data-[state=active]:shadow-none'
const KV_ROW = 'mb-2.5 flex items-center gap-3'
const KV_K = 'w-16 flex-none text-xs text-dim'

// Diff lines render as plain text colored by line type only (no syntax
// tokenizing — see GitDiffViewer: per-token colors looked noisy over add/del).
function toRows(lines: DiffLine[]): DiffRow[] {
  return lines.map((l) => ({
    cls: l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '@' ? 'hunk' : '',
    n: l.n ?? '',
    tokens: [{ text: l.s, cls: '' as const }],
  }))
}

// Real per-commit data (IPC) wins; fall back to the loaded commit.files.
const files = computed<GitFile[]>(() =>
  props.files && props.files.length ? props.files : props.commit.files,
)

// CHANGES tab: which file's diff shows in the right pane. The user's pick wins
// while it's still in the list; otherwise default to the first file. Derived (not
// a watch) so it survives the async load race — files/diffByPath arrive after the
// detail pane mounts, and activeFile must track them without a stale null.
const picked = ref<string | null>(null)
const activeFile = computed<string | null>(() => {
  const list = files.value
  if (picked.value && list.some((f) => f.f === picked.value)) return picked.value
  return list[0]?.f ?? null
})

const activeDiffRows = computed<DiffRow[]>(() =>
  toRows((activeFile.value && props.diffByPath?.[activeFile.value]) || []),
)

const base = (f: string) => baseNameOf(f)
const dir = (f: string) => shortPath(f)[0]
</script>
