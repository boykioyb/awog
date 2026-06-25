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
    <span class="mono" style="color: var(--accent); font-size: 0.8462rem">{{ commit.h }}</span>
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

  <div v-else-if="tab === 'changes'" class="cdbody">
    <div class="sech">Files changed · {{ files.length }}</div>
    <div v-for="f in files" :key="f.f" class="gfile" style="cursor: default">
      <span class="gm" :style="{ color: statusColor(f.st) }">{{ f.st }}</span>
      <span class="gnm2">
        <span class="gp">{{ dir(f.f) }}</span>
        <span class="gn">{{ base(f.f) }}</span>
      </span>
    </div>
    <div class="sech">Diff</div>
    <template v-if="hasRealDiff">
      <div class="codeview">
        <div class="cvhead">
          <Icon name="git" style="width: 12px; height: 12px" />
          <span>{{ files[0]?.f }}</span>
          <span class="cvlang">diff</span>
        </div>
        <div class="cvdiff">
          <GitDiffLine v-for="(l, i) in realDiff" :key="i" :line="l" />
        </div>
      </div>
    </template>
    <template v-else>
      <div class="codeview">
        <div class="cvhead">
          <Icon name="git" style="width: 12px; height: 12px" />
          <span>{{ commit.files[0]?.f }}</span>
          <span class="cvlang">diff</span>
        </div>
        <div class="cvdiff">
          <GitDiffLine v-for="(l, i) in diff1" :key="i" :line="l" />
        </div>
      </div>
      <div v-if="commit.files[1]" class="codeview">
        <div class="cvhead">
          <Icon name="git" style="width: 12px; height: 12px" />
          <span>{{ commit.files[1].f }}</span>
          <span class="cvlang">diff</span>
        </div>
        <div class="cvdiff">
          <GitDiffLine v-for="(l, i) in diff2" :key="i" :line="l" />
        </div>
      </div>
    </template>
  </div>

  <div v-else class="cdbody">
    <div class="ftree" style="line-height: 2">
      <div v-for="f in files" :key="f.f">
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
import {
  DEMO_DIFF,
  DEMO_DIFF2,
  avatarOf,
  baseNameOf,
  shortPath,
  statusColor,
  tokenizeCode,
} from './git-types'

const props = defineProps<{
  commit: Commit
  parent: string | null
  tab: CommitTab
  files?: GitFile[]
  diff?: DiffLine[]
}>()

const emit = defineEmits<{
  (e: 'set-tab', tab: CommitTab): void
  (e: 'select-commit', hash: string): void
}>()

function toRows(lines: DiffLine[]): DiffRow[] {
  return lines.map((l) => ({
    cls: l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '@' ? 'hunk' : '',
    n: l.n ?? '',
    tokens: l.t === '@' ? [{ text: l.s, cls: '' as const }] : tokenizeCode(l.s),
  }))
}

const diff1 = computed(() => toRows(DEMO_DIFF))
const diff2 = computed(() => toRows(DEMO_DIFF2))

// Real per-commit data (IPC) wins; fall back to the mock commit.files / DEMO diff.
const files = computed<GitFile[]>(() =>
  props.files && props.files.length ? props.files : props.commit.files,
)
const hasRealDiff = computed(() => !!props.diff && props.diff.length > 0)
const realDiff = computed(() => toRows(props.diff ?? []))

const base = (f: string) => baseNameOf(f)
const dir = (f: string) => shortPath(f)[0]
</script>
