// State + handlers của components/workbench/explorer/GithubView.vue — tách ra theo
// page-controller rule (SFC vượt ~250 dòng sau khi dỡ skin .wgh-*).
//
// View "GitHub": list PR + Issue của repo project qua gh.list (sidecar), filter
// client-side theo state/label/author/assignee/reviewer, click → doc web GitHub.
import { Eye, GitPullRequest, Tag, User, UserCheck } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { GhThreadSummary } from '~/composables/useProjectGh'
import { openWebDoc, useWorkbenchExplorer } from '~/composables/useWorkbenchExplorer'
import { useSidecar } from '~/composables/useSidecar'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { resolveGhAccount } from '~/utils/project-gh-account'

type GhKind = 'pr' | 'issue'

// Popover filter: mỗi chiều một selectbox (header + expand list + searchbox).
// filters độc lập, kết hợp AND. secOpen = chiều đang mở (accordion, 1 tại 1 thời
// điểm); filterQ = query của searchbox đang mở.
type FKey = 'st' | 'label' | 'author' | 'as' | 'rv'
const STATES = ['Open', 'Merged', 'Closed', 'Draft'] as const

const SECS: { key: FKey; label: string; icon: Component; avatar?: boolean }[] = [
  { key: 'st', label: 'State', icon: GitPullRequest },
  { key: 'label', label: 'Label', icon: Tag },
  { key: 'author', label: 'Author', icon: User, avatar: true },
  { key: 'as', label: 'Assignee', icon: UserCheck, avatar: true },
  { key: 'rv', label: 'Reviewer', icon: Eye, avatar: true },
]

// Label pill → cụm class màu; key tĩnh nên Record literal (không Map).
const LBL_CLS: Record<string, string> = {
  bug: 'text-[var(--danger)] bg-[var(--dangerDim)]',
  feat: 'text-[var(--accent)] bg-[var(--accentDim)]',
}
const LBL_CLS_DEFAULT = 'text-[var(--violet)] bg-[color-mix(in_srgb,var(--violet)_10%,transparent)]'

// Màu avatar theo author — xoay vòng bảng màu theme.
const AV_COLORS = [
  'var(--blue)',
  'var(--warning)',
  'var(--violet)',
  'var(--danger)',
  'var(--green)',
]

