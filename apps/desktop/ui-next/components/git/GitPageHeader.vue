<template>
  <!-- Toolbar co theo PANE (container `gitmain` ở GitManager), không theo cửa sổ:
       bề rộng phụ thuộc sidebar git đang kéo tới đâu. Dưới 860px: thu nhãn picker +
       khoảng cách; dưới 720px: wrap xuống dòng hai thay vì cuộn ngang (cuộn ngang
       từng đẩy Push và nút identity ra khỏi màn hình). Ngưỡng là số ĐO, không đoán.
       Cùng 46px + hairline inset với header sidebar để hai vạch nằm trên một dòng. -->
  <div
    class="flex h-11.5 flex-none items-center gap-2 overflow-x-auto px-3.5 shadow-[inset_0_-1px_0_var(--color-border)] @max-[860px]/gitmain:gap-1.5 @max-[860px]/gitmain:px-3 @max-[720px]/gitmain:h-auto @max-[720px]/gitmain:min-h-11.5 @max-[720px]/gitmain:flex-wrap @max-[720px]/gitmain:overflow-x-visible @max-[720px]/gitmain:py-2"
  >
    <!-- Project picker -->
    <Popover :open="open === 'project'" @update:open="(v) => setOpen('project', v)">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" :class="PICK" :title="t('git.header.selectProject')">
          <!-- Màu project là dữ liệu người dùng chọn, không phải token theme. -->
          <Icon
            name="projects"
            class="size-3.5"
            :style="currentProject?.color ? { color: currentProject.color } : undefined"
          />
          <span :class="[LABEL, 'max-w-37.5']">
            {{ currentProject?.name ?? t('git.header.noProject') }}
          </span>
          <span
            v-if="(currentProject?.dirty ?? 0) > 0"
            class="rounded-sm bg-warning/15 px-1 text-xs text-warning tabular-nums"
          >
            {{ currentProject?.dirty }}
          </span>
          <Icon name="chev" class="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" :class="[MENU, 'w-85 p-0']">
        <div :class="FILTER">
          <Icon name="search" class="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref="projectSearch"
            v-model="projectQuery"
            unstyled
            class="min-w-0 flex-1 text-sm"
            :placeholder="t('git.header.filterProjects')"
            @keydown.enter.prevent="pickFirstProject"
            @keydown.esc.prevent="open = null"
          />
        </div>
        <div class="max-h-75 overflow-y-auto p-1">
          <div
            v-for="p in filteredProjects"
            :key="p.id"
            :class="[ITEM, 'items-start']"
            @click="pickProject(p.id)"
          >
            <Icon
              name="projects"
              class="mt-0.5 size-3.5 shrink-0"
              :style="p.color ? { color: p.color } : undefined"
            />
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5">
                <span class="flex-1 truncate">{{ p.name }}</span>
                <span
                  v-if="(p.dirty ?? 0) > 0"
                  class="rounded-sm bg-warning/15 px-1 text-xs text-warning tabular-nums"
                >
                  {{ p.dirty }}
                </span>
              </span>
              <!-- mono-ok: đường dẫn project -->
              <span class="block truncate font-mono text-xs text-muted-foreground">
                {{ p.path }}
              </span>
            </span>
            <Icon
              v-if="p.id === currentProjectId"
              name="check"
              class="size-3.5 shrink-0 self-center text-primary"
            />
          </div>
          <div
            v-if="!filteredProjects.length"
            class="px-2 py-6 text-center text-sm text-muted-foreground"
          >
            {{ projectQuery ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <Separator v-if="!notARepo" orientation="vertical" class="h-4" />

    <!-- Repo picker — only when project holds more than one repo -->
    <template v-if="repos.length > 1 && !notARepo">
      <Popover :open="open === 'repo'" @update:open="(v) => setOpen('repo', v)">
        <PopoverTrigger as-child>
          <Button variant="outline" size="sm" :class="PICK" :title="t('git.header.selectRepo')">
            <Icon name="fork" class="size-3.5 text-muted-foreground" />
            <!-- mono-ok: đường dẫn repo -->
            <span class="max-w-40 truncate font-mono">{{ repo }}</span>
            <Icon name="chev" class="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" :class="[MENU, 'w-auto min-w-42 p-1']">
          <div v-for="r in repos" :key="r" :class="ITEM" @click="pickRepo(r)">
            <Icon name="fork" class="size-3.5 shrink-0 text-muted-foreground" />
            <!-- mono-ok: đường dẫn repo -->
            <span class="flex-1 truncate font-mono">{{ r }}</span>
            <Icon v-if="r === repo" name="check" class="size-3.5 shrink-0 text-primary" />
          </div>
        </PopoverContent>
      </Popover>
      <Separator orientation="vertical" class="h-4" />
    </template>

    <!-- Branch picker -->
    <Popover v-if="!notARepo" :open="open === 'branch'" @update:open="(v) => setOpen('branch', v)">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" :class="PICK" :title="t('git.header.switchBranch')">
          <Icon name="branch" class="size-3.5" />
          <!-- mono-ok: tên nhánh -->
          <span :class="[LABEL, 'max-w-45 font-mono']">{{ branch }}</span>
          <Icon name="chev" class="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" :class="[MENU, 'w-65 p-0']">
        <div :class="FILTER">
          <Icon name="search" class="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            v-model="branchQuery"
            unstyled
            class="min-w-0 flex-1 text-sm"
            :placeholder="t('git.header.filterBranches')"
          />
        </div>
        <div class="max-h-75 overflow-y-auto p-1">
          <div
            v-for="b in filteredBranches"
            :key="b.name"
            :class="ITEM"
            @click="onSwitchBranch(b.name)"
          >
            <Icon name="branch" class="size-3.5 shrink-0" :class="{ 'text-primary': b.current }" />
            <!-- mono-ok: tên nhánh -->
            <span class="flex-1 truncate font-mono" :class="{ 'text-primary': b.current }">
              {{ b.name }}
            </span>
            <Icon v-if="b.current" name="check" class="size-3.5 shrink-0 text-primary" />
          </div>
          <div
            v-if="!filteredBranches.length"
            class="px-2 py-6 text-center text-sm text-muted-foreground"
          >
            {{ branchQuery ? t('git.sidebar.noMatch') : t('git.sidebar.empty') }}
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <!-- Spacer đẩy cụm thao tác sang phải; khi wrap thì co về 0. -->
    <span class="min-w-0 flex-1 @max-[720px]/gitmain:basis-0" />

    <!-- Repo ops — hidden when the workspace isn't a git repo (init empty state) -->
    <template v-if="!notARepo">
      <!-- Ops. While an op is in flight all three disable; the active one shows a
           spinner + progress and gains an attached cancel (✕) — op + cancel ghép
           cạnh nhau thành một control ("Push ✕"), không phải hộp rời. -->
      <span class="inline-flex items-stretch">
        <Button
          variant="outline"
          size="sm"
          :class="[{ 'rounded-r-none': syncOp?.op === 'fetch' }]"
          :disabled="busy"
          @click="emit('fetch')"
        >
          <span v-if="syncOp?.op === 'fetch'" :class="RING" />
          <Icon v-else name="refresh" class="size-3.5" />
          {{ syncOp?.op === 'fetch' ? syncLabel : t('git.ops.fetch') }}
        </Button>
        <Button
          v-if="syncOp?.op === 'fetch'"
          variant="outline"
          size="sm"
          :class="CANCEL"
          :title="t('git.ops.cancel')"
          :aria-label="t('git.ops.cancel')"
          @click="emit('cancel', 'fetch')"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </span>
      <span class="inline-flex items-stretch">
        <Button
          variant="outline"
          size="sm"
          :class="[{ 'rounded-r-none': syncOp?.op === 'pull' }]"
          :disabled="busy"
          @click="emit('pull')"
        >
          <span v-if="syncOp?.op === 'pull'" :class="RING" />
          {{ syncOp?.op === 'pull' ? syncLabel : t('git.ops.pullWord') }}
          <span v-if="!syncOp && behind" class="font-mono text-xs tabular-nums">↓{{ behind }}</span>
        </Button>
        <Button
          v-if="syncOp?.op === 'pull'"
          variant="outline"
          size="sm"
          :class="CANCEL"
          :title="t('git.ops.cancel')"
          :aria-label="t('git.ops.cancel')"
          @click="emit('cancel', 'pull')"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </span>
      <span class="inline-flex items-stretch">
        <Button
          variant="outline"
          size="sm"
          :class="[PUSH, { 'rounded-r-none': syncOp?.op === 'push' }]"
          :disabled="busy"
          @click="emit('push')"
        >
          <span v-if="syncOp?.op === 'push'" :class="RING" />
          {{ syncOp?.op === 'push' ? syncLabel : t('git.ops.pushWord') }}
          <span v-if="!syncOp && ahead" class="font-mono text-xs tabular-nums">↑{{ ahead }}</span>
        </Button>
        <Button
          v-if="syncOp?.op === 'push'"
          variant="outline"
          size="sm"
          :class="CANCEL"
          :title="t('git.ops.cancel')"
          :aria-label="t('git.ops.cancel')"
          @click="emit('cancel', 'push')"
        >
          <Icon name="x" class="size-3.5" />
        </Button>
      </span>

      <Separator orientation="vertical" class="h-4" />

      <!-- gh account used for fetch/pull/push (set in Project → Overview). Click
           opens the project so the account can be changed. -->
      <Button
        variant="outline"
        size="sm"
        :class="PICK"
        :title="t('git.header.ghAccountTitle')"
        @click.stop="emit('open-account')"
      >
        <Icon name="git" class="size-3.5 text-muted-foreground" />
        <span :class="[LABEL, 'max-w-30']">
          {{ ghAccount || t('git.header.ghAccountDefault') }}
        </span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        class="w-8 flex-none px-0"
        :title="t('git.header.identity')"
        :aria-label="t('git.header.identity')"
        @click="emit('open-identity')"
      >
        <Icon name="settings" class="size-3.5" />
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
// Git page header — project / repo / branch pickers + merge-rebase state + ops
// (fetch / pull / push). Mirrors production GitPageHeader.vue (ops live in the
// header at the top of the main pane, not a full-width bar). Dropdowns are
// Popover shadcn (portal ra body) nên overflow-x:auto của header không cắt chúng.
import Button from '~/components/ui/button/Button.vue'
import type { BranchInfo, ProjectInfo } from './git-types'
import Input from '~/components/ui/input/Input.vue'
import Popover from '~/components/ui/popover/Popover.vue'
import PopoverContent from '~/components/ui/popover/PopoverContent.vue'
import PopoverTrigger from '~/components/ui/popover/PopoverTrigger.vue'
import Separator from '~/components/ui/separator/Separator.vue'

// Nút picker (project/repo/branch/account): nhãn có thể cắt `…`.
const PICK = 'flex-none gap-1.5'
// Nhãn picker co trước tiên khi pane hẹp (< 860px) — tên nhánh dài là thứ chiếm chỗ nhất.
const LABEL = 'truncate @max-[860px]/gitmain:max-w-26'
// Popover chọn có ô lọc: hình popover shadcn, cao tối đa gần bằng viewport.
const MENU = 'max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg'
const FILTER = 'flex items-center gap-1.5 border-b px-2 py-1.5'
const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent'
// Push = nút chính của toolbar: viền accent, không fill (toolbar macOS không có nút mặc định).
const PUSH =
  'border-ring font-semibold text-primary hover:border-primary hover:bg-primary/15 hover:text-primary'
// Nút ✕ huỷ ghép sát cạnh phải nút thao tác đang chạy.
const CANCEL =
  '-ml-px w-6.5 rounded-l-none px-0 text-destructive hover:bg-destructive/10 hover:text-destructive'
// Vòng cung xoay quanh (không xoay glyph); reduced-motion vẫn giữ cung tĩnh.
// px-ok: nét vòng 1.5px là hình dạng spinner.
const RING =
  'size-3.5 flex-none animate-spin rounded-full border-[1.5px] border-current border-r-transparent opacity-90 motion-reduce:animate-none'

// In-flight remote-sync op (mirrors the git store's `syncOp`). Drives the busy
// state + live progress on the fetch/pull/push buttons.
type SyncOp = { op: 'fetch' | 'pull' | 'push'; phase: string; pct: number | null }

const props = defineProps<{
  projects: ProjectInfo[]
  currentProjectId: string
  repos: string[]
  repo: string
  branch: string
  branches: BranchInfo[]
  ahead: number
  behind: number
  notARepo: boolean
  syncOp: SyncOp | null
  // The gh account fetch/pull/push authenticate as ('' = the default identity).
  ghAccount: string
}>()

const emit = defineEmits<{
  (e: 'select-project', id: string): void
  (e: 'select-repo', repo: string): void
  (e: 'switch-branch', name: string): void
  (e: 'fetch'): void
  (e: 'pull'): void
  (e: 'push'): void
  (e: 'cancel', op: 'fetch' | 'pull' | 'push'): void
  (e: 'open-identity'): void
  (e: 'open-account'): void
}>()

const { t } = useI18n()

type Picker = 'project' | 'repo' | 'branch' | null
const open = ref<Picker>(null)
const branchQuery = ref('')
const projectQuery = ref('')
const projectSearch = useTemplateRef<HTMLInputElement>('projectSearch')

// Any remote-sync op in flight → disable all three buttons; the active one shows
// a spinner + localized progress label.
const busy = computed(() => props.syncOp !== null)
const syncLabel = computed(() => {
  const s = props.syncOp
  if (!s) return ''
  const base = t(`git.ops.${s.op}ing`)
  return s.pct != null ? `${base} ${s.pct}%` : base
})

const currentProject = computed(() => props.projects.find((p) => p.id === props.currentProjectId))

// Project picker filter — matches name or path (case-insensitive).
const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase()
  if (!q) return props.projects
  return props.projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q),
  )
})

const localBranches = computed(() => props.branches.filter((b) => !b.remote))
const filteredBranches = computed(() => {
  const q = branchQuery.value.trim().toLowerCase()
  if (!q) return localBranches.value
  return localBranches.value.filter((b) => b.name.toLowerCase().includes(q))
})

// Popover báo mở/đóng; mở một picker thì reset ô lọc của nó (đóng picker khác).
function setOpen(p: Exclude<Picker, null>, isOpen: boolean) {
  if (!isOpen) {
    if (open.value === p) open.value = null
    return
  }
  open.value = p
  if (p === 'branch') branchQuery.value = ''
  if (p === 'project') {
    projectQuery.value = ''
    void nextTick(() => projectSearch.value?.focus())
  }
}

function pickProject(id: string) {
  open.value = null
  emit('select-project', id)
}

// Enter in the search field selects the first match — quick keyboard jump.
function pickFirstProject() {
  const first = filteredProjects.value[0]
  if (first) pickProject(first.id)
}

function pickRepo(r: string) {
  open.value = null
  emit('select-repo', r)
}

function onSwitchBranch(name: string) {
  open.value = null
  emit('switch-branch', name)
}
</script>
