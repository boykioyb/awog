// Bài kiểm cho utils/capture-scan.ts + composables/useCaptureScanner.ts.
// Chạy: `pnpm test:unit` (node --test đọc .ts nhờ type-stripping). Replay giả
// hoàn toàn — không request mạng nào được gửi.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SCAN_LIMITS, analyzeProbe, buildScanReportMd, planProbes } from '../capture-scan.ts'
import { useCaptureScanner } from '../../composables/useCaptureScanner.ts'

// ---------- Fixture helpers ----------

const body = (t) => ({ text: t, base64: false, truncated: false, size: t.length })

const entry = (over = {}) => ({
  id: 'e1',
  seq: 1,
  tabId: 'tab1',
  startedAt: 0,
  method: 'GET',
  url: 'https://shop.test/products?cat=1&q=shirt',
  host: 'shop.test',
  path: '/products',
  scheme: 'https',
  resourceType: 'xhr',
  status: 200,
  statusText: 'OK',
  mimeType: 'text/html',
  state: 'done',
  encodedBytes: null,
  durationMs: 40,
  fromCache: false,
  fromServiceWorker: false,
  isNavigation: false,
  hasRequestBody: false,
  hasResponseBody: true,
  requestHeaders: [
    ['cookie', 'sid=abc; theme=dark'],
    ['accept', 'text/html'],
  ],
  responseHeaders: [],
  ...over,
})

/** ReplayResult ok — headers/body/timeMs tuỳ ý. */
const okRes = (over = {}) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: [['content-type', 'text/html']],
  body: body('<html>ok</html>'),
  timeMs: 100,
  url: 'https://shop.test/products',
  ...over,
})

const errRes = (error = 'net::ERR_CONNECTION_REFUSED') => ({ ok: false, error })

const probesOf = (probes, scenarioId) => probes.filter((p) => p.scenarioId === scenarioId)
const probe = (probes, scenarioId, param) =>
  probesOf(probes, scenarioId).find((p) => p.param === param)

/** ScanProbe giả gọn: request.url là đủ cho finding.url. */
const fakeProbe = (scenarioId, payload = "'", param = 'q', over = {}) => ({
  scenarioId,
  entryId: 'e1',
  request: {
    method: 'GET',
    url: 'https://shop.test/products',
    headers: [],
    followRedirects: false,
  },
  param,
  location: 'query',
  payload,
  ...over,
})

// ---------- planProbes ----------

test('planProbes: baseline đầu tiên, không mutate, followRedirects:false, strip header transport', () => {
  const e = entry()
  const probes = planProbes([e])
  const base = probes[0]
  assert.equal(base.baseline, true)
  assert.equal(base.scenarioId, 'baseline')
  assert.equal(base.request.method, 'GET')
  assert.equal(base.request.url, e.url)
  assert.equal(base.request.followRedirects, false)
  // cookie/auth giữ lại; pseudo + transport header bị bỏ
  const names = base.request.headers.map(([n]) => n.toLowerCase())
  assert.ok(names.includes('cookie'))
  const e2 = entry({
    requestHeaders: [
      ['host', 'shop.test'],
      ['cookie', 'sid=abc'],
    ],
  })
  const base2 = planProbes([e2])[0]
  assert.deepEqual(
    base2.request.headers.map(([n]) => n),
    ['cookie'],
  )
})

test('planProbes: mutation query thay đúng một param, giữ param khác', () => {
  const probes = planProbes([entry()], { scenarioIds: ['sqli-error'] })
  const p = probe(probes, 'sqli-error', 'q')
  assert.ok(p)
  assert.equal(p.location, 'query')
  const u = new URL(p.request.url)
  assert.equal(u.searchParams.get('cat'), '1')
  assert.ok(p.payload === "'" || p.payload === '"')
  assert.equal(u.searchParams.get('q'), p.payload)
})

test('planProbes: raw payload giữ nguyên percent-encoding (crlf)', () => {
  const probes = planProbes([entry()], { scenarioIds: ['crlf'] })
  const p = probe(probes, 'crlf', 'q')
  assert.ok(
    p.request.url.includes('q=%0d%0aX-Awog-Scan:injected') ||
      p.request.url.includes('q=%0d%0a%0d%0aaw0gcrlf'),
  )
})

