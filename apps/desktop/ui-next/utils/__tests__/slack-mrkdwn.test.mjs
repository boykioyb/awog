// Bài kiểm cho utils/slack-mrkdwn.ts (docs/features/slack-threads.md). JS thuần `.mjs`
// vì lý do ghi ở composer-trigger.test.mjs. Chạy: `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  draftToMrkdwn,
  mrkdwnToDraft,
  mrkdwnToPlain,
  parseInline,
  parseMrkdwn,
  uniqueMentionLabel,
} from '../slack-mrkdwn.ts'

const names = { U0123ABC: 'Tanaka', U0999XYZ: 'Hoa Tran' }
const userName = (id) => names[id] ?? null

test('mention user có và không có nhãn', () => {
  assert.deepEqual(parseInline('hi <@U0123ABC> and <@U0999XYZ|hoa>'), [
    { t: 'text', v: 'hi ' },
    { t: 'user', id: 'U0123ABC', label: null },
    { t: 'text', v: ' and ' },
    { t: 'user', id: 'U0999XYZ', label: 'hoa' },
  ])
})

test('kênh, broadcast, usergroup, date fallback', () => {
  assert.deepEqual(parseInline('<#C0123ABC|general> <!here> <!channel>'), [
    { t: 'channel', id: 'C0123ABC', label: 'general' },
    { t: 'text', v: ' ' },
    { t: 'broadcast', name: 'here' },
    { t: 'text', v: ' ' },
    { t: 'broadcast', name: 'channel' },
  ])
  assert.deepEqual(parseInline('<!subteam^S0123|@devs> <!date^1392734382^{date}|Feb 18>'), [
    { t: 'group', label: '@devs' },
    { t: 'text', v: ' ' },
    { t: 'text', v: 'Feb 18' },
  ])
})

test('link có nhãn, link trơn, URL không an toàn giữ nguyên text', () => {
  assert.deepEqual(parseInline('<https://a.com/x?a=1&amp;b=2|docs> <https://b.com>'), [
    { t: 'link', url: 'https://a.com/x?a=1&b=2', label: 'docs' },
    { t: 'text', v: ' ' },
    { t: 'link', url: 'https://b.com', label: null },
  ])
  assert.deepEqual(parseInline('<javascript:alert(1)|x>'), [
    { t: 'text', v: '<javascript:alert(1)|x>' },
  ])
})

test('bold / italic / strike lồng nhau', () => {
  assert.deepEqual(parseInline('*bold _it_* ~gone~'), [
    {
      t: 'bold',
      c: [
        { t: 'text', v: 'bold ' },
        { t: 'italic', c: [{ t: 'text', v: 'it' }] },
      ],
    },
    { t: 'text', v: ' ' },
    { t: 'strike', c: [{ t: 'text', v: 'gone' }] },
  ])
})

test('snake_case và a*b*c không thành định dạng; tiếng Nhật không cần khoảng trắng', () => {
  assert.deepEqual(parseInline('foo_bar_baz'), [{ t: 'text', v: 'foo_bar_baz' }])
  assert.deepEqual(parseInline('2*3*4'), [{ t: 'text', v: '2*3*4' }])
  assert.deepEqual(parseInline('これは*太字*です'), [
    { t: 'text', v: 'これは' },
    { t: 'bold', c: [{ t: 'text', v: '太字' }] },
    { t: 'text', v: 'です' },
  ])
  assert.deepEqual(parseInline('* not bold *'), [{ t: 'text', v: '* not bold *' }])
})

test('inline code không parse bên trong, giải mã entity', () => {
  assert.deepEqual(parseInline('run `a *b* &lt;c&gt;` now'), [
    { t: 'text', v: 'run ' },
    { t: 'code', v: 'a *b* <c>' },
    { t: 'text', v: ' now' },
  ])
})

