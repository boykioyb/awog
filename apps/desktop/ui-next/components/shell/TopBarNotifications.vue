<template>
  <!-- Popover portal ra <body>, neo mép phải của chuông (header của SidebarInset).
       PopoverContent mang role="dialog" + data-state="open" nên đã nằm trong
       OVERLAYS của useEmbeddedBrowser.ts — trình duyệt nhúng nhường chỗ khi panel mở. -->
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="iconSm"
        class="relative shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        :title="t('github.inbox.title')"
      >
        <Icon name="bell" class="size-4!" />
        <CountBadge v-if="unreadCount > 0">{{ badge }}</CountBadge>
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      class="flex w-105 flex-col overflow-hidden p-0"
      :aria-label="t('github.inbox.title')"
    >
      <div class="flex items-center gap-1 py-2 pr-2 pl-3">
        <span class="min-w-0 flex-1 truncate text-foreground">{{ t('github.inbox.title') }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :disabled="loading"
          :title="t('github.inbox.refresh')"
          @click="refresh"
        >
          <!-- Reload feedback. `[data-reduced-motion='1'] *` toàn cục đã tắt animation
               cho người dùng chọn giảm chuyển động. -->
          <Icon name="refresh" :class="loading && 'animate-spin'" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :disabled="!unreadCount"
          :title="t('github.inbox.markAllRead')"
          @click="markAll"
        >
          <Icon name="check" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-dim"
          :title="t('github.inbox.settings')"
          @click="goSettings"
        >
          <Icon name="settings" />
        </Button>
      </div>
      <Separator />

      <!-- Watched = repos of the projects opted in at Settings → Git (the only ones
           allowed to toast). The filter is only OFFERED when it would change the
           list: two tabs showing the same count taught the user nothing except that
           one of them was pointless. -->
      <template v-if="visibleTabs.length > 1">
        <Tabs
          :model-value="filter"
          class="px-2 py-1.5"
          @update:model-value="(v: string | number) => (filter = v as InboxTab)"
        >
          <TabsList class="h-auto">
            <TabsTrigger
              v-for="tab in visibleTabs"
              :key="tab"
              :value="tab"
              class="px-2 py-0.5"
              :title="tabHint(tab)"
            >
              {{ tabLabel(tab) }}
              <span class="text-sm text-dim tabular-nums">{{ tabCount(tab) }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Separator />
      </template>

      <!-- Không cuộn ngang: hàng tự cắt `…` (TopBarNotifyRow), nên thứ rộng hơn panel
           là lỗi layout chứ không phải nội dung để kéo xem. -->
      <div class="max-h-[min(520px,68vh)] overflow-x-hidden overflow-y-auto px-1 pb-1">
        <!-- Tab "PR" là một danh sách KHÁC (theo dõi CI + review của từng PR), nên
             nó thay cả thân panel chứ không lọc danh sách thông báo. -->
        <template v-if="filter === 'prs'">
          <p v-if="prError" class="px-2 py-2 text-destructive">{{ prError }}</p>
          <!-- Rỗng là một KHẲNG ĐỊNH ("không có PR nào để theo dõi") — đừng nói nó
               cạnh một lỗi, chỗ mà sự thật là "không biết". -->
          <p v-else-if="!prRows.length" class="px-2 py-2 text-dim">{{ t('ghWatch.empty') }}</p>
          <GitPrWatchRow
            v-for="row in prRows"
            :key="row.key"
            :repo="row.repo"
            :number="row.number"
            :title="row.title"
            :watched="row.watched"
            :item="row.item"
            :session-label="row.sessionLabel"
            :busy="prBusy"
            @open="openPrExternal(row.url)"
            @toggle="(watch) => onTogglePrWatch(row, watch)"
          />
        </template>
        <!-- Tab "Triển khai": pipeline hỏng / đang chờ duyệt (useCicdNotify). Như
             tab PR, đây là một danh sách KHÁC nên nó thay cả thân panel. Chỉ ĐỌC +
             một cú bấm mở lần chạy ở chính nguồn của nó: một lần chạy hỏng tự rời
             danh sách khi chạy lại thành công, không có nút "đã đọc". -->
        <template v-else-if="filter === 'cicd'">
          <p v-if="cicdError" class="px-2 py-2 text-destructive">{{ cicdError }}</p>
          <p v-else-if="!cicdEnabled" class="px-2 py-2 text-dim">
            {{ t('infra.cicd.notify.off') }}
          </p>
          <p v-else-if="!cicdRuns.length" class="px-2 py-2 text-dim">
            {{ t('infra.cicd.notify.empty') }}
          </p>
          <!-- raw-ok: cả hàng nhiều dòng là một vùng bấm (mở lần chạy ở nguồn) -->
          <button
            v-for="run in cicdRuns"
            :key="`${run.source}|${run.id}`"
            class="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-left text-foreground hover:bg-accent"
            type="button"
            :title="t('infra.cicd.openOnHost')"
            @click="openCicdRun(run)"
          >
            <span
              class="mt-1.5 size-1.5 shrink-0 rounded-full"
              :class="CICD_DOT[run.status] ?? 'bg-dim'"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate" :class="run.status === 'waiting' && 'text-warning'">
                {{ run.project }} · {{ run.title }}
              </span>
              <span class="flex min-w-0 gap-1 text-sm text-dim">
                <span>{{ t(`infra.cicd.status.${run.status}`) }}</span>
                <span v-if="run.stepName">
                  · {{ t('infra.cicd.failedAtStep', { step: run.stepName }) }}
                </span>
                <span v-if="run.startedAt" class="ml-auto">
                  · {{ formatRelativeAgo(run.startedAt, t, now) }}
                </span>
              </span>
            </span>
            <Icon name="external" class="size-3 shrink-0" />
          </button>
        </template>
        <template v-else>
          <p v-if="error" class="px-2 py-2 text-destructive">{{ error }}</p>
          <p v-else-if="!enabled" class="px-2 py-2 text-dim">{{ t('github.inbox.off') }}</p>
          <p v-else-if="!watchedProjectCount" class="px-2 py-2 text-dim">
            {{ t('github.inbox.noWatched') }}
          </p>

          <!-- The empty state is a CLAIM ("your inbox is clear") — never make it next
               to an error, where the truth is "we don't know". -->
          <p v-if="loading && !visible.length" class="px-2 py-2 text-dim">
            {{ t('github.inbox.loading') }}
          </p>
          <p v-else-if="!visible.length && !error" class="px-2 py-2 text-dim">
            {{ filter === 'watched' ? t('github.inbox.emptyWatched') : t('github.inbox.empty') }}
          </p>
          <!-- Grouped by repo: one inbox is usually 3 repos deep, so printing the
               owner/repo on every row spent the widest column on the least
               informative text. The header carries it once and sticks while its rows
               scroll. Không làm mờ nhóm không theo dõi: khi chưa chọn project nào thì
               MỌI nhóm đều "không theo dõi" — chip chữ nói ra điều đó thay vì opacity. -->
          <div v-for="g in groups" :key="g.repo" class="[&+&]:mt-0.5">
            <!-- The whole header is the collapse toggle (bigger target than a lone
                 chevron). A collapsed group keeps its unread dot + count visible, so
                 folding a noisy repo away never hides that it has something new.
                 Nền đặc (bg-popover): các hàng cuộn bên DƯỚI header dính. -->
            <Button
              variant="ghost"
              size="xs"
              class="group/grp sticky top-0 z-1 h-auto w-full justify-start gap-1.5 bg-popover pt-2 pr-2 pb-1 pl-1 text-sm font-normal hover:bg-popover"
              :aria-expanded="!isCollapsed(g.repo)"
              :title="isCollapsed(g.repo) ? t('github.inbox.expand') : t('github.inbox.collapse')"
              @click="toggleGroup(g.repo)"
            >
              <Icon
                name="chev-right"
                class="size-3! text-dim transition-transform group-hover/grp:text-foreground motion-reduce:transition-none"
                :class="!isCollapsed(g.repo) && 'rotate-90'"
              />
              <span
                class="min-w-0 shrink truncate text-muted-foreground group-hover/grp:text-foreground"
                :title="g.repo"
              >
                {{ g.name }}
              </span>
              <span v-if="g.owner" class="min-w-0 shrink truncate text-dim">{{ g.owner }}</span>
              <!-- Names the reason this group is dimmed, instead of leaving the user to
                   infer it from an opacity value. -->
              <Badge v-if="!g.watched" variant="outline" class="shrink-0 font-normal text-dim">
                {{ t('github.inbox.notWatched') }}
              </Badge>
              <!-- Cùng chấm accent của hàng: nhóm đã gập vẫn báo "có cái chưa đọc". -->
              <span class="ml-auto flex shrink-0 items-center gap-1.5">
                <span v-if="g.unread" class="size-1.5 rounded-full bg-primary" />
                <span class="text-dim tabular-nums">{{ g.items.length }}</span>
              </span>
            </Button>
            <template v-if="!isCollapsed(g.repo)">
              <TopBarNotifyRow
                v-for="n in g.items"
                :key="n.id"
                :item="n"
                :author="authorOf(n)"
                @open="onOpen"
                @external="onExternal"
                @read="onRead"
              />
            </template>
          </div>
        </template>
      </div>

      <Separator />
      <div class="flex items-center gap-2 px-3 py-2 text-sm text-dim">
        <span class="min-w-0 flex-1 truncate">{{ checkedLabel }}</span>
        <Button
          variant="link"
          size="xs"
          class="h-auto shrink-0 px-0 font-normal"
          @click="openOnGithub"
        >
          {{ t('github.inbox.openOnGithub') }}
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useCicdNotifyStatus } from '~/composables/useCicdNotify'
import { useConfirm } from '~/composables/useConfirm'
import {
  markAllGhNotificationsRead,
  markGhNotificationRead,
  refreshGhInbox,
  useGhInbox,
  type GhNotification,
} from '~/composables/useGhInbox'
import {
  isAlerting,
  openNotification,
  useGhNotificationsStatus,
} from '~/composables/useGhNotifications'
import {
  refreshPrWatch,
  togglePrWatch,
  useWatchedPrs,
  type PrWatchItem,
} from '~/composables/usePrWatch'
import type { CicdRun } from '~/composables/useInfraCicdApi'
import { useSettingsModal } from '~/composables/useSettingsModal'
import { useSessionsStore } from '~/stores/sessions'
import { useSettingsStore } from '~/stores/settings'
import { formatRelativeAgo } from '~/utils/relative-time'

// Header bell: the GitHub notification inbox (docs/features/github-notifications.md).
// The list itself is the app-lifetime singleton in useGhInbox — the poller keeps it
// current, so opening the panel costs nothing. This component owns only the popover
// and routes each row through the poller's own open path.

// 'prs' = danh sách PR đang theo dõi CI/review (usePrWatch), 'cicd' = pipeline hỏng
// / chờ duyệt (useCicdNotify). Cả hai là danh sách KHÁC, không phải một bộ lọc của
// hộp thư — chúng thay cả thân panel.
type InboxTab = 'all' | 'watched' | 'prs' | 'cicd'

// Chấm trạng thái của hàng "Triển khai": đỏ = hỏng, vàng = chờ duyệt, còn lại mờ.
const CICD_DOT: Partial<Record<CicdRun['status'], string>> = {
  failed: 'bg-destructive',
  waiting: 'bg-warning',
}

const { t } = useI18n()
const now = useNow()
const settings = useSettingsStore()
const { openSettings } = useSettingsModal()
const { confirm } = useConfirm()
const { items, loading, error, lastFetchedAt, unreadCount, authorOf } = useGhInbox()
const { watchedProjectCount } = useGhNotificationsStatus()
const { items: watchedPrs, lastError: prError } = useWatchedPrs()
const { runs: cicdRuns, lastError: cicdError } = useCicdNotifyStatus()
const sessions = useSessionsStore()

// Nguồn này MẶC ĐỊNH TẮT (mỗi lượt kiểm tra tốn vài lời gọi `aws`/`gh`), nên tab
// chỉ được mời khi nó đang bật — hoặc khi còn hàng của lượt poll trước.
const cicdEnabled = computed(() => settings.notifications.cicdEvents)

const open = ref(false)
const filter = ref<InboxTab>('all')

const enabled = computed(() => settings.githubNotify.enabled)
const watchedItems = computed(() => items.value.filter(isAlerting))
const visible = computed(() => (filter.value === 'watched' ? watchedItems.value : items.value))
const badge = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))
// Is there anything the "watched" filter would actually hide?
const hasUnwatched = computed(() => watchedItems.value.length < items.value.length)
// KHAI TRƯỚC `visibleTabs` một cách CÓ CHỦ Ý: `watch(visibleTabs, …)` bên dưới đọc
// source ngay lúc setup để lấy giá trị đầu, nên nó chạm `prRows` trong cùng lượt
// chạy `<script setup>`. Khai sau sẽ ném TDZ ("Cannot access before initialization")
// — lỗi runtime mà typecheck không thấy vì thứ tự khai báo `const` là chuyện lúc chạy.
// ─── Tab PR: theo dõi CI + review của từng PR (usePrWatch) ─────────────────
// Hàng của tab này là hợp của hai nguồn: PR ĐANG theo dõi (có trạng thái CI), và
// PR xuất hiện trong hộp thư nhưng chưa theo dõi (ứng viên để bấm bật). Nguồn thứ
// hai chính là lối vào của tính năng — không có nó thì không có chỗ nào để bắt đầu
// theo dõi một PR từ đây.
type PrRow = {
  key: string
  repo: string
  number: number
  title: string
  url: string
  watched: boolean
  item: PrWatchItem | null
  sessionLabel: string
}