test('planProbes: mutate form-urlencoded body và JSON body', () => {
  const form = entry({
    method: 'POST',
    url: 'https://shop.test/login',
    requestHeaders: [['content-type', 'application/x-www-form-urlencoded']],
    requestBody: body('user=kyro&pass=1234'),
    hasRequestBody: true,
  })
  const pf = probe(planProbes([form], { scenarioIds: ['sqli-error'] }), 'sqli-error', 'user')
  assert.ok(pf)
  assert.equal(pf.location, 'body')
  assert.equal(new URLSearchParams(pf.request.body).get('user'), pf.payload)
  assert.equal(new URLSearchParams(pf.request.body).get('pass'), '1234')

  const js = entry({
    method: 'POST',
    url: 'https://shop.test/api',
    requestHeaders: [['content-type', 'application/json']],
    requestBody: body('{"id":1,"note":"x"}'),
    hasRequestBody: true,
  })
  const pj = probe(planProbes([js], { scenarioIds: ['sqli-error'] }), 'sqli-error', 'id')
  assert.ok(pj)
  assert.equal(JSON.parse(pj.request.body).id, pj.payload)
  assert.equal(JSON.parse(pj.request.body).note, 'x')
})

test('planProbes: cookie param mutate trong Cookie header', () => {
  const probes = planProbes([entry()], { scenarioIds: ['sqli-error'] })
  const p = probe(probes, 'sqli-error', 'theme')
  assert.ok(p)
  assert.equal(p.location, 'cookie')
  const ck = p.request.headers.find(([n]) => n.toLowerCase() === 'cookie')
  assert.ok(ck[1].includes(`theme=${p.payload}`))
  assert.ok(ck[1].includes('sid=abc'))
})

