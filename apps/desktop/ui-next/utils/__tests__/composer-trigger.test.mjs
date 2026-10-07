// Bài kiểm cho utils/composer-trigger.ts (spec docs/features/composer-trigger-fixes.md).
//
// JS thuần `.mjs` chứ không `.ts`: tsconfig Nuxt sinh ra nạp mọi file trong ui-next
// nhưng không bật `allowImportingTsExtensions`, nên một file test `.ts` import có đuôi
// `.ts` sẽ đỏ typecheck, còn bỏ đuôi thì Node không resolve. Chạy:
//
//   pnpm test:unit   (Node ≥ 22.18; bản cũ hơn thêm --experimental-strip-types)
//
// Ca viết theo AC của spec, `|` trong chuỗi là vị trí con trỏ.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mentionTokenAt,
  removeMention,
  replaceMention,
  replaceSlashToken,
  slashHead,
  slashTokenAt,
  slashTokenEnd,
} from '../composer-trigger.ts'

// `'/evo| fix'` → { draft: '/evo fix', caret: 4 }
function at(marked) {
  const caret = marked.indexOf('|')
  assert.ok(caret >= 0, `missing caret marker in ${JSON.stringify(marked)}`)
  return { draft: marked.slice(0, caret) + marked.slice(caret + 1), caret }
}

// Kết quả biên tập dạng chuỗi có `|` để so một lần cả text lẫn caret.
function mark(edit) {
  return edit.text.slice(0, edit.caret) + '|' + edit.text.slice(edit.caret)
}

function slashAt(marked) {
  const { draft, caret } = at(marked)
  return slashTokenAt(draft, caret)
}

function mentionAt(marked) {
  const { draft, caret } = at(marked)
  return mentionTokenAt(draft, caret)
}

function pickMention(marked, insert) {
  const { draft, caret } = at(marked)
  const token = mentionTokenAt(draft, caret)
  assert.ok(token, `no mention token in ${JSON.stringify(marked)}`)
  return mark(replaceMention(draft, token, insert))
}

// ── slashTokenAt (R-B1/R-B2) ────────────────────────────────────────────────

test('slashTokenAt: AC-B1 bare `/` opens with an empty query', () => {
  assert.equal(slashAt('/|'), '')
})

test('slashTokenAt: AC-B2 query is the token before the caret', () => {
  assert.equal(slashAt('/evo|'), 'evo')
})

test('slashTokenAt: AC-B4 no token on any prefix of the args after a picked command', () => {
  const base = '/evon:ui-ux '
  const typed = 'review trang login'
  for (let i = 0; i <= typed.length; i++) {
    assert.equal(slashAt(`${base}${typed.slice(0, i)}|`), null, `prefix ${i}`)
  }
})

test('slashTokenAt: AC-B6 exact name with caret at end still has a token', () => {
  assert.equal(slashAt('/evon:ui-ux|'), 'evon:ui-ux')
})

test('slashTokenAt: AC-B9 caret moved back inside the head token', () => {
  assert.equal(slashAt('/evon:| fix bug'), 'evon:')
})

test('slashTokenAt: AC-B11 caret after the first space (End) has no token', () => {
  assert.equal(slashAt('/evo| fix'), 'evo')
  assert.equal(slashAt('/evo fix|'), null)
})

test('slashTokenAt: AC-B13 newline after the command closes the token', () => {
  assert.equal(slashAt('/evon:ui-ux\nchi tiết|'), null)
  assert.equal(slashAt('/evon:ui-ux\n|'), null)
})

test('slashTokenAt: caret 0 (before `/`) is not inside the token', () => {
  assert.equal(slashAt('|/evo'), null)
})

test('slashTokenAt: draft not starting with `/` has no token', () => {
  assert.equal(slashAt('fix /evo|'), null)
  assert.equal(slashAt(' /evo|'), null)
  assert.equal(slashAt('|'), null)
})

// ── replaceSlashToken (R-B4) ────────────────────────────────────────────────

test('replaceSlashToken: AC-B3 picking on a bare token appends one space, caret after it', () => {
  assert.equal(mark(replaceSlashToken('/evo', 'evon:ui-ux')), '/evon:ui-ux |')
  assert.equal(mark(replaceSlashToken('/evon:ui-ux', 'evon:ui-ux')), '/evon:ui-ux |')
})