// Tiêu đề phiên đang gắn với một PR. Phiên bị xoá thì sidecar đã gỡ liên kết ở
// vòng poll kế tiếp, nên chỗ này chỉ cần lo trường hợp chưa kịp gỡ.
function sessionLabelFor(engineId: string | null): string {
  if (!engineId) return ''
  return sessions.sessions.find((sn) => sn.engineId === engineId)?.title ?? ''
}

const prRows = computed<PrRow[]>(() => {
  const rows: PrRow[] = watchedPrs.value.map((item) => ({
    key: item.id,
    repo: item.repo,
    number: item.number,
    title: item.title || `#${item.number}`,
    url: item.url,
    watched: true,
    item,
    sessionLabel: sessionLabelFor(item.sessionId),
  }))
  const seen = new Set(rows.map((r) => r.key))
  for (const n of items.value) {
    if (n.type !== 'PullRequest' || n.number == null) continue
    const key = `${n.repo.toLowerCase()}#${n.number}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      key,
      repo: n.repo,
      number: n.number,
      title: n.title,
      url: n.url,
      watched: false,
      item: null,
      sessionLabel: '',
    })
  }
  return rows
})

// Tab nào đáng hiện. 'watched' chỉ khi nó thực sự giấu bớt được cái gì; 'prs' chỉ
// khi có PR để nói tới (đang theo dõi, hoặc có PR trong hộp thư để bắt đầu theo dõi).
const visibleTabs = computed<InboxTab[]>(() => {
  const tabs: InboxTab[] = ['all']
  if (hasUnwatched.value) tabs.push('watched')
  if (prRows.value.length) tabs.push('prs')
  if (cicdEnabled.value || cicdRuns.value.length) tabs.push('cicd')
  return tabs
})
// If the filter stops being offered while it is active, fall back to Everything —
// otherwise the list silently keeps filtering with no control on screen.
watch(visibleTabs, (tabs) => {
  if (!tabs.includes(filter.value)) filter.value = 'all'
})

function tabLabel(tab: InboxTab): string {
  if (tab === 'prs') return t('ghWatch.tab')
  if (tab === 'cicd') return t('infra.cicd.notify.tab')
  return t(`github.inbox.tab.${tab}`)
}
function tabHint(tab: InboxTab): string {
  if (tab === 'prs') return t('ghWatch.tabHint')
  if (tab === 'cicd') return t('infra.cicd.notify.tabHint')
  return t(`github.inbox.tabHint.${tab}`)
}
function tabCount(tab: InboxTab): number {
  if (tab === 'prs') return prRows.value.length
  if (tab === 'cicd') return cicdRuns.value.length
  return tab === 'all' ? items.value.length : watchedItems.value.length
}

// Group the visible list by repo, keeping the newest-first order: a group takes the
// position of its newest item, rows inside stay in list order. Map preserves
// insertion order, so no sorting is needed to get that.
type InboxGroup = {
  repo: string
  // owner/name split so the header can lead with the part that identifies the repo.
  owner: string
  name: string
  watched: boolean
  items: GhNotification[]
}
type InboxGroupView = InboxGroup & { unread: number }
const groups = computed<InboxGroupView[]>(() => {
  const byRepo = new Map<string, InboxGroup>()
  for (const n of visible.value) {
    let group = byRepo.get(n.repo)
    if (!group) {
      const slash = n.repo.indexOf('/')
      group = {
        repo: n.repo,
        owner: slash > 0 ? n.repo.slice(0, slash) : '',
        name: slash > 0 ? n.repo.slice(slash + 1) : n.repo,
        watched: isAlerting(n),
        items: [],
      }
      byRepo.set(n.repo, group)
    }
    group.items.push(n)
  }
  return [...byRepo.values()].map((g) => ({
    ...g,
    unread: g.items.filter((n) => n.unread).length,
  }))
})

// Collapsed repos. Component state, NOT persisted: a group folded away in a past
// session would silently hide new notifications on the next launch.
const collapsed = ref<Set<string>>(new Set())
const isCollapsed = (repo: string): boolean => collapsed.value.has(repo)
function toggleGroup(repo: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(repo)) next.add(repo)
  collapsed.value = next
}
const checkedLabel = computed(() =>
  lastFetchedAt.value
    ? t('github.inbox.checked', { when: formatRelativeAgo(lastFetchedAt.value, t, now.value) })
    : t('github.inbox.neverChecked'),
)

const prBusy = ref(false)

// Bật/tắt theo dõi. Khi BẬT, PR được gắn vào PHIÊN ĐANG MỞ (nếu có): đó là câu trả
// lời cho "đẩy sự kiện vào phiên nào" mà không cần thêm một cái picker — người
// dùng đang làm việc trong phiên nào thì CI của PR đó về phiên ấy. Không có phiên
// nào mở ⇒ vẫn theo dõi được, chỉ là không ai nhận tin (hàng tự nói ra điều đó).
async function onTogglePrWatch(row: PrRow, watchIt: boolean): Promise<void> {
  prBusy.value = true
  try {
    await togglePrWatch({
      repo: row.repo,
      number: row.number,
      watch: watchIt,
      title: row.title,
      url: row.url,
      account: settings.githubAccount || undefined,
      sessionId: watchIt ? (sessions.active?.engineId ?? null) : null,
    })
  } catch (err) {
    // Trần danh sách / gh không sẵn sàng: nói ra, đừng để cái công tắc bật hụt im lặng.
    useToast().add({
      title: err instanceof Error ? err.message : t('ghWatch.toggleFailed'),
      color: 'error',
    })
  } finally {
    prBusy.value = false
  }
}

function openPrExternal(url: string): void {
  if (url) void useLinkOpen().openLink(url)
}

// Mở lần chạy ở chính nguồn của nó (trang run của GitHub / console AWS). Panel đóng
// lại vì hàng này dẫn người dùng RA KHỎI app — giống hàng thông báo GitHub.
function openCicdRun(run: CicdRun): void {
  close()
  if (run.url) void useLinkOpen().openLink(run.url)
}

// Opening pulls a fresh list: the panel is a deliberate "what do I have right now?"
// question, and the poll interval can be up to 10 minutes wide. Esc / bấm ra ngoài
// do Popover tự lo.
watch(open, (isOpen) => {
  if (!isOpen) return
  void refreshGhInbox()
  // Đọc từ đĩa, không gọi GitHub (gh.prWatchList) — mở panel không được phép
  // biến thành một request mạng nữa.
  void refreshPrWatch()
})
function close(): void {
  open.value = false
}

const refresh = (): void => void refreshGhInbox()

function onOpen(n: GhNotification): void {
  close()
  openNotification(n)
}

// The row's ↗ hands the thread to the browser and LEAVES THE PANEL OPEN: the app
// itself doesn't change, and closing it forced a re-open for every next row. Only the
// in-app open (onOpen) closes, because it navigates the UI behind the panel.
function onExternal(n: GhNotification): void {
  if (n.url) void useLinkOpen().openLink(n.url)
}

const onRead = (id: string): void => void markGhNotificationRead(id)

// Marks the WHOLE GitHub inbox read, including repos AWOG never shows — worth a
// confirm even though GitHub offers the same button.
async function markAll(): Promise<void> {
  const ok = await confirm({
    title: t('github.inbox.markAllConfirm.title'),
    description: t('github.inbox.markAllConfirm.desc', { n: unreadCount.value }),
    confirmLabel: t('github.inbox.markAllRead'),
    kind: 'primary',
  })
  if (ok) await markAllGhNotificationsRead()
}

function goSettings(): void {
  close()
  openSettings('git')
}

function openOnGithub(): void {
  void useLinkOpen().openLink('https://github.com/notifications')
}
</script>