test('planProbes: lfi mutate path segment cuối khi trông như file', () => {
  const e = entry({ url: 'https://shop.test/files/report.pdf', path: '/files/report.pdf' })
  const probes = planProbes([e], { scenarioIds: ['lfi'] })
  const p = probesOf(probes, 'lfi').find((x) => x.location === 'path')
  assert.ok(p)
  assert.equal(p.param, 'report.pdf')
  assert.match(p.request.url, /^https:\/\/shop\.test\/files\//)
  assert.ok(!p.request.url.includes('report.pdf'))
})

test('planProbes: open-redirect chỉ nhắm param tên redirect-like; cors = header probe', () => {
  const e = entry({ url: 'https://shop.test/go?next=/home&cat=1' })
  const probes = planProbes([e], { scenarioIds: ['open-redirect', 'cors-reflect'] })
  const red = probesOf(probes, 'open-redirect')
  assert.ok(red.length > 0)
  assert.ok(red.every((p) => p.param === 'next'))
  const cors = probesOf(probes, 'cors-reflect')
  assert.equal(cors.length, 1)
  assert.equal(cors[0].location, 'header')
  assert.deepEqual(
    cors[0].request.headers.filter(([n]) => n.toLowerCase() === 'origin'),
    [['Origin', 'https://awog-evil.invalid']],
  )
})

test('planProbes: xxe chỉ khi body XML — replaceBody', () => {
  const json = entry({ requestBody: body('{"a":1}'), hasRequestBody: true, method: 'POST' })
  assert.equal(probesOf(planProbes([json], { scenarioIds: ['xxe'] }), 'xxe').length, 0)
  const xml = entry({
    method: 'POST',
    url: 'https://shop.test/xml',
    requestHeaders: [['content-type', 'application/xml']],
    requestBody: body('<?xml version="1.0"?><r>hi</r>'),
    hasRequestBody: true,
  })
  const p = probesOf(planProbes([xml], { scenarioIds: ['xxe'] }), 'xxe')[0]
  assert.ok(p)
  assert.match(p.request.body, /<!DOCTYPE/)
})

test('planProbes: dedupe hai entry giống hệt; entry khác URL vẫn probe', () => {
  const a = entry({ id: 'a' })
  const b = entry({ id: 'b' }) // cùng sig với a
  const c = entry({ id: 'c', url: 'https://shop.test/other?x=1' })
  const probes = planProbes([a, b, c])
  assert.equal(probes.filter((p) => p.baseline).length, 2)
  assert.equal(probes.filter((p) => p.entryId === 'b').length, 0)
  assert.ok(probes.some((p) => p.entryId === 'c'))
})

test('planProbes: scenarioIds filter + trần tổng', () => {
  const only = planProbes([entry()], { scenarioIds: ['crlf'] })
  assert.deepEqual([...new Set(only.map((p) => p.scenarioId))].sort(), ['baseline', 'crlf'])

  const many = Array.from({ length: 40 }, (_, i) =>
    entry({ id: `e${i}`, url: `https://h${i}.test/p?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9&j=10` }),
  )
  const all = planProbes(many)
  assert.ok(all.length <= SCAN_LIMITS.totalProbes)
  // Mỗi entry tối đa probesPerEntry mutation + 1 baseline
  const perEntry = new Map()
  for (const p of all) if (!p.baseline) perEntry.set(p.entryId, (perEntry.get(p.entryId) ?? 0) + 1)
  for (const [, n] of perEntry) assert.ok(n <= SCAN_LIMITS.probesPerEntry)
})

test('planProbes: entry không scannable (ws/data/CONNECT) bị bỏ', () => {
  const ws = entry({ url: 'ws://shop.test/socket', scheme: 'ws' })
  const conn = entry({ method: 'CONNECT' })
  const probes = planProbes([ws, conn])
  assert.equal(probes.length, 0)
})

// ---------- analyzeProbe ----------

const base = okRes({ timeMs: 120, body: body('<html>normal page</html>') })

test('analyzeProbe: baseline probe và result lỗi → null', () => {
  const bp = fakeProbe('baseline', '', '', { baseline: true })
  assert.equal(analyzeProbe(bp, null, okRes()), null)
  assert.equal(analyzeProbe(fakeProbe('sqli-error'), base, errRes()), null)
})

test('analyzeProbe sqli-error: SQLSTATE/ORA/mysql → high; baseline cũng lỗi → low; sạch → null', () => {
  const p = fakeProbe('sqli-error')
  const f = analyzeProbe(
    p,
    base,
    okRes({ body: body('Error: SQLSTATE[42000] syntax error near ...') }),
  )
  assert.equal(f.severity, 'high')
  assert.equal(f.owasp, 'A03')
  assert.equal(f.entryId, 'e1')
  assert.match(f.evidence, /SQLSTATE/)
  assert.equal(f.id, 'sqli-error:e1:q')

  const f2 = analyzeProbe(
    p,
    base,
    okRes({ body: body('ORA-01756: quoted string not properly terminated') }),
  )
  assert.equal(f2.severity, 'high')

  const baseErr = okRes({ body: body('SQLSTATE[08006] connection failure') })
  const f3 = analyzeProbe(p, baseErr, okRes({ body: body('SQLSTATE[42000]') }))
  assert.equal(f3.severity, 'low')

  assert.equal(analyzeProbe(p, base, okRes()), null)
})

test('analyzeProbe sqli-time: ≥2.5s → high, 1.5–2.5s → low, <1.5s → null', () => {
  const p = fakeProbe('sqli-time', `' OR SLEEP(3)-- -`)
  const f = analyzeProbe(p, base, okRes({ timeMs: base.timeMs + 3100 }))
  assert.equal(f.severity, 'high')
  assert.equal(f.deltaMs, 3100)
  assert.equal(f.baselineMs, 120)
  const f2 = analyzeProbe(p, base, okRes({ timeMs: base.timeMs + 1800 }))
  assert.equal(f2.severity, 'low')
  assert.equal(analyzeProbe(p, base, okRes({ timeMs: base.timeMs + 900 })), null)
  // Không baseline → không kết luận
  assert.equal(analyzeProbe(p, errRes(), okRes({ timeMs: 9999 })), null)
})

test('analyzeProbe xss-reflected: breaker verbatim → high; canary trần → info; escaped → null', () => {
  const tok = 'aw0gtest'
  const breaker = fakeProbe('xss-reflected', `"><${tok}`)
  const f = analyzeProbe(
    breaker,
    base,
    okRes({ body: body(`<div><input value=""><${tok}"></div>`) }),
  )
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /reflected:/)

  const plain = fakeProbe('xss-reflected', tok)
  const f2 = analyzeProbe(plain, base, okRes({ body: body(`<p>${tok}</p>`) }))
  assert.equal(f2.severity, 'info')

  // " và > bị escape → breaker không còn verbatim
  const f3 = analyzeProbe(breaker, base, okRes({ body: body(`&quot;&gt;&lt;${tok}`) }))
  assert.equal(f3, null)
})

