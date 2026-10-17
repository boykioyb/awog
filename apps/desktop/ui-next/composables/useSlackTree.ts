import { computed, ref } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { tsAfter, useSlackStore, type SlackThread } from '~/stores/slack'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'

// Cột trái của Slack threads (docs/features/slack-threads.md): tìm, lọc project và cây
// Workspace → #kênh → thread (mới nhất lên đầu). Tách khỏi useSlackManager — chỉ đọc
// store, không gọi RPC.

export const SLACK_ALL_PROJECTS = '__all'
export const SLACK_NO_PROJECT = '__none'

export type SlackTreeThread = { thread: SlackThread; title: string; unread: boolean; when: string }
export type SlackTreeChannel = { key: string; name: string; threads: SlackTreeThread[] }
export type SlackTreeTeam = { key: string; name: string; channels: SlackTreeChannel[] }

export const threadTitle = (th: SlackThread): string => th.title?.trim() || th.firstLine || ''

// Mới nhất trước; bằng nhau trả 0 để sort ổn định (comparator không nhất quán thì thứ
// tự hai thread cùng mốc nhảy qua lại mỗi lần tính lại).
const byLastReplyDesc = (a: SlackThread, b: SlackThread): number => {
  if (a.lastReplyTs === b.lastReplyTs) return 0
  return tsAfter(a.lastReplyTs, b.lastReplyTs) ? -1 : 1
}

export function useSlackTree() {
  const store = useSlackStore()
  const projects = useProjectsStore()
  const { t } = useI18n()
  const now = useNow()

  const search = ref('')
  const projectFilter = ref(SLACK_ALL_PROJECTS)
  const collapsed = ref(new Set<string>())

  const projectOptions = computed<AppSelectOption[]>(() => [
    { value: SLACK_ALL_PROJECTS, label: t('slack.filter.allProjects') },
    { value: SLACK_NO_PROJECT, label: t('slack.filter.noProject') },
    ...projects.projects.map((p) => ({ value: p.id, label: p.name })),
  ])
  const assignOptions = computed<AppSelectOption[]>(() => [
    { value: SLACK_NO_PROJECT, label: t('slack.filter.noProject') },
    ...projects.projects.map((p) => ({ value: p.id, label: p.name })),
  ])

  // "4h · 2d" — mốc lấy từ `ts` của Slack (giây). `now` là ticker chung 30s của app.
  function relTime(ts: string): string {
    const sec = Math.max(0, now.value / 1000 - Number(ts))
    const min = Math.floor(sec / 60)
    if (min < 1) return t('slack.time.now')
    if (min < 60) return t('slack.time.minutes', { n: min })
    const h = Math.floor(min / 60)
    if (h < 24) return t('slack.time.hours', { n: h })
    return t('slack.time.days', { n: Math.floor(h / 24) })
  }

  const matches = (th: SlackThread, q: string): boolean =>
    !q ||
    [threadTitle(th), th.firstLine, th.channelName, th.teamName].some((s) =>
      s.toLowerCase().includes(q),
    )

  const passesProject = (th: SlackThread, pf: string): boolean => {
    if (pf === SLACK_ALL_PROJECTS) return true
    if (pf === SLACK_NO_PROJECT) return !th.projectId
    return th.projectId === pf
  }

  const tree = computed<SlackTreeTeam[]>(() => {
    const q = search.value.trim().toLowerCase()
    const pf = projectFilter.value
    const teams = new Map<string, SlackTreeTeam>()
    const channels = new Map<string, SlackTreeChannel>()
    for (const th of [...store.threads].sort(byLastReplyDesc)) {
      if (!passesProject(th, pf) || !matches(th, q)) continue
      let team = teams.get(th.teamId)
      if (!team) {
        team = { key: th.teamId, name: th.teamName, channels: [] }
        teams.set(th.teamId, team)
      }
      const chKey = `${th.teamId}:${th.channelId}`
      let ch = channels.get(chKey)
      if (!ch) {
        ch = { key: chKey, name: th.channelName, threads: [] }
        channels.set(chKey, ch)
        team.channels.push(ch)
      }
      ch.threads.push({
        thread: th,
        title: threadTitle(th) || t('slack.thread.untitled'),
        unread: tsAfter(th.lastReplyTs, th.lastSeenTs),
        when: relTime(th.lastReplyTs),
      })
    }
    return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  const isCollapsed = (key: string): boolean => collapsed.value.has(key)
  function toggleCollapsed(key: string): void {
    const next = new Set(collapsed.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed.value = next
  }

  return {
    search,
    projectFilter,
    projectOptions,
    assignOptions,
    tree,
    isCollapsed,
    toggleCollapsed,
    relTime,
  }
}
