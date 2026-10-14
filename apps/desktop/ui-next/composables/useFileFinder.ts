import { computed, ref, watch, type Ref } from 'vue'
import { useFsApi } from '~/composables/useFsApi'
import { scoreFileName } from '~/utils/fuzzy'

// Tìm file trong CẢ project cho ô "Tìm file…" của Explorer Workbench — kiểu quick-open
// của VS Code. Bản trước chỉ làm mờ các node KHÔNG khớp trong những thư mục đã mở,
// nên file nằm trong thư mục chưa bung thì không bao giờ thấy.
//
// Nguồn là `fs.listFiles` (sidecar: `git ls-files` tôn trọng .gitignore, rơi về duyệt
// cây bỏ node_modules/dist…; trần 20k file). Danh sách cache theo root cấp module;
// bắt đầu một lượt tìm mới mà bản cache đã quá STALE_MS thì nạp lại nền (vẫn hiện kết
// quả cũ trong lúc chờ) — file vừa tạo/xoá ở chỗ khác sẽ khớp sau vài giây.

// `positions`: chỉ số khớp trong `name` (chỉ tên file được so, không so thư mục).
export type FileHit = { path: string; name: string; dir: string; positions: number[] }

const MAX_RESULTS = 200
const STALE_MS = 15_000

// `failed`: lần nạp gần nhất lỗi (mất engine, project không đọc được). `at = 0` để lượt
// tìm sau thử lại ngay; giữ danh sách cũ nếu từng có.
type Entry = { at: number; files: string[]; truncated: boolean; failed?: boolean }
const cache = ref<Record<string, Entry>>({})
const inflight = new Map<string, Promise<void>>()

export function useFileFinder(root: Ref<string>, query: Ref<string>) {
  const fs = useFsApi()

  function ensure(r: string): Promise<void> {
    const hit = cache.value[r]
    if (hit && Date.now() - hit.at < STALE_MS) return Promise.resolve()
    const running = inflight.get(r)
    if (running) return running
    const p = (async () => {
      try {
        const res = await fs.listFiles(r)
        cache.value = {
          ...cache.value,
          [r]: { at: Date.now(), files: res.files.map((f) => f.path), truncated: res.truncated },
        }
      } catch {
        const prev = cache.value[r]
        cache.value = {
          ...cache.value,
          [r]: {
            at: 0,
            files: prev?.files ?? [],
            truncated: prev?.truncated ?? false,
            failed: true,
          },
        }
      } finally {
        inflight.delete(r)
      }
    })()
    inflight.set(r, p)
    return p
  }

  const active = computed(() => query.value.trim() !== '')
  // Bắt đầu gõ (hoặc đổi project khi đang tìm) ⇒ nạp/làm tươi danh sách.
  watch(
    [root, active],
    ([r, on]) => {
      if (r && on) void ensure(r)
    },
    { immediate: true },
  )

  const entry = computed<Entry | undefined>(() => cache.value[root.value])
  // Không có project (root rỗng) thì không có gì để lập chỉ mục — không treo "đang tải".
  const loading = computed(() => active.value && !!root.value && !entry.value)
  const failed = computed(() => entry.value?.failed === true)
  const truncated = computed(() => entry.value?.truncated ?? false)

  const results = computed<FileHit[]>(() => {
    const q = query.value.trim()
    const files = entry.value?.files
    if (!q || !files) return []
    const scored: { path: string; score: number; positions: number[] }[] = []
    for (const path of files) {
      const m = scoreFileName(q, path)
      if (m) scored.push({ path, score: m.score, positions: m.positions })
    }
    scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    return scored.slice(0, MAX_RESULTS).map(({ path, positions }) => {
      const slash = path.lastIndexOf('/')
      return {
        path,
        name: slash >= 0 ? path.slice(slash + 1) : path,
        dir: slash >= 0 ? path.slice(0, slash) : '',
        positions,
      }
    })
  })

  return { results, loading, failed, truncated }
}