test('analyzeProbe ssti: 7777777 mới → high; 49 mới → medium; baseline đã có → null', () => {
  const p = fakeProbe('ssti', `{{7*'7'}}`)
  const f = analyzeProbe(p, base, okRes({ body: body('result: 7777777') }))
  assert.equal(f.severity, 'high')
  const p49 = fakeProbe('ssti', '${7*7}')
  const f2 = analyzeProbe(p49, base, okRes({ body: body('age 49 years') }))
  assert.equal(f2.severity, 'medium')
  const base49 = okRes({ body: body('age 49 years') })
  assert.equal(analyzeProbe(p49, base49, okRes({ body: body('age 49 years') })), null)
  assert.equal(analyzeProbe(p, base, okRes()), null)
})

test('analyzeProbe lfi: passwd/win.ini marker → high; baseline có sẵn → null; sạch → null', () => {
  const p = fakeProbe('lfi', '../../../../etc/passwd', 'file')
  const f = analyzeProbe(
    p,
    base,
    okRes({ body: body('root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:') }),
  )
  assert.equal(f.severity, 'high')
  assert.equal(f.owasp, 'A01')
  const f2 = analyzeProbe(p, base, okRes({ body: body('[fonts]\nArial=x') }))
  assert.equal(f2.severity, 'high')
  const b = okRes({ body: body('root:x:0:0:') })
  assert.equal(analyzeProbe(p, b, okRes({ body: body('root:x:0:0:') })), null)
  assert.equal(analyzeProbe(p, base, okRes()), null)
})

test('analyzeProbe open-redirect: Location chứa host đích → medium; khác → null', () => {
  const p = fakeProbe('open-redirect', 'https://awog-scan.invalid/', 'next')
  const f = analyzeProbe(
    p,
    base,
    okRes({ status: 302, headers: [['location', 'https://awog-scan.invalid/']] }),
  )
  assert.equal(f.severity, 'medium')
  assert.match(f.evidence, /^Location:/)
  assert.equal(
    analyzeProbe(
      p,
      base,
      okRes({ status: 302, headers: [['location', 'https://shop.test/home']] }),
    ),
    null,
  )
  assert.equal(analyzeProbe(p, base, okRes()), null)
})

test('analyzeProbe cmdi: uid=…gid=… → high; baseline có sẵn → null', () => {
  const p = fakeProbe('cmdi', ';id')
  const f = analyzeProbe(
    p,
    base,
    okRes({ body: body('uid=33(www-data) gid=33(www-data) groups=33') }),
  )
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /uid=33/)
  const b = okRes({ body: body('uid=33(www-data) gid=33(www-data)') })
  assert.equal(analyzeProbe(p, b, okRes({ body: body('uid=33(www-data) gid=33(www-data)') })), null)
  assert.equal(analyzeProbe(p, base, okRes({ body: body('no uid here') })), null)
})

test('analyzeProbe crlf: header X-Awog-Scan → high; marker vào body → low', () => {
  const p = fakeProbe('crlf', '%0d%0aX-Awog-Scan:injected')
  const f = analyzeProbe(p, base, okRes({ headers: [['x-awog-scan', 'injected']] }))
  assert.equal(f.severity, 'high')
  assert.match(f.evidence, /X-Awog-Scan/)
  const p2 = fakeProbe('crlf', '%0d%0a%0d%0aaw0gcrlf')
  const f2 = analyzeProbe(p2, base, okRes({ body: body('prefix\n\naw0gcrlf') }))
  assert.equal(f2.severity, 'low')
  assert.equal(analyzeProbe(p2, base, okRes()), null)
})