test('replaceSlashToken: AC-B10 keeps the rest, caret right before it', () => {
  assert.equal(mark(replaceSlashToken('/evon: fix bug', 'evon:ui-ux')), '/evon:ui-ux |fix bug')
})

test('replaceSlashToken: rest made only of whitespace is kept, caret stays in range', () => {
  const edit = replaceSlashToken('/evo   \n', 'evon:ui-ux')
  assert.equal(edit.text, '/evon:ui-ux   \n')
  assert.ok(edit.caret <= edit.text.length)
  assert.equal(mark(edit), '/evon:ui-ux |  \n')
})

test('replaceSlashToken: E13 a newline right after the token is replaced by the space', () => {
  assert.equal(mark(replaceSlashToken('/cmd\nbody', 'cmd')), '/cmd |body')
})

// ── slashTokenEnd (R-B6) ────────────────────────────────────────────────────

test('slashTokenEnd: AC-B18 bare `/` → caret after `/`', () => {
  assert.equal(slashTokenEnd('/'), 1)
})

test('slashTokenEnd: AC-B19 caret right after the first word', () => {
  assert.equal(slashTokenEnd('/fix bug'), 4)
  assert.equal(slashTokenEnd('/fix\nbug'), 4)
  assert.equal(slashTokenEnd('/fixbug'), 7)
})

// ── slashHead (R-B7) ────────────────────────────────────────────────────────

test('slashHead: AC-B15 exact built-in name + rest after one space', () => {
  assert.deepEqual(slashHead('/plan fix bug'), { name: 'plan', rest: 'fix bug' })
  assert.deepEqual(slashHead('/compact '), { name: 'compact', rest: '' })
  assert.deepEqual(slashHead('/compact'), { name: 'compact', rest: '' })
})

test('slashHead: AC-B16 prefix stays a prefix (caller compares exactly)', () => {
  assert.deepEqual(slashHead('/pla fix'), { name: 'pla', rest: 'fix' })
})

test('slashHead: raw draft (no trim), bare `/`, and non-command drafts', () => {
  assert.deepEqual(slashHead('/plan  two spaces'), { name: 'plan', rest: ' two spaces' })
  assert.deepEqual(slashHead('/'), { name: '', rest: '' })
  assert.equal(slashHead('plan fix'), null)
  assert.equal(slashHead(' /plan'), null)
})

// ── mentionTokenAt (R-D1/R-D4) ──────────────────────────────────────────────

test('mentionTokenAt: AC-B20 mention after a command opens the mention menu', () => {
  assert.deepEqual(mentionAt('/evon:ui-ux review @sr|'), { start: 19, end: 22, query: 'sr' })
  assert.equal(slashAt('/evon:ui-ux review @sr|'), null)
})

test('mentionTokenAt: start / middle / end of the draft', () => {
  assert.deepEqual(mentionAt('@sr|'), { start: 0, end: 3, query: 'sr' })
  assert.deepEqual(mentionAt('Sửa @ui| cho đẹp'), { start: 4, end: 7, query: 'ui' })
  assert.deepEqual(mentionAt('Review @|'), { start: 7, end: 8, query: '' })
})

test('mentionTokenAt: AC-D5 caret inside a token → query before caret, span to token end', () => {
  const marked = 'Đọc @wiki:arch|itecture giúp'
  const { draft } = at(marked)
  const token = mentionAt(marked)
  assert.equal(token.query, 'wiki:arch')
  assert.equal(draft.slice(token.start, token.end), '@wiki:architecture')
})

test('mentionTokenAt: AC-D7 `@` on a middle line of a multi-line draft', () => {
  const token = mentionAt('Dòng 1\nXem @fo|\nDòng 3')
  assert.equal(token.query, 'fo')
  assert.equal(token.end, token.start + 3)
})

test('mentionTokenAt: `@` right after a newline triggers', () => {
  assert.equal(mentionAt('Dòng 1\n@fo|').query, 'fo')
})

test('mentionTokenAt: AC-D13 email-like `a@b` does not trigger', () => {
  assert.equal(mentionAt('liên hệ a@b|'), null)
})

test('mentionTokenAt: caret past a completed mention + space has no token', () => {
  assert.equal(mentionAt('Xem @src/a.ts |rồi'), null)
})

test('mentionTokenAt: E14 a same-class char after the caret is swallowed into the span', () => {
  const marked = 'xem @fo|.'
  const { draft } = at(marked)
  const token = mentionAt(marked)
  assert.equal(draft.slice(token.start, token.end), '@fo.')
})

