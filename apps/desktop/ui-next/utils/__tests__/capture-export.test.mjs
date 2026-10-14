// Bài kiểm cho utils/capture-export.ts — quoting cURL, raw HTTP, JWT, cookie, prettyBody.
// JS thuần `.mjs` như fuzzy.test.mjs. Chạy: `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toCurl,
  toFetch,
  toRawRequest,
  toRawResponse,
  parseRawRequest,
  decodeJwt,
  findJwts,
  parseCookieHeader,
  parseSetCookie,
  queryParams,
  prettyBody,
} from '../capture-export.ts'

const entry = (over = {}) => ({
  id: '1',
  seq: 1,
  tabId: 't',
  startedAt: 0,
  method: 'GET',
  url: 'https://example.com/a/b?x=1&y=2',
  host: 'example.com',
  path: '/a/b?x=1&y=2',
  scheme: 'https',
  resourceType: 'XHR',
  status: 200,
  statusText: 'OK',
  mimeType: 'application/json',
  state: 'done',
  encodedBytes: 0,
  durationMs: 1,
  fromCache: false,
  fromServiceWorker: false,
  isNavigation: false,
  hasRequestBody: false,
  hasResponseBody: false,
  requestHeaders: [],
  responseHeaders: [],
  ...over,
})
const body = (text, over = {}) => ({
  text,
  base64: false,
  truncated: false,
  size: text.length,
  ...over,
})
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (h, p) => `${b64url(h)}.${b64url(p)}.sig`

test('curl: GET đơn giản không có -X', () => {
  assert.equal(toCurl(entry()), "curl 'https://example.com/a/b?x=1&y=2'")
})

test('curl: nháy đơn, xuống dòng, unicode', () => {
  const e = entry({
    method: 'POST',
    requestBody: body("it's\nđơn 日本"),
    requestHeaders: [['X-A', "o'neil"]],
  })
  const c = toCurl(e)
  assert.ok(c.includes(`-H 'X-A: o'\\''neil'`))
  assert.ok(c.includes(`--data-raw 'it'\\''s\nđơn 日本'`))
  assert.ok(!c.includes('-X'), 'POST + body không cần -X')
})

test('curl: giữ thứ tự + header trùng, bỏ content-length, --compressed', () => {
  const e = entry({
    method: 'PUT',
    requestBody: body('a'),
    requestHeaders: [
      ['Cookie', 'a=1'],
      ['Accept-Encoding', 'gzip'],
      ['Content-Length', '1'],
      ['X-Dup', '1'],
      ['X-Dup', '2'],
    ],
  })
  const c = toCurl(e)
  assert.ok(c.includes('-X'))
  assert.ok(c.indexOf('X-Dup: 1') < c.indexOf('X-Dup: 2'))
  assert.ok(!/content-length/i.test(c))
  assert.ok(!/accept-encoding/i.test(c))
  assert.ok(c.endsWith('--compressed'))
})

test('curl: body base64 đi qua stdin', () => {
  const e = entry({ method: 'POST', requestBody: body('AAEC', { base64: true, size: 3 }) })
  const c = toCurl(e)
  assert.ok(c.startsWith("printf %s 'AAEC' | base64 -d | curl"))
  assert.ok(c.includes('--data-binary @-'))
})

test('curl cmd: escape ^ và dấu nháy kép', () => {
  const e = entry({
    method: 'POST',
    requestBody: body('a"b&c\\d'),
    requestHeaders: [['X-A', 'p|q']],
  })
  const c = toCurl(e, { shell: 'cmd' })
  assert.ok(c.startsWith('curl ^"https://example.com'))
  assert.ok(c.includes('^"X-A: p^|q^"'))
  assert.ok(c.includes('^"a\\^"b^&c\\\\d^"'))
})

test('fetch: Cookie bị bỏ, header trùng giữ trong mảng cặp, credentials include', () => {
  const e = entry({
    method: 'POST',
    requestBody: body('x'),
    requestHeaders: [
      ['Cookie', 's=1'],
      ['X-D', '1'],
      ['X-D', '2'],
    ],
  })
  const f = toFetch(e)
  assert.ok(f.includes(`[["X-D","1"],["X-D","2"]]`))
  assert.ok(!f.includes('s=1'))
  assert.ok(f.includes("credentials: 'include'"))
  assert.ok(f.includes('"method": "POST"') || f.includes('method: "POST"'))
})

test('raw request: h2 pseudo header → request line + Host', () => {
  const e = entry({
    requestHeaders: [
      [':authority', 'example.com'],
      [':method', 'GET'],
      [':path', '/z?q=1'],
      [':scheme', 'https'],
      ['accept', '*/*'],
    ],
  })
  assert.equal(toRawRequest(e), 'GET /z?q=1 HTTP/1.1\r\nHost: example.com\r\naccept: */*\r\n\r\n')
})

test('raw request: HTTP/1 giữ Host sẵn có, kèm body', () => {
  const e = entry({
    method: 'POST',
    requestHeaders: [
      ['Host', 'example.com'],
      ['A', 'b'],
    ],
    requestBody: body('hi'),
  })
  assert.equal(toRawRequest(e), 'POST /a/b?x=1&y=2 HTTP/1.1\r\nHost: example.com\r\nA: b\r\n\r\nhi')
})