test('emoji, skin tone, và giờ 10:30:45 không thành emoji', () => {
  assert.deepEqual(parseInline(':+1::skin-tone-3: :tada:'), [
    { t: 'emoji', name: '+1', skin: 3 },
    { t: 'text', v: ' ' },
    { t: 'emoji', name: 'tada', skin: null },
  ])
  assert.deepEqual(parseInline('at 10:30:45'), [{ t: 'text', v: 'at 10:30:45' }])
  assert.deepEqual(parseInline('了解 :了解:'), [
    { t: 'text', v: '了解 ' },
    { t: 'emoji', name: '了解', skin: null },
  ])
})

test('entity được giải mã ở lá text', () => {
  assert.deepEqual(parseInline('a &lt; b &amp;&amp; c &gt; d'), [
    { t: 'text', v: 'a < b && c > d' },
  ])
})

test('khối code ``` và trích dẫn', () => {
  const blocks = parseMrkdwn(
    'intro\n```\nconst a = 1 &lt; 2\n```\n&gt; quoted *x*\n&gt; line2\nafter',
  )
  assert.deepEqual(blocks, [
    { t: 'para', c: [{ t: 'text', v: 'intro' }] },
    { t: 'pre', v: 'const a = 1 < 2' },
    {
      t: 'quote',
      c: [
        { t: 'text', v: 'quoted ' },
        { t: 'bold', c: [{ t: 'text', v: 'x' }] },
        { t: 'br' },
        { t: 'text', v: 'line2' },
      ],
    },
    { t: 'para', c: [{ t: 'text', v: 'after' }] },
  ])
})

test('&gt;&gt;&gt; trích dẫn toàn bộ phần còn lại', () => {
  assert.deepEqual(parseMrkdwn('a\n&gt;&gt;&gt; b\nc'), [
    { t: 'para', c: [{ t: 'text', v: 'a' }] },
    { t: 'quote', c: [{ t: 'text', v: 'b' }, { t: 'br' }, { t: 'text', v: 'c' }] },
  ])
})

test('draftToMrkdwn: mention → <@U…>, ký tự đặc biệt mã hoá', () => {
  const out = draftToMrkdwn('@Hoa Tran & @Tanaka: a<b', [
    { label: 'Tanaka', id: 'U0123ABC' },
    { label: 'Hoa Tran', id: 'U0999XYZ' },
  ])
  assert.equal(out, '<@U0999XYZ> &amp; <@U0123ABC>: a&lt;b')
})

test('mrkdwnToDraft khứ hồi với draftToMrkdwn', () => {
  const src = '<@U0123ABC> see <https://x.com|doc> &lt;ok&gt;'
  const { draft, mentions, tokens } = mrkdwnToDraft(src, userName, () => null, 'all')
  assert.equal(draft, '@Tanaka see <https://x.com|doc> <ok>')
  assert.deepEqual(mentions, [{ label: 'Tanaka', id: 'U0123ABC' }])
  assert.deepEqual(tokens, ['<https://x.com|doc>'])
  assert.equal(draftToMrkdwn(draft, mentions, tokens), src)
  assert.equal(mrkdwnToPlain('<#C0123ABC|dev> <!here>', userName), '#dev @here')
  assert.equal(mrkdwnToPlain(src, userName), '@Tanaka see doc (https://x.com) <ok>')
  assert.equal(draftToMrkdwn('@Tanaka hi', mentions), '<@U0123ABC> hi')
})

test('sửa tin giữ nguyên kênh, link, broadcast, date — không hỏng khi lưu', () => {
  const src =
    'cc <#C0123ABC|general> <!here> <https://a.com/x?a=1&amp;b=2|docs> ' +
    '<!date^1392734382^{date}|Feb 18> <@U0123ABC> a &amp; b'
  const d = mrkdwnToDraft(src, userName, () => null, 'all')
  assert.equal(
    d.draft,
    'cc <#C0123ABC|general> <!here> <https://a.com/x?a=1&amp;b=2|docs> ' +
      '<!date^1392734382^{date}|Feb 18> @Tanaka a & b',
  )
  assert.equal(draftToMrkdwn(d.draft, d.mentions, d.tokens), src)
  // Người dùng sửa thêm chữ quanh token: token vẫn đi nguyên, chữ mới được mã hoá.
  const edited = d.draft.replace('cc ', 'cc <b> ')
  assert.equal(draftToMrkdwn(edited, d.mentions, d.tokens), src.replace('cc ', 'cc &lt;b&gt; '))
})