test('mentionTokenAt: E15 an out-of-class char after the caret ends the span', () => {
  const marked = '@fo|,'
  const { draft } = at(marked)
  const token = mentionAt(marked)
  assert.equal(draft.slice(token.start, token.end), '@fo')
})

test('mentionTokenAt: E16 accented query closes the menu (ASCII \\w on purpose)', () => {
  assert.equal(mentionAt('@tài|'), null)
})

// ── replaceMention (R-D2/R-D3) ──────────────────────────────────────────────

test('replaceMention: AC-D1 at the start of the draft', () => {
  assert.equal(pickMention('@sr|', 'src/a.ts'), '@src/a.ts |')
})

test('replaceMention: AC-D2 at the end of the draft', () => {
  assert.equal(pickMention('Review @rea|', 'README.md'), 'Review @README.md |')
})

test('replaceMention: AC-D3 in the middle reuses the existing space', () => {
  assert.equal(pickMention('Sửa @ui| cho đẹp', 'ui-designer'), 'Sửa @ui-designer |cho đẹp')
})

test('replaceMention: AC-D4 only the token at the caret changes among several `@`', () => {
  assert.equal(
    pickMention('So sánh @src/a.ts với @b| rồi xem @wiki:x', 'src/b.ts'),
    'So sánh @src/a.ts với @src/b.ts |rồi xem @wiki:x',
  )
})

test('replaceMention: flow D — mention typed into an existing gap', () => {
  assert.equal(
    pickMention('So sánh @src/a.ts với @b| rồi kết luận', 'src/b.ts'),
    'So sánh @src/a.ts với @src/b.ts |rồi kết luận',
  )
})

test('replaceMention: AC-D6 caret mid-token replaces the whole token (no `itecture` left)', () => {
  assert.equal(
    pickMention('Đọc @wiki:arch|itecture giúp', 'wiki:architecture/overview.md'),
    'Đọc @wiki:architecture/overview.md |giúp',
  )
})

test('replaceMention: AC-D7 middle line gets a trailing space, newlines untouched', () => {
  assert.equal(pickMention('Dòng 1\nXem @fo|\nDòng 3', 'foo.ts'), 'Dòng 1\nXem @foo.ts |\nDòng 3')
})

test('replaceMention: a tab after the token is reused as the trailing space', () => {
  assert.equal(pickMention('@fo|\tx', 'foo.ts'), '@foo.ts\t|x')
})

test('replaceMention: E14 swallowed dot, E15 space before the comma', () => {
  assert.equal(pickMention('xem @fo|.', 'foo.ts'), 'xem @foo.ts |')
  assert.equal(pickMention('@fo|,', 'foo.ts'), '@foo.ts |,')
})

// ── removeMention (R-D5) ────────────────────────────────────────────────────

test('removeMention: AC-D8 removes the token plus one following space', () => {
  const { draft, caret } = at('Tóm tắt @pa| giúp tôi')
  const token = mentionTokenAt(draft, caret)
  assert.equal(mark(removeMention(draft, token)), 'Tóm tắt |giúp tôi')
})

test('removeMention: token at the end leaves the text before it untouched', () => {
  const { draft, caret } = at('Tóm tắt @pa|')
  const token = mentionTokenAt(draft, caret)
  assert.equal(mark(removeMention(draft, token)), 'Tóm tắt |')
})

test('removeMention: only the token at the caret is removed, newline is kept', () => {
  const { draft, caret } = at('@src/a.ts và @pa|\nsau')
  const token = mentionTokenAt(draft, caret)
  assert.equal(mark(removeMention(draft, token)), '@src/a.ts và |\nsau')
})

// ── QA bổ sung (T4): ca biên chưa phủ ───────────────────────────────────────

test('QA slashTokenAt: tab right after the token closes it (R-B1 counts every \\s)', () => {
  assert.equal(slashAt('/evo\t|'), null)
  assert.equal(slashAt('/evo|\tfix'), 'evo')
})

test('QA slashTokenAt: caret inside the token keeps only the part before the caret', () => {
  assert.equal(slashAt('/ev|on:ui-ux fix'), 'ev')
})

test('QA replaceSlashToken: bare `/` (AC-B18 then pick) → `/label |`', () => {
  assert.equal(mark(replaceSlashToken('/', 'compact')), '/compact |')
})

