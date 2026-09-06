<template>
  <div class="ctabs">
    <span class="ctab" :class="{ on: tab === 'commit' }" @click="emit('set-tab', 'commit')">
      COMMIT
    </span>
    <span class="ctab" :class="{ on: tab === 'changes' }" @click="emit('set-tab', 'changes')">
      CHANGES
    </span>
    <span class="ctab" :class="{ on: tab === 'tree' }" @click="emit('set-tab', 'tree')">
      FILE TREE
    </span>
    <span style="flex: 1" />
    <span class="mono" style="color: var(--accent); font-size: var(--fs-xs)">{{ commit.h }}</span>
  </div>

  <div v-if="tab === 'commit'" class="cdbody">
    <div class="authcard">
      <div class="authlbl">AUTHOR</div>
      <div class="authrow">
        <span class="pav2 lg">{{ avatarOf(commit.a) }}</span>
        <div style="min-width: 0">
          <div class="authn">{{ commit.a }}</div>
          <div class="authe mono">{{ commit.email || '' }}</div>
        </div>
        <span style="flex: 1" />
        <span class="authdate">{{ commit.w }}</span>
      </div>
    </div>
    <div class="kvrow">
      <span class="kvk">SHA</span>
      <span class="shabox mono">{{ commit.sha || commit.h }}</span>
    </div>
    <div class="kvrow">
      <span class="kvk">Parent</span>
      <span
        v-if="parent"
        class="chip mono chipbtn"
        style="color: var(--accent)"
        @click="emit('select-commit', parent)"
      >
        {{ parent }}
      </span>
      <span v-else class="kvv" style="color: var(--textDim)">— (root)</span>
    </div>
    <div class="cdtitle">{{ commit.m }}</div>
    <div class="cdmsg">{{ commit.body || '' }}</div>
  </div>

  <!-- 2-pane: changed-files list (left) ↔ selected file's diff (right). -->
  <div v-else-if="tab === 'changes'" class="cdchanges">
    <div class="cdflist">
      <div class="sech">{{ t('git.detail.filesChanged', { n: files.length }) }}</div>
      <div
        v-for="f in files"
        :key="f.f"
        class="gfile"
        :class="{ on: activeFile === f.f }"
        @click="picked = f.f"
        @contextmenu.prevent="emit('context-file', $event, f.f)"
      >
        <span
          class="gsti"
          :style="{ color: statusVisual(f.st).color }"
          :title="t(`git.fileStatus.${statusVisual(f.st).key}`)"
        >
          <Icon :name="statusVisual(f.st).icon" />
        </span>
        <span class="gnm2">
          <span class="gp">{{ dir(f.f) }}</span>
          <span class="gn">{{ base(f.f) }}</span>
        </span>
      </div>
    </div>
    <div class="cddiff">
      <div v-if="activeFile && activeDiffRows.length" class="codeview">
        <div class="cvdiff">
          <GitDiffLine v-for="(l, i) in activeDiffRows" :key="i" :line="l" />
        </div>
      </div>
      <div v-else class="cddiffempty">{{ t('git.detail.noDiff') }}</div>
    </div>
  </div>

  <div v-else class="cdbody">
    <div class="ftree" style="line-height: 2">
      <div v-for="f in files" :key="f.f" @contextmenu.prevent="emit('context-file', $event, f.f)">
        <span v-if="f.st === 'A'" class="a2">A</span>
        <span v-else class="m">M</span>
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

<style scoped>
/* CHANGES tab: file list (left) ↔ selected file's diff (right), each scrolls
   independently inside the commit-detail pane. */
.cdchanges {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.cdflist {
  flex: 0 0 248px;
  min-width: 168px;
  overflow-y: auto;
  padding: 12px 10px;
  border-right: 1px solid var(--border);
}
.cddiff {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 0;
}
/* Full-bleed diff (matches the Local Changes viewer): drop the .codeview card
   chrome so the diff fills the pane instead of sitting in an inset box. */
.cddiff .codeview {
  border: none;
  border-radius: 0;
  margin: 0;
  background: transparent;
}
.cddiffempty {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 8px 4px;
}
</style>
