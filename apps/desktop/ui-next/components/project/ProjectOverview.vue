<template>
  <div class="flex-1 overflow-y-auto p-4.5">
    <div class="mb-4 flex flex-wrap gap-2.5">
      <div v-for="st in stats" :key="st.label" :class="STAT">
        <div class="text-2xl font-semibold tracking-tight">{{ st.value }}</div>
        <div class="mt-1.5 text-xs font-semibold text-dim">{{ st.label }}</div>
      </div>
    </div>

    <Card :class="CARD">
      <div :class="CARD_H">
        <Icon name="git" class="size-3.5 flex-none" />
        <span class="text-muted-foreground">
          {{ t('projects.overview.reposCard', { n: effRepos.length }) }}
        </span>
        <Badge v-if="totalDirty" variant="outline" :class="['ml-auto', CHIP_MOD]">
          {{ totalDirty }} M
        </Badge>
        <Badge
          v-if="totalAhead"
          variant="outline"
          :class="[CHIP_AHEAD, { 'ml-auto': !totalDirty }]"
        >
          ↑{{ totalAhead }}
        </Badge>
      </div>
      <div v-if="effRepos.length" class="divide-y">
        <div v-for="r in effRepos" :key="r.n" class="flex items-center gap-3 py-2">
          <span class="grid size-7 flex-none place-items-center rounded-md bg-muted text-dim">
            <Icon name="git" class="size-3.5" />
          </span>
          <div class="min-w-0">
            <div class="text-base font-semibold">{{ r.n }}</div>
            <!-- mono-ok: tên nhánh git -->
            <div v-if="r.br" class="flex items-center gap-1 font-mono text-xs text-dim">
              <Icon name="branch" class="size-3" />
              {{ r.br }}
            </div>
          </div>
          <div class="ml-auto flex gap-1.5">
            <Badge v-if="r.dirty" variant="outline" :class="CHIP_MOD">{{ r.dirty }} M</Badge>
            <Badge v-if="r.ahead" variant="outline" :class="CHIP_AHEAD">↑{{ r.ahead }}</Badge>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-dim">{{ t('projects.overview.noRepo') }}</div>
    </Card>

    <Card :class="CARD">
      <div :class="CARD_H">
        <Icon name="agents" class="size-3.5 flex-none" />
        <span class="text-muted-foreground">
          {{ t('projects.overview.agentsCard', { n: view.agents.length }) }}
        </span>
      </div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="a in view.agents"
          :key="a"
          class="inline-flex items-center gap-2 rounded-md border py-0.5 pr-2.5 pl-1 text-sm text-foreground"
        >
          <!-- Màu avatar là dữ liệu (bảng màu agent ở ./data), không phải token theme. -->
          <span
            class="grid size-5 flex-none place-items-center rounded-full text-xs font-semibold"
            :style="{ color: agBadge(a)[0], background: avatarBg(agBadge(a)[0]) }"
          >
            {{ agBadge(a)[1] }}
          </span>
          {{ a }}
        </span>
        <span v-if="!view.agents.length" class="text-sm text-dim">
          {{ t('projects.overview.noAgent') }}
        </span>
      </div>
    </Card>

    <div class="grid grid-cols-1 gap-3 min-[880px]:grid-cols-2">
      <Card :class="CARD">
        <div :class="CARD_H">
          <Icon name="sessions" class="size-3.5 flex-none" />
          <span class="text-muted-foreground">{{ t('projects.overview.sessionsCard') }}</span>
        </div>
        <div class="divide-y">
          <div
            v-for="s in view.ses"
            :key="s.id"
            class="group/rs flex cursor-pointer items-center gap-3 py-2 transition-colors hover:bg-accent"
            :title="t('projects.overview.openSession')"
            @click="openSession(s.id)"
          >
            <span class="size-2 flex-none rounded-full bg-faint" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium group-hover/rs:text-primary">
              {{ s.t }}
            </span>
            <span class="flex-none text-xs whitespace-nowrap text-faint tabular-nums">
              {{ s.w }}
            </span>
          </div>
        </div>
        <div v-if="!view.ses.length" class="text-sm text-dim">
          {{ t('projects.overview.noSession') }}
        </div>
      </Card>
      <Card :class="CARD">
        <div :class="CARD_H">
          <Icon name="tasks" class="size-3.5 flex-none" />
          <span class="text-muted-foreground">{{ t('projects.overview.tasksCard') }}</span>
        </div>
        <div class="divide-y">
          <div v-for="task in view.tasks" :key="task.t" class="flex items-center gap-3 py-2">
            <Icon name="tasks" class="size-3.5 flex-none" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ task.t }}</span>
            <Badge variant="outline" class="border-primary/40 bg-primary/10 text-primary">
              {{ task.s }}
            </Badge>
          </div>
        </div>
        <div v-if="!view.tasks.length" class="text-sm text-dim">
          {{ t('projects.overview.noTask') }}
        </div>
      </Card>
    </div>

    <Card :class="CARD">
      <div :class="CARD_H">
        <Icon name="folder" class="size-3.5 flex-none" />
        <span class="text-muted-foreground">{{ t('projects.overview.configCard') }}</span>
      </div>
      <div class="divide-y text-sm">
        <div v-if="project.description" :class="[KV_ROW, 'items-start']">
          <span :class="KV_K">{{ t('projects.overview.description') }}</span>
          <span :class="KV_V">{{ project.description }}</span>
        </div>
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.path') }}</span>
          <!-- mono-ok: đường dẫn project -->
          <span :class="[KV_V, 'font-mono']">{{ project.path }}</span>
        </div>
        <div v-if="project.language" :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.language') }}</span>
          <span :class="KV_V">{{ project.language }}</span>
        </div>
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.remote') }}</span>
          <a
            v-if="view.gh"
            class="inline-flex w-fit items-center gap-1.5 text-info hover:underline"
            :href="`https://github.com/${view.gh}`"
            target="_blank"
            rel="noopener"
          >
            <Icon name="git" class="size-3" />
            github.com/{{ view.gh }}
          </a>
          <!-- mono-ok: URL remote git -->
          <span v-else-if="project.gitRemote" :class="[KV_V, 'font-mono']">
            {{ project.gitRemote }}
          </span>
          <span v-else :class="[KV_V, 'text-dim']">
            {{ t('projects.overview.noRemote') }}
          </span>
        </div>
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.llm') }}</span>
          <span :class="KV_V">
            <Button v-if="!compact" variant="outline" size="sm" @click="emit('open-llm')">
              <Icon name="brain" />
              {{ llmLabel }}
            </Button>
            <span v-else class="inline-flex items-center gap-1.5">
              <Icon name="brain" class="size-3" />
              {{ llmLabel }}
            </span>
          </span>
        </div>
        <!-- GitHub account this project authenticates as — the single source used by
             git push/fetch/pull AND the Issues/PR tabs (inherits Settings → Git).
             Editable even in the compact quick-view: it's a safe (non-destructive)
             setting and the Git page's account shortcut lands here. -->
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.githubAccount') }}</span>
          <span :class="KV_V">
            <AppSelect
              :model-value="ghAccountValue"
              :options="ghAccountOptions"
              width="200px"
              @update:model-value="onGhAccount"
            />
          </span>
        </div>
        <!-- Hồ sơ trình duyệt nhúng của project (ADR 0101): login + bookmark riêng. Phiên
             có thể ghi đè trong menu ⋮ của trình duyệt; trống = theo mặc định của app. -->
        <div :class="KV_ROW">
          <span :class="KV_K">{{ t('projects.overview.browserProfile') }}</span>
          <span :class="KV_V">
            <AppSelect
              :model-value="browserProfileValue"
              :options="browserProfileOptions"
              width="200px"
              @update:model-value="onBrowserProfile"
            />
          </span>
        </div>
        <div :class="[KV_ROW, 'items-start']">
          <span :class="KV_K">.awog/</span>
          <span :class="[KV_V, 'flex flex-wrap gap-1.5']">
            <Badge v-for="d in TIERS" :key="d" variant="outline" class="text-muted-foreground">
              {{ d }}/
            </Badge>
          </span>
        </div>
      </div>
      <!-- Config-import assistant (ADR 0035): `.claude`/`.agents` are import sources,
           not live tiers — offer to copy them into `.awog`. Hidden in compact mode. -->
      <div
        v-if="(importable.length || justImported) && !compact"
        class="mt-2 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
      >
        <Icon name="alert" class="size-3.5 flex-none" />
        <span v-if="importable.length">
          {{ t('projects.import.banner', { n: importable.length }) }}
        </span>
        <span v-else>{{ t('projects.import.done', { n: justImported }) }}</span>
        <span class="flex-1" />
        <Button
          v-if="importable.length"
          :disabled="importing"
          variant="default"
          size="sm"
          @click="onImport"
        >
          {{
            importing
              ? t('projects.import.importing')
              : t('projects.import.action', { n: importable.length })
          }}
        </Button>
      </div>
    </Card>

    <div v-if="!compact" class="mt-1.5 flex justify-end">
      <Button variant="danger" size="sm" @click="emit('delete')">
        <Icon name="trash" />
        {{ t('projects.overview.removeProject') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Overview tab — metrics strip + Repos / Agents / Sessions / Tasks / Config cards.
// Binds the derived ProjectView (live counts) for the cards and the real Project
// entity for the config block (description / path / language / remote / LLM).
// Edit / delete / LLM defaults are emitted up to the page-controller.
import { computed, onMounted, ref } from 'vue'
import { agBadge, avatarBg, type ProjectRepo, type ProjectView } from './data'
import { modelDisplayName } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useConfigImport } from '~/composables/useConfigImport'
import { useProjectModal } from '~/composables/useProjectModal'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { useGhAccounts } from '~/composables/useGhAccounts'
import { useBrowserProfiles } from '~/composables/useBrowserProfiles'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { Project } from '~/types'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Card from '~/components/ui/card/Card.vue'

// `compact` (quick-view modal): hide destructive / management controls (remove
// project, config-import banner, LLM-defaults button → static label) so the panel
// is view-only.
const props = defineProps<{
  project: Project
  view: ProjectView
  repos?: ProjectRepo[]
  compact?: boolean
}>()
const emit = defineEmits<{
  (e: 'delete'): void
  (e: 'open-llm'): void
  (e: 'imported', n: number): void
}>()

const { t } = useI18n()
const sessions = useSessionsStore()

// Importable `.claude`/`.agents` config for this project → the import banner.
const { importable, importing, importAll } = useConfigImport(() => props.project.id)
const justImported = ref(0)
async function onImport() {
  const n = await importAll()
  if (n <= 0) return
  justImported.value = n
  emit('imported', n)
  setTimeout(() => (justImported.value = 0), 5000)
}

// Discovered child repos (multi-repo workspace) when provided, else the entity's
// single repo. Drives the repo card + the "REPO" stat count.
const effRepos = computed<ProjectRepo[]>(() =>
  props.repos && props.repos.length ? props.repos : props.view.repos,
)

// Open a recent session from the overview — select it + jump to the Sessions page.
// Also dismiss the project quick-view modal when open (this component renders both
// on the /projects page and inside that modal); a no-op when the modal is closed.
const projectModal = useProjectModal()
function openSession(id: number) {
  sessions.setActive(id)
  projectModal.close()
  navigateTo('/workbench')
}

const TIERS = ['agents', 'skills', 'rules', 'workflows', 'commands', 'hooks'] as const

// Dải số liệu đầu trang (repo / agent / phiên / task).
const stats = computed(() => [
  { label: t('projects.overview.repos'), value: effRepos.value.length },
  { label: t('projects.overview.agents'), value: props.view.agents.length },
  { label: t('projects.overview.sessions'), value: props.view.ses.length },
  { label: t('projects.overview.tasksCard'), value: props.view.tasks.length },
])

// Class dùng lặp trong template — gom một chỗ để các card/hàng giống hệt nhau.
const STAT = 'min-w-21 flex-1 rounded-xl border bg-card px-3 py-3 shadow-sm'
const CARD = 'mb-3 gap-0 rounded-xl px-4 py-3'
const CARD_H = 'mb-1.5 flex items-center gap-2 text-xs font-semibold text-dim'
const CHIP_MOD = 'border-diff-mod/35 text-diff-mod tabular-nums'
const CHIP_AHEAD = 'border-selected-border text-primary tabular-nums'
const KV_ROW = 'flex gap-3.5 py-2'
const KV_K = 'w-26 flex-none whitespace-nowrap text-muted-foreground'
const KV_V = 'min-w-0 flex-1 break-words text-foreground'

const totalDirty = computed(() => effRepos.value.reduce((a, r) => a + (r.dirty ?? 0), 0))
const totalAhead = computed(() => effRepos.value.reduce((a, r) => a + (r.ahead ?? 0), 0))

// LLM defaults summary chip: model name when set, else "App default".
const llmLabel = computed(() => {
  const ld = props.project.llmDefaults
  if (!ld) return t('projects.overview.llmAppDefault')
  return modelDisplayName(ld.modelId)
})

// ── GitHub account setting ──────────────────────────────────────────────────
// The project's gh account. Encoded on Project.githubAccount: absent = inherit
// the app default; '' = active gh account; a login pins it. The picker maps to
// two sentinels for the inherit / active rows.
const settings = useSettingsStore()
const projectsStore = useProjectsStore()
const toast = useToast()
const { accounts: ghAccounts, load: loadGhAccounts } = useGhAccounts()
onMounted(() => void loadGhAccounts())

const GH_INHERIT = '__inherit'
const GH_ACTIVE = '__active'

const ghAccountValue = computed(() => {
  const a = props.project.githubAccount
  if (a === undefined) return GH_INHERIT
  return a === '' ? GH_ACTIVE : a
})

const ghInheritLabel = computed(() =>
  t('projects.gh.accountInherit', {
    account: settings.githubAccount.trim() || t('projects.gh.accountActive'),
  }),
)

const ghAccountOptions = computed<AppSelectOption[]>(() => {
  const logins = ghAccounts.value.map((a) => a.login)
  // Surface a pinned account even if it isn't currently logged into gh, so the
  // picker doesn't render blank (and the user sees what's set).
  const cur = props.project.githubAccount
  if (cur && !logins.includes(cur)) logins.push(cur)
  return [
    { value: GH_INHERIT, label: ghInheritLabel.value },
    { value: GH_ACTIVE, label: t('projects.gh.accountActive') },
    ...logins.map((l) => ({ value: l, label: l })),
  ]
})

async function onGhAccount(v: string) {
  const next: Project = { ...props.project }
  if (v === GH_INHERIT) delete next.githubAccount
  else next.githubAccount = v === GH_ACTIVE ? '' : v
  try {
    await projectsStore.updateProject(next)
    toast.add({
      title: t('projects.toast.ghAccountSaved', { name: props.project.name }),
      color: 'success',
    })
  } catch (err) {
    console.warn('[project] save githubAccount failed', err)
    toast.add({ title: t('projects.toast.ghAccountFailed'), color: 'error' })
  }
}

// ── Browser profile setting ─────────────────────────────────────────────────
// Project.browserProfileId: absent = inherit the app default profile; an id pins it.
const browserProfiles = useBrowserProfiles()
const BP_INHERIT = '__inherit'

const browserProfileValue = computed(() => props.project.browserProfileId ?? BP_INHERIT)

const browserProfileOptions = computed<AppSelectOption[]>(() => {
  const list = browserProfiles.profiles.value
  const cur = props.project.browserProfileId
  const rows = list.map((p) => ({ value: p.id, label: p.name }))
  // Hồ sơ đã bị xoá nhưng project còn tham chiếu: vẫn hiện để picker không trống.
  if (cur && !list.some((p) => p.id === cur)) rows.push({ value: cur, label: cur })
  return [
    {
      value: BP_INHERIT,
      label: t('projects.browserProfile.inherit', {
        name: browserProfiles.defaultProfile.value?.name ?? '…',
      }),
    },
    ...rows,
  ]
})

async function onBrowserProfile(v: string) {
  const next: Project = { ...props.project }
  if (v === BP_INHERIT) delete next.browserProfileId
  else next.browserProfileId = v
  try {
    await projectsStore.updateProject(next)
    toast.add({
      title: t('projects.toast.browserProfileSaved', { name: props.project.name }),
      color: 'success',
    })
  } catch (err) {
    console.warn('[project] save browserProfileId failed', err)
    toast.add({ title: t('projects.toast.browserProfileFailed'), color: 'error' })
  }
}
</script>