test('QA replaceSlashToken: only ONE whitespace after the token is consumed, the rest kept', () => {
  assert.equal(mark(replaceSlashToken('/evo  fix', 'evon:ui-ux')), '/evon:ui-ux | fix')
  assert.equal(mark(replaceSlashToken('/evo\tfix', 'evon:ui-ux')), '/evon:ui-ux |fix')
})

test('QA slashHead: tab separator and only one newline eaten (E13)', () => {
  assert.deepEqual(slashHead('/plan\tfix bug'), { name: 'plan', rest: 'fix bug' })
  assert.deepEqual(slashHead('/plan\n\nbody'), { name: 'plan', rest: '\nbody' })
  assert.deepEqual(slashHead('/Plan fix'), { name: 'Plan', rest: 'fix' }) // caller lowercases
})

test('QA mentionTokenAt: caret 0 / caret right before `@` has no token', () => {
  assert.equal(mentionAt('|@fo'), null)
  assert.equal(mentionAt('xem |@fo'), null)
})

test('QA mentionTokenAt: `@` after a tab triggers; `@` glued to punctuation does not', () => {
  assert.equal(mentionAt('xem\t@fo|').query, 'fo')
  assert.equal(mentionAt('(@fo|'), null)
  assert.equal(mentionAt('/cmd@fo|'), null)
})

test('QA mentionTokenAt: span stops at newline / space after the caret', () => {
  const marked = '@fo|o\nbar'
  const { draft } = at(marked)
  const token = mentionAt(marked)
  assert.equal(draft.slice(token.start, token.end), '@foo')
})

test('QA mentionTokenAt: `@` inside an existing completed path is found from its own `@`', () => {
  // Con trỏ trong một mention cũ (AC-D12 khi menu ĐANG mở): token = cả mention đó.
  const marked = 'Xem @src/a|.ts rồi'
  const { draft } = at(marked)
  const token = mentionAt(marked)
  assert.equal(token.query, 'src/a')
  assert.equal(draft.slice(token.start, token.end), '@src/a.ts')
})

test('QA replaceMention: AC-B20 flow — mention after a command keeps the command head', () => {
  assert.equal(
    pickMention('/evon:ui-ux review @sr| tiếp', 'src/a.ts'),
    '/evon:ui-ux review @src/a.ts |tiếp',
  )
})

test('QA replaceMention: two spaces after the token — only the first is reused', () => {
  assert.equal(pickMention('@fo|  x', 'foo.ts'), '@foo.ts | x') // text '@foo.ts  x' — không thêm space thứ ba
})

test('QA replaceMention: CRLF after the token gets a space, CRLF untouched', () => {
  assert.equal(pickMention('@fo|\r\nx', 'foo.ts'), '@foo.ts |\r\nx')
})

test('QA removeMention: token at the very start + tab after', () => {
  const { draft, caret } = at('@pa|\tx')
  assert.equal(mark(removeMention(draft, mentionTokenAt(draft, caret))), '|x')
})

test('QA removeMention: caret mid-token removes the whole token', () => {
  const { draft, caret } = at('Tóm @p|age giúp')
  assert.equal(mark(removeMention(draft, mentionTokenAt(draft, caret))), 'Tóm |giúp')
})

// Composer truyền `el.selectionStart` (theo `el.value`) cùng `draft` của v-model. Trong
// lúc IME đang soạn, vModelText KHÔNG cập nhật draft (cờ `composing`) nhưng `@input` và
// `selectionchange` vẫn chạy ⇒ caret có thể VƯỢT draft.length. Token trả về khi đó phải
// vẫn neo đúng ký tự `@` (hoặc null), nếu không replaceMention sinh `@@…`.
// Ca IME (v-model chưa ghi `draft` khi đang soạn) KHÔNG test ở đây: util yêu cầu
// `caret ≤ draft.length` trên CÙNG một chuỗi. Composer bảo đảm điều đó bằng cách đọc
// value thật của textarea (`caretSource()` trong SessionComposer.vue).
test('QA mentionTokenAt: live textarea value during IME composition anchors on `@`', () => {
  const live = 'Xem @ti' // value thật của textarea khi đang soạn "ti"
  const token = mentionTokenAt(live, 7)
  assert.deepEqual(token, { start: 4, end: 7, query: 'ti' })
  assert.equal(replaceMention(live, token, 'tiny.ts').text, 'Xem @tiny.ts ')
})