test('raw response', () => {
  const e = entry({
    httpVersion: 'h2',
    responseHeaders: [
      [':status', '200'],
      ['Set-Cookie', 'a=1'],
      ['Set-Cookie', 'b=2'],
    ],
    responseBody: body('ok'),
  })
  assert.equal(toRawResponse(e), 'HTTP/2 200 OK\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\nok')
})

test('parseRawRequest: LF, thiếu Host dùng base', () => {
  const r = parseRawRequest('POST /p?x=1 HTTP/1.1\nA: b\n\nbody\nline2', {
    scheme: 'https',
    host: 'h.test',
  })
  assert.deepEqual(r, {
    method: 'POST',
    url: 'https://h.test/p?x=1',
    headers: [['A', 'b']],
    body: 'body\nline2',
  })
})

test('parseRawRequest: Host header thắng base, CRLF, absolute-form', () => {
  const a = parseRawRequest('GET /x HTTP/1.1\r\nHost: other.test:8080\r\n\r\n', {
    scheme: 'http',
    host: 'h.test',
  })
  assert.equal(a.url, 'http://other.test:8080/x')
  const b = parseRawRequest('GET https://abs.test/y HTTP/1.1\r\nHost: z\r\n\r\n', {
    scheme: 'http',
    host: 'h.test',
  })
  assert.equal(b.url, 'https://abs.test/y')
  const c = parseRawRequest('GET /only', { scheme: 'https', host: 'h.test' })
  assert.equal(c.url, 'https://h.test/only')
  assert.equal(c.body, '')
})

test('JWT: base64url + padding, expired, alg none', () => {
  const t = jwt({ alg: 'none', typ: 'JWT' }, { sub: 'ü?>>', exp: 1 })
  const d = decodeJwt(t)
  assert.equal(d.header.alg, 'none')
  assert.equal(d.payload.sub, 'ü?>>')
  assert.equal(d.expired, true)
  const fresh = decodeJwt(jwt({ alg: 'HS256' }, { exp: Math.floor(Date.now() / 1000) + 3600 }))
  assert.equal(fresh.expired, false)
  assert.equal(decodeJwt(jwt({ alg: 'HS256' }, { a: 1 })).expired, undefined)
  assert.equal(decodeJwt('a.b'), null)
  assert.equal(decodeJwt('xxx.yyy.zzz'), null)
})

test('findJwts: tìm trong văn bản, bỏ trùng và rác', () => {
  const t = jwt({ alg: 'HS256' }, { a: 1 })
  assert.deepEqual(findJwts(`Bearer ${t} and ${t}; eyJxxxxx.eyJyyyyy.zzz`), [t])
})

test('cookie parsers', () => {
  assert.deepEqual(parseCookieHeader('a=1; b=x=y;  ;c'), [
    { name: 'a', value: '1' },
    { name: 'b', value: 'x=y' },
    { name: 'c', value: '' },
  ])
  const c = parseSetCookie(
    'sid=abc; Path=/; HttpOnly; SECURE; SameSite=Lax; Max-Age=60; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Partitioned',
  )
  assert.equal(c.name, 'sid')
  assert.equal(c.attrs.httponly, true)
  assert.equal(c.attrs.secure, true)
  assert.equal(c.attrs.partitioned, true)
  assert.equal(c.attrs.samesite, 'Lax')
  assert.equal(c.attrs['max-age'], '60')
  assert.equal(c.attrs.expires, 'Wed, 21 Oct 2026 07:28:00 GMT')
})

test('queryParams', () => {
  assert.deepEqual(queryParams('https://a.test/p?x=1&y=%C3%BC&x=2'), [
    ['x', '1'],
    ['y', 'ü'],
    ['x', '2'],
  ])
  assert.deepEqual(queryParams('https://a.test/p'), [])
})

test('prettyBody: json / form / html / xml / text', () => {
  assert.deepEqual(prettyBody(body('{"a":[1]}'), 'application/json; charset=utf-8'), {
    kind: 'json',
    text: '{\n  "a": [\n    1\n  ]\n}',
  })
  assert.equal(prettyBody(body('{bad'), 'application/json').kind, 'text')
  assert.deepEqual(prettyBody(body('a=1&b=x%20y+z'), 'application/x-www-form-urlencoded'), {
    kind: 'form',
    text: 'a = 1\nb = x y z',
  })
  assert.equal(prettyBody(body('<p>x</p>'), 'text/html').kind, 'html')
  assert.equal(prettyBody(body('<svg onload=1/>'), 'image/svg+xml').kind, 'xml')
  assert.equal(prettyBody(body('<a/>'), 'application/xml').text, '<a/>')
  assert.equal(prettyBody(body('plain'), 'text/plain').kind, 'text')
})

test('prettyBody: ảnh raster → data URL, svg không bao giờ là ảnh, nhị phân → hex', () => {
  const png = prettyBody(body('iVBOR', { base64: true }), 'image/png')
  assert.deepEqual(png, { kind: 'image', text: 'data:image/png;base64,iVBOR' })
  const svg = prettyBody(
    body(Buffer.from('<svg/>').toString('base64'), { base64: true }),
    'image/svg+xml',
  )
  assert.equal(svg.kind, 'xml')
  assert.equal(svg.text, '<svg/>')
  const bin = prettyBody(body('AAEC/w==', { base64: true }), 'application/octet-stream')
  assert.equal(bin.kind, 'binary')
  assert.ok(bin.text.includes('00 01 02 ff'))
})
