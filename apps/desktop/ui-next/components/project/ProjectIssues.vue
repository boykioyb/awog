<template>
  <div class="ghpane">
    <div class="ghhead">
      <span v-if="multiRepo" class="chip chipbtn" :title="t('projects.gh.filterRepo')">
        <Icon name="git" style="width: 12px; height: 12px" />
        {{ repo === 'all' ? t('projects.gh.allRepos') : repo }}
        <Icon name="chev" style="width: 11px; height: 11px" />
      </span>
      <span class="chip chipbtn" :title="t('projects.gh.account')">
        <Icon name="agents" style="width: 12px; height: 12px" />
        {{ acc }}
        <Icon name="chev" style="width: 11px; height: 11px" />
      </span>
      <span class="chip chipbtn">
        {{ t('projects.gh.state.' + stateFilter) }}
        <Icon name="chev" style="width: 11px; height: 11px" />
      </span>
      <span class="chip chipbtn">
        @{{
          assignee === '@me'
            ? t('projects.gh.assigneeMe')
            : assignee || t('projects.gh.assigneeAnyone')
        }}
        <Icon name="chev" style="width: 11px; height: 11px" />
      </span>
      <div class="srch" style="flex: 1; min-width: 120px; max-width: 220px">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input v-model="query" :placeholder="t('projects.gh.search')" />
      </div>
      <button class="iconbtn" :title="t('projects.gh.refresh')" style="width: 30px; height: 30px">
        <Icon name="refresh" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="ghlist">
      <div v-for="it in items" :key="it.n" class="ghrow" @click="emit('open', it.n)">
        <div class="ghr1">
          <Icon :name="kind === 'pr' ? 'fork' : 'alert'" style="width: 13px; height: 13px" />
          <span class="ghnum">#{{ it.n }}</span>
          <span class="ghtitle">{{ it.title }}</span>
          <span v-if="it.repo && multiRepo" class="ghrepo">
            <Icon name="git" style="width: 10px; height: 10px" />
            {{ it.repo }}
          </span>
          <span
            class="ghstate"
            :style="{ color: stateColor(it.state), borderColor: stateColor(it.state) }"
          >
            {{ t('projects.gh.state.' + it.state) }}
          </span>
          <span
            v-if="kind === 'pr' && it.draft"
            class="ghstate"
            style="color: var(--textDim); border-color: var(--border)"
          >
            {{ t('projects.gh.state.draft') }}
          </span>
        </div>
        <div class="ghr2">
          <span v-if="kind === 'pr' && it.base" class="mono">{{ it.base }} ← {{ it.head }}</span>
          <span
            v-for="l in it.labels ?? []"
            :key="l.n"
            class="ghlabel"
            :style="{ color: l.c, borderColor: l.c }"
          >
            {{ l.n }}
          </span>
          <span style="margin-left: auto; font-family: var(--code)">
            {{ it.author }} · {{ it.up }}
          </span>
        </div>
      </div>
      <div v-if="!items.length" class="empty" style="padding: 36px">
        <span class="ei"><Icon name="git" style="width: 20px; height: 20px" /></span>
        <div class="et">
          {{
            t(kind === 'pr' ? 'projects.gh.emptyPr' : 'projects.gh.emptyIssue', {
              repo: repo !== 'all' ? t('projects.gh.inRepo', { repo }) : '',
              state: stateFilter,
            })
          }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GhItem, Project } from './data'

// Issues / Pull Requests tab — port of ghTabHtml()/ghRow() (~2256–2268): filter
// chips + state-dot rows. Filter chips are display-only for now (the listMenu
// popovers are deferred); the search box + state/repo/assignee refs drive filtering.
const props = defineProps<{ project: Project; kind: 'issue' | 'pr' }>()
const emit = defineEmits<{ (e: 'open', n: number): void }>()
const { t } = useI18n()

const query = ref('')
const repo = ref('all')
const stateFilter = ref('open')
const assignee = ref('')
const acc = ref('hoatq')

const ghRepos = computed(() => props.project.repos.filter((r) => r.gh))
const multiRepo = computed(() => ghRepos.value.length > 1)

const items = computed<GhItem[]>(() => {
  let a = (props.kind === 'pr' ? props.project.prs : props.project.issues).slice()
  if (repo.value !== 'all') a = a.filter((it) => it.repo === repo.value)
  if (stateFilter.value !== 'all') a = a.filter((it) => it.state === stateFilter.value)
  if (assignee.value === '@me') a = a.filter((it) => (it.assignees ?? []).includes(acc.value))
  else if (assignee.value) a = a.filter((it) => (it.assignees ?? []).includes(assignee.value))
  const q = query.value.trim().toLowerCase()
  if (q) a = a.filter((it) => `${it.title} #${it.n}`.toLowerCase().includes(q))
  return a
})

function stateColor(s: GhItem['state']): string {
  return s === 'open' ? 'var(--green)' : s === 'merged' ? 'var(--violet)' : 'var(--textDim)'
}
</script>