test('analyzeProbe xxe: passwd marker → high; entity error → low; sạch → null', () => {
  const p = fakeProbe('xxe', '<?xml ...><!DOCTYPE r [...]>', '', { location: 'body' })
  const f = analyzeProbe(p, base, okRes({ body: body('root:x:0:0:bin:/:/') }))
  assert.equal(f.severity, 'high')
  const f2 = analyzeProbe(
    p,
    base,
    okRes({ body: body('libxml error: failed to load external entity') }),
  )
  assert.equal(f2.severity, 'low')
  assert.equal(analyzeProbe(p, base, okRes()), null)
})

test('analyzeProbe cors-reflect: echo origin+creds → high; echo → medium; * → low; none → null', () => {
  const p = fakeProbe('cors-reflect', 'https://awog-evil.invalid', 'Origin', { location: 'header' })
  const f = analyzeProbe(
    p,
    base,
    okRes({
      headers: [
        ['access-control-allow-origin', 'https://awog-evil.invalid'],
        ['access-control-allow-credentials', 'true'],
      ],
    }),
  )
  assert.equal(f.severity, 'high')
  const f2 = analyzeProbe(
    p,
    base,
    okRes({ headers: [['access-control-allow-origin', 'https://awog-evil.invalid']] }),
  )
  assert.equal(f2.severity, 'medium')
  const f3 = analyzeProbe(p, base, okRes({ headers: [['access-control-allow-origin', '*']] }))
  assert.equal(f3.severity, 'low')
  assert.equal(analyzeProbe(p, base, okRes()), null)
})

// ---------- useCaptureScanner (replay giả) ----------

test('run: quét end-to-end — baseline + mutation, finding từ response giả', async () => {
  const sc = useCaptureScanner()
  const e = entry({ url: 'https://shop.test/search?q=shirt' })
  const api = {
    calls: [],
    async replay(_tabId, req) {
      this.calls.push(req)
      const q = new URL(req.url).searchParams.get('q')
      if (q === "'") return okRes({ body: body('SQLSTATE[42000] syntax error') })
      if (q?.includes('SLEEP(3)')) return okRes({ timeMs: 3400 })
      return okRes({ timeMs: 90 })
    },
  }
  const rep = await sc.run([e], api)
  assert.equal(sc.running.value, false)
  assert.equal(sc.progress.value.done, sc.progress.value.total)
  assert.ok(rep.probes > 1)
  assert.deepEqual(rep.hosts, ['shop.test'])
  const sqli = rep.findings.find((f) => f.scenarioId === 'sqli-error')
  assert.ok(sqli)
  assert.equal(sqli.severity, 'high')
  const time = rep.findings.find((f) => f.scenarioId === 'sqli-time')
  assert.ok(time)
  assert.equal(time.severity, 'high')
  assert.ok(time.deltaMs >= 2500)
})

test('run: baseline lỗi → mutation của entry đó bị bỏ, lỗi nằm trong errors', async () => {
  const sc = useCaptureScanner()
  const e = entry({ url: 'https://dead.test/x?a=1' })
  const api = {
    calls: 0,
    async replay() {
      this.calls++
      return errRes()
    },
  }
  const rep = await sc.run([e], api)
  // Chỉ baseline được gửi; mọi mutation bị skip
  assert.equal(api.calls, 1)
  assert.equal(rep.probes, 1)
  assert.equal(rep.findings.length, 0)
  assert.equal(rep.errors.length, 1) // baseline fail cũng là probe lỗi → 'host: error'
})

