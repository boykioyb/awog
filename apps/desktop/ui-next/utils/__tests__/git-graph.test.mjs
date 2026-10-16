// Bài kiểm cho utils/git-graph.ts — xếp làn graph commit của tab Git Log. JS thuần
// `.mjs` vì lý do ghi ở composer-trigger.test.mjs. Chạy: `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutGraph } from '../git-graph.ts'

test('lịch sử thẳng: một làn, đường thẳng xuyên suốt', () => {
  const { rows, width } = layoutGraph([
    { sha: 'c', parents: ['b'] },
    { sha: 'b', parents: ['a'] },
    { sha: 'a', parents: [] },
  ])
  assert.equal(width, 1)
  assert.deepEqual(
    rows.map((r) => r.lane),
    [0, 0, 0],
  )
  // Hàng cuối (root) không có nửa dưới.
  assert.equal(rows[2].lower.length, 0)
  assert.deepEqual(rows[1].upper, [{ from: 0, to: 0, color: 0 }])
})

test('rẽ nhánh + merge: merge mở làn 1 cho parent thứ hai, rồi hội lại', () => {
  //  m  (merge của f và d)
  //  |\
  //  | f
  //  d |
  //  |/
  //  a
  const { rows, width } = layoutGraph([
    { sha: 'm', parents: ['d', 'f'] },
    { sha: 'f', parents: ['a'] },
    { sha: 'd', parents: ['a'] },
    { sha: 'a', parents: [] },
  ])
  assert.equal(width, 2)
  assert.equal(rows[0].merge, true)
  assert.deepEqual(
    rows.map((r) => r.lane),
    [0, 1, 0, 0],
  )
  // Merge toả xuống hai làn.
  assert.deepEqual(rows[0].lower.map((s) => [s.from, s.to]).sort(), [
    [0, 0],
    [0, 1],
  ])
  // Ở hàng 'a', cả hai làn đều đang chờ 'a' ⇒ làn 1 cong về node ở làn 0.
  assert.deepEqual(rows[3].upper.map((s) => [s.from, s.to]).sort(), [
    [0, 0],
    [1, 0],
  ])
  // Hai nhánh mang hai màu khác nhau.
  assert.notEqual(rows[1].color, rows[2].color)
})

test('đầu nhánh không con (tip của branch khác) mở làn mới', () => {
  const { rows } = layoutGraph([
    { sha: 'x', parents: ['a'] }, // tip branch A
    { sha: 'y', parents: ['a'] }, // tip branch B — không ai chờ ⇒ làn mới
    { sha: 'a', parents: [] },
  ])
  assert.equal(rows[0].lane, 0)
  assert.equal(rows[1].lane, 1)
  assert.equal(rows[2].lane, 0)
})

test('ô trống được tái dùng — bề ngang không phình theo số nhánh đã đóng', () => {
  const { width } = layoutGraph([
    { sha: 'm2', parents: ['m1', 'g'] },
    { sha: 'g', parents: ['m1'] },
    { sha: 'm1', parents: ['b', 'f'] },
    { sha: 'f', parents: ['b'] },
    { sha: 'b', parents: [] },
  ])
  assert.equal(width, 2)
})
