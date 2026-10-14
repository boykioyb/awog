// Bài kiểm cho utils/capture-findings.ts — mỗi rule có ca dương + ca âm. Chạy: `pnpm test:unit`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEntry, analyzeAll } from '../capture-findings.ts'

const entry = (over = {}) => ({
  id: '1',
  seq: 1,
  tabId: 't',
  startedAt: 0,
  method: 'GET',
  url: 'https://example.com/',
  host: 'example.com',
  path: '/',
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
const doc = (headers = [], over = {}) =>
  entry({
    resourceType: 'Document',
    mimeType: 'text/html',
    isNavigation: true,
    responseHeaders: headers,
    ...over,
  })
const ids = (e, ctx = {}) => analyzeEntry(e, ctx).map((f) => f.id)
const text = (t) => ({ text: t, base64: false, truncated: false, size: t.length })
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (h, p) => `${b64url(h)}.${b64url(p)}.s`

const NO_STORE = ['Cache-Control', 'no-store']
const FULL_DOC = [
  ['Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'"],
  ['Strict-Transport-Security', 'max-age=1'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
]

test('cookie: thiếu HttpOnly / Secure / SameSite', () => {
  const e = entry({ responseHeaders: [['Set-Cookie', 'a=1; Path=/'], NO_STORE] })
  assert.deepEqual(ids(e), ['cookieNoHttpOnly', 'cookieNoSecure', 'cookieNoSameSite'])
})

test('cookie: đủ cờ → không finding; Secure chỉ xét trên https', () => {
  const ok = entry({
    responseHeaders: [['Set-Cookie', 'a=1; HttpOnly; Secure; SameSite=Lax'], NO_STORE],
  })
  assert.deepEqual(ids(ok), [])
  const http = entry({
    scheme: 'http',
    url: 'http://example.com/',
    responseHeaders: [['Set-Cookie', 'a=1; HttpOnly; SameSite=Lax'], NO_STORE],
  })
  assert.deepEqual(ids(http), [])
})

test('cookie: SameSite=None không Secure = high; nhiều dòng gộp bằng \\n', () => {
  const e = entry({
    responseHeaders: [
      ['Set-Cookie', 'a=1; HttpOnly; SameSite=None\nb=2; HttpOnly; Secure; SameSite=Lax'],
    ],
  })
  const f = analyzeEntry(e, {})
  assert.ok(
    f.some(
      (x) =>
        x.id === 'cookieSameSiteNoneInsecure' && x.severity === 'high' && x.params.name === 'a',
    ),
  )
  assert.ok(!f.some((x) => x.params.name === 'b'))
})

test('tài liệu thiếu header bảo mật', () => {
  assert.deepEqual(ids(doc()), [
    'missingCsp',
    'missingHsts',
    'missingXcto',
    'missingFrameProtection',
    'missingReferrerPolicy',
  ])
  assert.deepEqual(ids(doc(FULL_DOC)), [])
})

test('tài liệu: frame-ancestors hoặc X-Frame-Options đều đủ; http không đòi HSTS; non-Document bỏ qua', () => {
  const xfo = doc([
    ...FULL_DOC.slice(0, 1).map(() => ['Content-Security-Policy', "default-src 'self'"]),
    ...FULL_DOC.slice(1),
    ['X-Frame-Options', 'DENY'],
  ])
  assert.deepEqual(ids(xfo), [])
  const http = doc(
    FULL_DOC.filter(([n]) => n !== 'Strict-Transport-Security'),
    { scheme: 'http', url: 'http://example.com/' },
  )
  assert.ok(!ids(http).includes('missingHsts'))
  assert.deepEqual(ids(entry()), [])
  assert.deepEqual(ids(doc([], { status: 302 })), [])
})

test('CORS: wildcard + credentials = high; wildcard đơn thuần = không', () => {
  const bad = entry({
    responseHeaders: [
      ['Access-Control-Allow-Origin', '*'],
      ['Access-Control-Allow-Credentials', 'true'],
    ],
  })
  const f = analyzeEntry(bad, {})
  assert.equal(f[0].id, 'corsWildcardCredentials')
  assert.equal(f[0].severity, 'high')
  assert.deepEqual(ids(entry({ responseHeaders: [['Access-Control-Allow-Origin', '*']] })), [])
})

test('CORS: phản chiếu Origin', () => {
  const mk = (creds) =>
    entry({
      requestHeaders: [['Origin', 'https://evil.test']],
      responseHeaders: [
        ['Access-Control-Allow-Origin', 'https://evil.test'],
        ...(creds ? [['Access-Control-Allow-Credentials', 'true']] : []),
      ],
    })
  assert.equal(analyzeEntry(mk(true), {})[0].severity, 'high')
  assert.equal(analyzeEntry(mk(false), {})[0].severity, 'low')
  const same = entry({
    requestHeaders: [['Origin', 'https://example.com']],
    responseHeaders: [['Access-Control-Allow-Origin', 'https://example.com']],
  })
  assert.deepEqual(ids(same), [])
})

test('mixed content', () => {
  const e = entry({
    scheme: 'http',
    url: 'http://cdn.test/a.js',
    host: 'cdn.test',
    resourceType: 'Script',
  })
  const f = analyzeEntry(e, { pageScheme: 'https' })
  assert.equal(f[0].id, 'mixedContent')
  assert.equal(f[0].severity, 'high')
  assert.equal(
    analyzeEntry({ ...e, resourceType: 'Image' }, { pageScheme: 'https' })[0].severity,
    'medium',
  )
  assert.deepEqual(ids(e, { pageScheme: 'http' }), [])
  assert.deepEqual(ids(e, {}), [])
  assert.deepEqual(
    ids(entry({ url: 'https://x.test/a.js', scheme: 'https' }), { pageScheme: 'https' }),
    [],
  )
})

test('thông tin xác thực trong URL', () => {
  const k = (u) => ids(entry({ url: u }))
  assert.deepEqual(k('https://example.com/?access_token=abc'), ['credentialsInUrl'])
  assert.deepEqual(k('https://example.com/?API_KEY=abc'), ['credentialsInUrl'])
  assert.deepEqual(k('https://example.com/?auth-token=abc'), ['credentialsInUrl'])
  assert.deepEqual(k('https://example.com/?monkey=1&keyboard=2&token='), [])
  assert.deepEqual(k('https://user:pw@example.com/'), ['userinfoInUrl'])
  assert.deepEqual(k('https://example.com/'), [])
})

test('JWT: alg none (high) và hết hạn, ở header/URL/body', () => {
  const none = jwt({ alg: 'none' }, { sub: 'a' })
  const f = analyzeEntry(entry({ requestHeaders: [['Authorization', `Bearer ${none}`]] }), {})
  assert.ok(f.some((x) => x.id === 'jwtAlgNone' && x.severity === 'high'))
  const exp = jwt({ alg: 'HS256' }, { exp: 1 })
  assert.deepEqual(ids(entry({ url: `https://example.com/?x=${exp}` })), ['jwtExpired'])
  assert.deepEqual(ids(entry({ responseBody: text(`{"t":"${exp}"}`) })), ['jwtExpired'])
  const fresh = jwt({ alg: 'HS256' }, { exp: Math.floor(Date.now() / 1000) + 999 })
  assert.deepEqual(ids(entry({ responseBody: text(fresh) })), [])
})

test('Basic auth qua http', () => {
  const h = [['Authorization', 'Basic dTpw']]
  assert.deepEqual(ids(entry({ scheme: 'http', url: 'http://example.com/', requestHeaders: h })), [
    'basicAuthOverHttp',
    'cacheNoStore',
  ])
  assert.ok(!ids(entry({ requestHeaders: h })).includes('basicAuthOverHttp'))
})

test('lộ phiên bản server', () => {
  const r = (h) => ids(entry({ responseHeaders: h }))
  assert.deepEqual(r([['Server', 'nginx/1.18.0']]), ['serverVersion'])
  assert.deepEqual(r([['Server', 'nginx']]), [])
  assert.deepEqual(r([['X-Powered-By', 'Express']]), ['poweredBy'])
  assert.deepEqual(r([['X-AspNet-Version', '4.0.30319']]), ['aspnetVersion'])
})

test('lỗi chi tiết + directory listing', () => {
  const r = (t) => ids(entry({ responseBody: text(t) }))
  for (const t of [
    'Traceback (most recent call last):\n  File',
    '\tat java.lang.Thread.run',
    'Exception in thread "main"',
    'SQLSTATE[42000]',
    'ORA-00933: bad',
  ]) {
    assert.deepEqual(r(t), ['verboseError'], t)
  }
  assert.deepEqual(r('ORA-1 normal text'), [])
  assert.deepEqual(r('<title>Index of /backup</title>'), ['directoryListing'])
  assert.deepEqual(r('<title>Home</title>'), [])
})

test('Cache-Control no-store khi đặt cookie / có Authorization', () => {
  const cookie = ['Set-Cookie', 'a=1; HttpOnly; Secure; SameSite=Lax']
  assert.deepEqual(ids(entry({ responseHeaders: [cookie] })), ['cacheNoStore'])
  assert.deepEqual(
    ids(entry({ responseHeaders: [cookie, ['Cache-Control', 'private, no-store']] })),
    [],
  )
  assert.deepEqual(ids(entry({ responseHeaders: [] })), [])
})

test('analyzeAll: dedupe theo (id, host), sắp theo mức độ, suy pageScheme từ navigation', () => {
  const a = entry({ id: 'a', seq: 1, responseHeaders: [['Server', 'x/1.0']] })
  const b = entry({ id: 'b', seq: 2, responseHeaders: [['Server', 'x/2.0']] })
  const c = entry({
    id: 'c',
    seq: 3,
    host: 'other.test',
    url: 'https://other.test/',
    responseHeaders: [['Server', 'x/1.0']],
  })
  const nav = entry({
    id: 'n',
    seq: 0,
    isNavigation: true,
    resourceType: 'Document',
    mimeType: 'text/html',
    responseHeaders: FULL_DOC,
  })
  const mixed = entry({
    id: 'm',
    seq: 4,
    scheme: 'http',
    url: 'http://m.test/a.js',
    host: 'm.test',
    resourceType: 'Script',
  })
  const out = analyzeAll([mixed, c, b, a, nav])
  assert.equal(out[0].id, 'mixedContent')
  const sv = out.filter((f) => f.id === 'serverVersion')
  assert.deepEqual(
    sv.map((f) => f.entryId),
    ['a', 'c'],
  )
})
