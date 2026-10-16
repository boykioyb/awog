import type { DiffLine } from '~/components/git/git-types'
import { useGitStore } from '~/stores/git'

// Diff theo file của một commit, tải MỘT lần cho mọi tab 'cdiff' của commit đó (mở lần
// lượt nhiều file của cùng commit không gọi lại git). Map ở mức MODULE — dùng chung
// giữa các tab; trần nhỏ, commit cũ rơi theo thứ tự thêm. Commit là bất biến nên cache
// không bao giờ cũ theo nội dung.
const cache = new Map<string, Record<string, DiffLine[]>>()
const CACHE_MAX = 8

export function useCommitDiffCache() {
  const git = useGitStore()
  async function diffOf(sha: string): Promise<Record<string, DiffLine[]>> {
    const hit = cache.get(sha)
    if (hit) return hit
    const byPath = (await git.loadCommitDiff(sha)).diffByPath
    cache.set(sha, byPath)
    if (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return byPath
  }
  return { diffOf }
}