test('token người dùng tự gõ (không có trong tin gốc) vẫn là chữ thường', () => {
  assert.equal(draftToMrkdwn('ping <!channel>', []), 'ping &lt;!channel&gt;')
  // Token bị sửa dở (không còn khớp đúng) cũng thành chữ thường, không thành cú pháp lạ.
  assert.equal(
    draftToMrkdwn('<#C0123ABC|gen>', [], ['<#C0123ABC|general>']),
    '&lt;#C0123ABC|gen&gt;',
  )
})

test('nháp agent: chỉ giữ mention user, broadcast/link/kênh/usergroup thành chữ', () => {
  const src =
    '<@U0123ABC> <!channel> <!here> <!everyone> <!subteam^S0123|@devs> ' +
    '<https://evil.example/x|tài liệu> <#C0123ABC|general> a &lt;b'
  const d = mrkdwnToDraft(src, userName)
  assert.equal(
    d.draft,
    '@Tanaka @channel @here @everyone @devs tài liệu (https://evil.example/x) #general a <b',
  )
  assert.deepEqual(d.tokens, [])
  const out = draftToMrkdwn(d.draft, d.mentions, d.tokens)
  assert.equal(
    out,
    '<@U0123ABC> @channel @here @everyone @devs tài liệu (https://evil.example/x) #general a &lt;b',
  )
  // Không còn cú pháp điều khiển nào ngoài mention user.
  assert.deepEqual(
    [...out.matchAll(/<([^<>]+)>/g)].map((m) => m[1]),
    ['@U0123ABC'],
  )
})

test('bản dịch: chỉ khôi phục token có trong bản nháp gốc', () => {
  const kept = ['<https://a.com|docs>']
  const d = mrkdwnToDraft(
    'xem <https://a.com|docs> và <https://b.com|lừa> <!channel>',
    userName,
    () => null,
    kept,
  )
  assert.equal(d.draft, 'xem <https://a.com|docs> và lừa (https://b.com) @channel')
  assert.deepEqual(d.tokens, kept)
  assert.equal(
    draftToMrkdwn(d.draft, d.mentions, d.tokens),
    'xem <https://a.com|docs> và lừa (https://b.com) @channel',
  )
})

test('hai người trùng tên hiển thị → nhãn phân biệt, khứ hồi đúng id', () => {
  const display = { U1AAA: 'Tanaka', U2BBB: 'Tanaka', U3CCC: 'Tanaka' }
  const real = { U1AAA: 'Tanaka Ichiro', U2BBB: 'Tanaka Jiro' }
  const src = '<@U1AAA> và <@U2BBB> và <@U3CCC> và <@U1AAA>'
  const d = mrkdwnToDraft(
    src,
    (id) => display[id] ?? null,
    (id) => real[id] ?? null,
  )
  assert.equal(d.draft, '@Tanaka và @Tanaka (Tanaka Jiro) và @Tanaka (U3CCC) và @Tanaka')
  assert.deepEqual(d.mentions, [
    { label: 'Tanaka', id: 'U1AAA' },
    { label: 'Tanaka (Tanaka Jiro)', id: 'U2BBB' },
    { label: 'Tanaka (U3CCC)', id: 'U3CCC' },
  ])
  assert.equal(draftToMrkdwn(d.draft, d.mentions, d.tokens), src)
})

test('uniqueMentionLabel: cùng id giữ nhãn, khác id thì thêm tên thật', () => {
  const taken = [{ label: 'Hoa', id: 'U1' }]
  assert.equal(uniqueMentionLabel('Hoa', 'Tran Hoa', 'U1', taken), 'Hoa')
  assert.equal(uniqueMentionLabel('Hoa', 'Le Hoa', 'U2', taken), 'Hoa (Le Hoa)')
  assert.equal(uniqueMentionLabel('Hoa', null, 'U2', taken), 'Hoa (U2)')
})
