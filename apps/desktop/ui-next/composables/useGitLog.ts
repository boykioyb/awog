import type { Commit, DiffLine, GitFile } from '~/components/git/git-types'
import { layoutGraph, type GraphRow } from '~/utils/git-graph'
import { useGitStore } from '~/stores/git'

// Controller của tab Git Log (workbench, kiểu JetBrains): log kèm graph thật tính từ
// parent, lọc theo message / hash / tác giả, phạm vi mọi branch hay branch hiện tại,
// commit đang chọn + file đổi + diff từng file. Dữ liệu đọc qua git store (đã scope
// theo project/repo của workbench) — tab giữ state riêng, không đụng log của Git
// Manager.

const PAGE = 200
// Commit được nhắm (click ở SCM) nằm ngoài trang đầu thì tải tiếp tối đa chừng này
// trang để tìm — sâu hơn thì thôi, tránh kéo cả lịch sử repo lớn.
const FOCUS_MAX_PAGES = 5
const SCOPE_KEY = 'awog.gitlog.scope'

export type GitLogScope = 'all' | 'current'
export type GitLogRow = { commit: Commit; graph: GraphRow | null }

function readScope(): GitLogScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'current' ? 'current' : 'all'
  } catch {
    return 'all'
  }
}

export function useGitLog(focusSha: () => string | undefined) {
  const git = useGitStore()

  const commits = shallowRef<Commit[]>([])
  const hasMore = ref(false)
  const loading = ref(false)
  const scope = ref<GitLogScope>(readScope())
  const query = ref('')
  const selected = ref<string | null>(null)
  const detail = shallowRef<{ files: GitFile[]; diffByPath: Record<string, DiffLine[]> } | null>(
    null,
  )
  const detailLoading = ref(false)

  watch(scope, (v) => {
    try {
      localStorage.setItem(SCOPE_KEY, v)
    } catch {
      // Storage bị chặn — lựa chọn chỉ sống trong lần chạy này.
    }
  })

  const layout = computed(() =>
    layoutGraph(commits.value.map((c) => ({ sha: c.sha ?? c.h, parents: c.parents ?? [] }))),
  )

  // Đang lọc thì bỏ graph (các hàng không còn liền nhau, đường nối sẽ sai) — cùng cách
  // JetBrains làm khi lọc theo text.
  const filtering = computed(() => query.value.trim() !== '')
  const rows = computed<GitLogRow[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) {
      return commits.value.map((commit, i) => ({ commit, graph: layout.value.rows[i] ?? null }))
    }
    return commits.value
      .filter(
        (c) =>
          c.m.toLowerCase().includes(q) ||
          (c.body ?? '').toLowerCase().includes(q) ||
          c.a.toLowerCase().includes(q) ||
          (c.sha ?? c.h).startsWith(q),
      )
      .map((commit) => ({ commit, graph: null }))
  })

  const selectedCommit = computed(
    () => commits.value.find((c) => (c.sha ?? c.h) === selected.value) ?? null,
  )

  async function fetchPage(skip: number): Promise<void> {
    const res = await git.loadGraphLog({ all: scope.value === 'all', skip, limit: PAGE })
    commits.value = skip ? [...commits.value, ...res.commits] : res.commits
    hasMore.value = res.hasMore
  }

  async function reload(): Promise<void> {
    loading.value = true
    try {
      await fetchPage(0)
      await ensureFocus()
      if (!selected.value && commits.value[0])
        selected.value = commits.value[0].sha ?? commits.value[0].h
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    loading.value = true
    try {
      await fetchPage(commits.value.length)
    } finally {
      loading.value = false
    }
  }

  // Chọn commit được nhắm từ bên ngoài (click ở SCM); chưa có trong list thì tải tiếp.
  async function ensureFocus(): Promise<void> {
    const sha = focusSha()
    if (!sha) return
    const has = () => commits.value.some((c) => (c.sha ?? c.h).startsWith(sha))
    for (let i = 0; i < FOCUS_MAX_PAGES && !has() && hasMore.value; i++) {
      await fetchPage(commits.value.length)
    }
    const hit = commits.value.find((c) => (c.sha ?? c.h).startsWith(sha))
    if (hit) selected.value = hit.sha ?? hit.h
  }

  // Chi tiết commit đang chọn — bỏ kết quả về muộn của lần chọn trước.
  let detailSeq = 0
  watch(selected, async (sha) => {
    const seq = ++detailSeq
    detail.value = null
    if (!sha) return
    detailLoading.value = true
    const res = await git.loadCommitDiff(sha)
    if (seq !== detailSeq) return
    detail.value = res
    detailLoading.value = false
  })

  // Di chuyển chọn bằng phím ↑ / ↓ (như JetBrains).
  function step(delta: 1 | -1): void {
    const list = rows.value
    const i = list.findIndex((r) => (r.commit.sha ?? r.commit.h) === selected.value)
    const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta))]
    if (next) selected.value = next.commit.sha ?? next.commit.h
  }

  // Nạp lại khi đổi phạm vi, đổi project/repo của workbench, hoặc HEAD/branch đổi.
  watch([scope, () => git.currentProjectId, () => git.branch], () => void reload(), {
    immediate: true,
  })
  // Bấm commit khác ở SCM khi tab đã mở ⇒ chỉ đổi chọn.
  watch(focusSha, () => void ensureFocus())

  return {
    rows,
    graphWidth: computed(() => (filtering.value ? 0 : layout.value.width)),
    hasMore,
    loading,
    scope,
    query,
    selected,
    selectedCommit,
    detail,
    detailLoading,
    reload,
    loadMore,
    step,
  }
}
