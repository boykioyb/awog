// Bài kiểm cho utils/fuzzy.ts — thứ hạng tìm file của Explorer Workbench (chỉ theo
// TÊN FILE). JS thuần `.mjs` vì lý do ghi ở composer-trigger.test.mjs. Chạy:
// `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreFileName } from '../fuzzy.ts'

const rank = (q, paths) =>
  paths
    .map((p) => ({ p, m: scoreFileName(q, p) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score || a.p.length - b.p.length)
    .map((x) => x.p)

test('chỉ so tên file — thư mục chứa không làm một file khớp', () => {
  // `issues/` là THƯ MỤC: service.py không được khớp "issue".
  const out = rank('issue', [
    'backend/app/issues/service.py',
    'frontend/src/components/IssueList.vue',
    'docs/specs/issue-scope.md',
  ])
  assert.deepEqual(out.sort(), [
    'docs/specs/issue-scope.md',
    'frontend/src/components/IssueList.vue',
  ])
  assert.equal(scoreFileName('src', 'src/a.ts'), null)
})

test('tên bắt đầu bằng chữ đang gõ xếp trên tên chỉ chứa nó', () => {
  const out = rank('use', ['components/AppUser.vue', 'composables/useFileFinder.ts'])
  assert.equal(out[0], 'composables/useFileFinder.ts')
})

test('vị trí tô sáng là chỉ số trong tên file', () => {
  const m = scoreFileName('cla', 'apps/web/CLAUDE.md')
  assert.deepEqual(m.positions, [0, 1, 2])
})
