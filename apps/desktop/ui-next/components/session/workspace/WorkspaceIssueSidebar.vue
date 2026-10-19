<template>
  <!-- Sidebar thuộc tính của issue theo khuôn GitHub (Assignees · Type · Projects
       field · Milestone · Relationships · Development): mỗi field một section có
       nhãn nhỏ ở trên, giá trị hiện như chữ thường (control "ghost", viền chỉ hiện
       khi hover/focus), section ngăn bằng hairline. `layout="grid"` cho form tạo
       mới (nằm dưới ô mô tả, bề ngang rộng) — cùng field, xếp 3 cột. -->
  <div
    :class="
      layout === 'grid'
        ? 'grid grid-cols-1 gap-x-4 sm:grid-cols-3'
        : 'flex flex-col [&>section:first-child]:pt-0 [&>section:last-child]:border-b-0'
    "
  >
    <!-- Tự nhận diện: link GitHub trong các phiên đã làm issue → sprint / milestone /
         ngày của issue GitHub đó. Chỉ có ở issue ĐÃ có (form tạo mới chưa có phiên). -->
    <section v-if="canDetect" class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <Button
        variant="ghost"
        size="xs"
        class="-ml-1.5 gap-1 self-start text-muted-foreground [&_svg]:size-3"
        :disabled="detecting"
        :title="t('board.detect.hint')"
        @click="emit('detect')"
      >
        <RefreshCw v-if="detecting" class="size-3 animate-spin" />
        <Sparkles v-else class="size-3" />
        {{ detecting ? t('board.detect.running') : t('board.detect.run') }}
      </Button>
    </section>
    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('sessions.workspace.group.field.assignee') }}
      </div>
      <AppSelect
        v-model="assignee"
        variant="ghost"
        class="-ml-1.5"
        :options="assigneeOptions"
        :placeholder="t('board.field.none')"
        searchable
        :width="GHOST_WIDTH"
      />
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">{{ t('board.field.type') }}</div>
      <AppSelect
        v-model="kind"
        variant="ghost"
        class="-ml-1.5"
        :options="kindOptions"
        :width="GHOST_WIDTH"
      />
    </section>

    <section v-if="showStatus" class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('sessions.workspace.group.field.status') }}
      </div>
      <AppSelect
        v-model="status"
        variant="ghost"
        class="-ml-1.5"
        :options="statusOptions"
        :width="GHOST_WIDTH"
      />
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">{{ t('board.field.sprint') }}</div>
      <Input
        v-model="sprint"
        :class="GHOST_INPUT"
        :list="`${uid}-sprint`"
        :placeholder="t('board.field.none')"
        maxlength="80"
      />
      <datalist :id="`${uid}-sprint`">
        <option v-for="s in sprintSuggestions" :key="s" :value="s" />
      </datalist>
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('board.field.startDate') }}
      </div>
      <Input v-model="startDate" :class="GHOST_INPUT" type="date" :max="dueDate || undefined" />
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">{{ t('board.field.dueDate') }}</div>
      <Input
        v-model="dueDate"
        :class="[GHOST_INPUT, { 'text-destructive': overdueDays > 0 }]"
        type="date"
        :min="startDate || undefined"
      />
      <p v-if="overdueDays > 0" class="m-0 text-xs text-destructive">
        {{ t('board.field.overdue', { n: overdueDays }) }}
      </p>
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">
        {{ t('board.field.milestone') }}
      </div>
      <Input
        v-model="milestone"
        :class="GHOST_INPUT"
        :list="`${uid}-milestone`"
        :placeholder="t('board.field.none')"
        maxlength="80"
      />
      <datalist :id="`${uid}-milestone`">
        <option v-for="m in milestoneSuggestions" :key="m" :value="m" />
      </datalist>
    </section>

    <section class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2">
      <div class="text-xs font-semibold text-muted-foreground">{{ t('board.field.parent') }}</div>
      <AppSelect
        v-model="parentId"
        variant="ghost"
        class="-ml-1.5"
        :options="parentOptions"
        searchable
        :empty-label="t('board.parent.none')"
        :width="GHOST_WIDTH"
      />
    </section>

    <section
      v-for="kindKey in LINK_KINDS"
      :key="kindKey"
      class="flex min-w-0 flex-col gap-0.5 border-b border-border py-2"
    >
      <div class="text-xs font-semibold text-muted-foreground">
        {{ kindKey === 'issue' ? t('board.field.issueLinks') : t('board.field.prLinks') }}
      </div>
      <div
        v-for="url in linksOf(kindKey)"
        :key="url"
        class="group -ml-1.5 flex min-h-ctrl-xs cursor-pointer items-center gap-1.5 rounded-sm pl-1.5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        role="link"
        tabindex="0"
        :title="url"
        @click="openLink(url)"
        @keydown.enter.prevent="openLink(url)"
      >
        <GitPullRequest v-if="kindKey === 'pr'" class="size-3.5 flex-none text-success" />
        <CircleDot v-else class="size-3.5 flex-none text-success" />
        <span class="min-w-0 flex-1 truncate">{{ linkLabel(url) }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          class="opacity-0 group-hover:opacity-100 [&_svg]:size-3"
          :title="t('board.link.remove')"
          :aria-label="t('board.link.remove')"
          @click.stop="removeLink(kindKey, url)"
        >
          <X class="size-3" />
        </Button>
      </div>
      <Input
        v-model="linkDraft[kindKey]"
        :class="[GHOST_INPUT, { 'border-destructive': linkError[kindKey] }]"
        :placeholder="kindKey === 'issue' ? t('board.link.addIssuePh') : t('board.link.addPrPh')"
        @keydown.enter.prevent="addLink(kindKey)"
        @blur="addLink(kindKey)"
      />
      <p v-if="linkError[kindKey]" class="m-0 text-xs text-destructive">
        {{ t('board.link.invalid') }}
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { CircleDot, GitPullRequest, RefreshCw, Sparkles, X } from 'lucide-vue-next'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { BoardItemStatus, BoardItemType } from '~/stores/board'

withDefaults(
  defineProps<{
    statusOptions: readonly AppSelectOption[]
    assigneeOptions: readonly AppSelectOption[]
    parentOptions: readonly AppSelectOption[]
    // Giá trị đã dùng trên board của project — gợi ý cho ô sprint / milestone.
    sprintSuggestions?: readonly string[]
    milestoneSuggestions?: readonly string[]
    // Agent mode của form tạo giấu status (item đi backlog/todo theo nút bấm).
    showStatus?: boolean
    layout?: 'stack' | 'grid'
    // Nút "Tự nhận diện từ phiên chat" (chỉ issue đã có) + trạng thái đang chạy.
    canDetect?: boolean
    detecting?: boolean
  }>(),
  {
    canDetect: false,
    detecting: false,
    sprintSuggestions: () => [],
    milestoneSuggestions: () => [],
    showStatus: true,
    layout: 'stack',
  },
)

const emit = defineEmits<{ detect: [] }>()

// Control "ghost" kiểu sidebar GitHub: giá trị đọc như chữ thường, viền/nền chỉ hiện
// khi hover/focus. Lùi trái 6px (`-ml-1.5`) + nới bề ngang đúng 6px để chữ của giá
// trị thẳng hàng với nhãn section phía trên.
const GHOST_WIDTH = 'calc(100% + 0.375rem)'
const GHOST_INPUT =
  '-ml-1.5 w-[calc(100%+0.375rem)] border-transparent bg-transparent pl-1.5 shadow-none hover:bg-accent focus-visible:border-input focus-visible:bg-transparent'

const status = defineModel<BoardItemStatus>('status', { required: true })
const assignee = defineModel<string>('assignee', { required: true })
const kind = defineModel<BoardItemType>('kind', { required: true })
const sprint = defineModel<string>('sprint', { required: true })
const milestone = defineModel<string>('milestone', { required: true })
const startDate = defineModel<string>('startDate', { required: true })
const dueDate = defineModel<string>('dueDate', { required: true })
const parentId = defineModel<string>('parentId', { required: true })
const issueLinks = defineModel<string[]>('issueLinks', { required: true })
const prLinks = defineModel<string[]>('prLinks', { required: true })

const { t } = useI18n()
const { openLink } = useLinkOpen()
const uid = useId()

// Loại việc theo khuôn GitHub/Jira người dùng chọn: Epic · US · Task · Bug. `subtask`
// chỉ còn là dữ liệu cũ — hiện thêm khi item đang mang nó để không mất giá trị.
const kindOptions = computed<AppSelectOption[]>(() => {
  const kinds: BoardItemType[] = ['epic', 'story', 'task', 'bug']
  if (kind.value === 'subtask') kinds.push('subtask')
  return kinds.map((v) => ({ value: v, label: t(`board.type.${v}`) }))
})

// Hạn chót đã qua mà việc chưa đóng ⇒ số ngày trễ (0 = không trễ / chưa đặt).
const overdueDays = computed(() => {
  if (!dueDate.value || status.value === 'done' || status.value === 'cancelled') return 0
  const due = Date.parse(`${dueDate.value}T23:59:59`)
  const diff = Date.now() - due
  return diff > 0 ? Math.ceil(diff / (24 * 3600 * 1000)) : 0
})

// ── Link issue / PR ──
const LINK_KINDS = ['issue', 'pr'] as const
type LinkKind = (typeof LINK_KINDS)[number]
const LINK_RE = /^https?:\/\/\S+$/
const linkDraft = reactive<Record<LinkKind, string>>({ issue: '', pr: '' })
const linkError = reactive<Record<LinkKind, boolean>>({ issue: false, pr: false })
const linksOf = (k: LinkKind): string[] => (k === 'issue' ? issueLinks.value : prLinks.value)

function addLink(k: LinkKind): void {
  const url = linkDraft[k].trim()
  linkError[k] = false
  if (!url) return
  if (!LINK_RE.test(url)) {
    linkError[k] = true
    return
  }
  const cur = linksOf(k)
  if (!cur.includes(url)) {
    if (k === 'issue') issueLinks.value = [...cur, url]
    else prLinks.value = [...cur, url]
  }
  linkDraft[k] = ''
}
function removeLink(k: LinkKind, url: string): void {
  if (k === 'issue') issueLinks.value = issueLinks.value.filter((u) => u !== url)
  else prLinks.value = prLinks.value.filter((u) => u !== url)
}

// github.com/<owner>/<repo>/(issues|pull)/<n> ⇒ "repo#n" như GitHub hiện; URL khác
// ⇒ host + đường dẫn.
const GH_RE = /^https?:\/\/github\.com\/[^/]+\/([^/]+)\/(?:issues|pull)\/(\d+)/
function linkLabel(url: string): string {
  const m = GH_RE.exec(url)
  if (m) return `${m[1]}#${m[2]}`
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}
</script>