export function useGithubViewManager() {
  const exp = useWorkbenchExplorer()
  const sc = useSidecar()
  const projectsStore = useProjectsStore()
  const settings = useSettingsStore()

  const kind = ref<GhKind>('pr')
  const items = ref<GhThreadSummary[]>([])
  const loading = ref(false)
  const error = ref('')

  const repoLabel = computed(() => {
    const base = exp.ghBase.value
    if (base) return base.replace('https://', '')
    return exp.project.value?.name ?? 'repo'
  })

  const prs = computed(() => items.value.filter((i) => i.kind === 'pr'))
  const issues = computed(() => items.value.filter((i) => i.kind === 'issue'))

  const filters = reactive<Record<FKey, string>>({ st: '', label: '', author: '', as: '', rv: '' })
  const filterOpen = ref(false)
  const secOpen = ref<FKey | ''>('')
  const filterQ = ref('')

  const uniq = (fn: (it: GhThreadSummary) => string[]) =>
    computed(() => {
      const s = new Set<string>()
      for (const it of items.value) for (const l of fn(it)) s.add(l)
      return [...s]
    })
  const labels = uniq((it) => it.labels.map((l) => l.name))
  const authors = uniq((it) => (it.author?.login ? [it.author.login] : []))
  const assignees = uniq((it) => it.assignees.map((a) => a.login))
  const reviewers = uniq((it) => (it.reviewers ?? []).map((r) => r.login))

  function optsOf(sec: (typeof SECS)[number]): readonly string[] {
    const raw =
      sec.key === 'st'
        ? [...STATES]
        : sec.key === 'label'
          ? labels.value
          : sec.key === 'author'
            ? authors.value
            : sec.key === 'as'
              ? assignees.value
              : reviewers.value
    const q = filterQ.value.trim().toLowerCase()
    return q ? raw.filter((s) => s.toLowerCase().includes(q)) : raw
  }

  const hasFilter = computed(() => Object.values(filters).some(Boolean))
  const activeFilters = computed(() =>
    SECS.filter((s) => filters[s.key]).map((s) => ({
      key: s.key,
      text: `${s.label}: ${filters[s.key]}`,
    })),
  )
  function toggleSec(k: FKey): void {
    secOpen.value = secOpen.value === k ? '' : k
    filterQ.value = ''
  }
  function setFilter(k: FKey, v: string): void {
    filters[k] = v
    secOpen.value = ''
  }
  function clearFilters(): void {
    for (const k of Object.keys(filters) as FKey[]) filters[k] = ''
    secOpen.value = ''
  }

  const filtered = computed(() => {
    let list = kind.value === 'pr' ? prs.value : issues.value
    if (filters.st) list = list.filter((i) => stTxt(i).toLowerCase() === filters.st.toLowerCase())
    if (filters.label) list = list.filter((i) => i.labels.some((l) => l.name === filters.label))
    if (filters.author) list = list.filter((i) => i.author?.login === filters.author)
    if (filters.as) list = list.filter((i) => i.assignees.some((a) => a.login === filters.as))
    if (filters.rv)
      list = list.filter((i) => (i.reviewers ?? []).some((r) => r.login === filters.rv))
    return list
  })

  // Avatar GitHub — tải ảnh của user; login fail (404/offline) → fallback letter.
  const avFail = ref(new Set<string>())
  const ghAvatar = (login: string): string => `https://github.com/${login}.png?size=40`

  // Review banner: PR mới nhất có review APPROVED → card nhỏ click mở.
  const banner = computed(() => {
    const pr = prs.value.find((i) => i.reviewers?.some((r) => r.state === 'APPROVED'))
    if (!pr) return null
    const who = pr.reviewers?.find((r) => r.state === 'APPROVED')?.login ?? 'reviewer'
    return { who, item: pr }
  })

  // State pill → cụm class màu Tailwind (JIT quét được chuỗi literal ở đây).
  function stCls(it: GhThreadSummary): string {
    if (it.isDraft) return 'text-[var(--textDim)] bg-[var(--bgActive)]'
    if (it.state === 'MERGED')
      return 'text-[var(--violet)] bg-[color-mix(in_srgb,var(--violet)_12%,transparent)]'
    if (it.state === 'CLOSED') return 'text-[var(--danger)] bg-[var(--dangerDim)]'
    return 'text-[var(--accent)] bg-[var(--accentDim)]'
  }
  function stTxt(it: GhThreadSummary): string {
    if (it.isDraft) return 'Draft'
    if (it.state === 'MERGED') return 'Merged'
    if (it.state === 'CLOSED') return 'Closed'
    return 'Open'
  }

  function avColor(login: string): string {
    let h = 0
    for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) | 0
    return AV_COLORS[Math.abs(h) % AV_COLORS.length] ?? 'var(--blue)'
  }

  async function refresh(): Promise<void> {
    if (!sc.available || !exp.projectId.value) return
    loading.value = true
    error.value = ''
    try {
      const project = exp.projectId.value
      const ghAccount = resolveGhAccount(
        projectsStore.projectById(project)?.githubAccount,
        settings.githubAccount,
      )
      const repoPath = exp.repoPrefix.value || undefined
      const [prRes, isRes] = await Promise.all([
        sc.request<{ items: GhThreadSummary[] }>('gh.list', {
          projectId: project,
          kind: 'pr',
          state: 'all',
          limit: 30,
          ...(repoPath ? { repoPath } : {}),
          ...(ghAccount ? { account: ghAccount } : {}),
        }),
        sc.request<{ items: GhThreadSummary[] }>('gh.list', {
          projectId: project,
          kind: 'issue',
          state: 'all',
          limit: 30,
          ...(repoPath ? { repoPath } : {}),
          ...(ghAccount ? { account: ghAccount } : {}),
        }),
      ])
      items.value = [...prRes.items, ...isRes.items]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function openItem(it: GhThreadSummary): void {
    const base = exp.ghBase.value || 'https://github.com'
    const url = `${base}/${it.kind === 'pr' ? 'pull' : 'issues'}/${it.number}`
    const tag = it.kind === 'pr' ? 'PR' : 'Issue'
    void openWebDoc(url, `${tag} #${it.number} — ${it.title}`)
  }

  // Nạp khi view mở lần đầu + khi project đổi.
  watch(
    exp.projectId,
    (id, prev) => {
      if (id && id !== prev) void refresh()
    },
    { immediate: true },
  )

  return {
    kind,
    loading,
    error,
    repoLabel,
    prs,
    issues,
    filtered,
    banner,
    filters,
    filterOpen,
    secOpen,
    filterQ,
    SECS,
    LBL_CLS,
    LBL_CLS_DEFAULT,
    hasFilter,
    activeFilters,
    toggleSec,
    setFilter,
    clearFilters,
    optsOf,
    avFail,
    ghAvatar,
    avColor,
    stCls,
    stTxt,
    refresh,
    openItem,
  }
}