test('run: lỗi replay của mutation → vào errors dạng host: error', async () => {
  const sc = useCaptureScanner()
  const e = entry({ url: 'https://shop.test/y?p=1' })
  const api = {
    async replay(_t, req) {
      if (new URL(req.url).searchParams.get('p') !== '1') return errRes('ECONNRESET')
      return okRes()
    },
  }
  const rep = await sc.run([e], api)
  assert.ok(rep.errors.length > 0)
  assert.match(rep.errors[0], /^shop\.test: ECONNRESET — GET https:\/\/shop\.test\/y\?p=%27 \[sqli/)
})

test('run: stop() dừng sớm — report partial, không treo', async () => {
  const sc = useCaptureScanner()
  const e = entry({ url: 'https://shop.test/z?p=1&r=2&s=3&t=4&u=5&v=6&w=7&x=8' })
  const gates = []
  const api = {
    async replay(_t, req) {
      const p = new URL(req.url).searchParams.get('p')
      if (p === '1') return okRes() // baseline — trả ngay
      let release
      const g = new Promise((res) => (release = res))
      gates.push(() => release(okRes()))
      return g // mutation chờ cổng
    },
  }
  const done = sc.run([e], api)
  // Chờ tới khi mutation bắt đầu (gate đầu tiên được đẩy vào)
  while (gates.length === 0) await new Promise((r) => setTimeout(r, 1))
  sc.stop()
  for (const rel of gates) rel()
  const rep = await done
  assert.equal(sc.running.value, false)
  assert.ok(rep.probes < rep.probes + 1) // partial — không gửi hết probe
  assert.ok(sc.progress.value.done <= sc.progress.value.total)
})

test('run: opts.scenarioIds + opts.hosts lọc đúng; forward scope vào replay', async () => {
  const sc = useCaptureScanner()
  const a = entry({ id: 'a', host: 'a.test', url: 'https://a.test/?x=1' })
  const b = entry({ id: 'b', host: 'b.test', url: 'https://b.test/?y=2' })
  const scopes = []
  const api = {
    async replay(_t, _r, scope) {
      scopes.push(scope)
      return okRes()
    },
  }
  const rep = await sc.run([a, b], api, {
    scenarioIds: ['crlf'],
    hosts: ['a.test'],
    scope: 'sess1',
  })
  assert.deepEqual(rep.hosts, ['a.test'])
  assert.ok(scopes.length > 0 && scopes.every((s) => s === 'sess1'))
})

test('buildScanReportMd: findings nhóm theo severity + bảng probe đủ cột', () => {
  const report = {
    scannedAt: 1700000000000,
    hosts: ['a.test'],
    probes: 3,
    blocked: false,
    errors: ['net::ERR x2'],
    findings: [
      {
        id: 'sqli-error:a:q',
        scenarioId: 'sqli-error',
        owasp: 'A03',
        severity: 'high',
        url: 'https://a.test/?x=1',
        param: 'x',
        location: 'query',
        payload: "'",
        evidence: 'SQL syntax error',
        entryId: 'a',
        baselineMs: 30,
        deltaMs: 120,
      },
    ],
    details: [
      {
        id: 'p1',
        scenarioId: 'sqli-error',
        entryId: 'a',
        method: 'GET',
        url: 'https://a.test/?x=1',
        param: 'x',
        location: 'query',
        payload: "'",
        request: { method: 'GET', url: 'https://a.test/?x=1', headers: [] },
        status: 500,
        timeMs: 150,
        size: 99,
        error: null,
        baseline: false,
        hit: 'high',
      },
      {
        id: 'b1',
        scenarioId: 'baseline',
        entryId: 'a',
        method: 'GET',
        url: 'https://a.test/?x=1',
        param: '',
        location: 'body',
        payload: '',
        request: { method: 'GET', url: 'https://a.test/?x=1', headers: [] },
        status: 200,
        timeMs: 30,
        size: 17,
        error: null,
        baseline: true,
      },
    ],
  }
  const md = buildScanReportMd(report, {
    scenarioName: (id) => id,
    severityName: (s) => s,
  })
  assert.ok(md.includes('## Findings'))
  assert.ok(md.includes('### high (1)'))
  assert.ok(md.includes('`x`'))
  assert.ok(md.includes("payload: `'`"))
  assert.ok(md.includes('| # | Scenario | Request |'))
  // Mỗi dòng bảng đủ 9 cột (10 dấu |).
  const row = md.split('\n').find((l) => l.startsWith('| 1 |'))
  assert.equal((row.match(/\|/g) ?? []).length, 10)
  assert.ok(md.includes('_baseline_'))
  assert.ok(md.includes('## Transport errors'))
})
