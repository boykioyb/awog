// Bài kiểm cho utils/office-csv.ts (CSV/TSV → sheet vẽ bằng lưới Excel). Chạy: `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDelimiter, parseCsv, parseCsvRows } from '../office-csv.ts'

test('ô có ngoặc kép chứa dấu phẩy, "" và xuống dòng; CRLF', () => {
  const src = 'name,note\r\n"Yahagi, Inc.","nói ""xin chào""\ndòng 2"\r\nB,2\r\n'
  assert.deepEqual(parseCsvRows(src, ',').rows, [
    ['name', 'note'],
    ['Yahagi, Inc.', 'nói "xin chào"\ndòng 2'],
    ['B', '2'],
  ])
})

test('bỏ BOM; dòng cuối không có xuống dòng vẫn đọc', () => {
  assert.deepEqual(parseCsvRows('﻿a,b\n1,2', ',').rows, [
    ['a', 'b'],
    ['1', '2'],
  ])
})

test('đoán dấu phân cách: ; (Excel locale châu Âu/Nhật) và tab', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';')
  assert.equal(detectDelimiter('a\tb\tc'), '\t')
  assert.equal(detectDelimiter('"x;y",b,c'), ',')
})

test('parseCsv → một sheet: ô rỗng = null, số căn phải, colCount theo dòng dài nhất', () => {
  const book = parseCsv('item,cost\nEC2,"1,234.50"\nS3,\nRDS,12%,extra', 'cost.csv')
  const sheet = book.sheets[0]
  assert.equal(sheet.name, 'cost.csv')
  assert.equal(sheet.colCount, 3)
  assert.deepEqual(sheet.rows[1][1], { text: '1,234.50', num: true })
  assert.equal(sheet.rows[2][1], null)
  assert.deepEqual(sheet.rows[3][1], { text: '12%', num: true })
  assert.deepEqual(sheet.rows[0][0], { text: 'item' })
  assert.equal(book.truncated, false)
})

test('cắt ở 5000 dòng và báo truncated', () => {
  const big = Array.from({ length: 5100 }, (_, i) => `r${i},x`).join('\n')
  const book = parseCsv(big, 'big.csv')
  assert.equal(book.sheets[0].rows.length, 5000)
  assert.equal(book.truncated, true)
})
