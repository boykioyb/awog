// Bài kiểm cho utils/capture-owasp.ts + capture-fingerprint.ts + capture-payloads.ts.
// Chạy: `pnpm test:unit` (node --test đọc .ts nhờ type-stripping).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeAll } from '../capture-findings.ts'
import { evaluateOwasp } from '../capture-owasp.ts'
import { fingerprintTech } from '../capture-fingerprint.ts'
import {
  PAYLOAD_PRESETS,
  exploitDbUrl,
  ghsaUrl,
  nvdApiUrl,
  nvdSearchUrl,
  parseNvdJson,
} from '../capture-payloads.ts'

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
const text = (t) => ({ text: t, base64: false, truncated: false, size: t.length })
const owasp = (entries) => evaluateOwasp(entries, analyzeAll(entries))
const item = (items, id) => items.find((i) => i.id === id)

// ---------- evaluateOwasp ----------

test('evaluateOwasp: luôn trả đủ 10 mục theo thứ tự', () => {
  const items = owasp([])
  assert.equal(items.length, 10)
  assert.deepEqual(
    items.map((i) => i.id),
    ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'],
  )
})

test('evaluateOwasp: traffic sạch → passive-checkable clean, không kiểm được manual+guide', () => {
  const items = owasp([entry()])
  for (const id of ['A02', 'A05', 'A06', 'A07']) {
    assert.equal(item(items, id).status, 'clean', id)
    assert.deepEqual(item(items, id).evidence, [])
  }
  for (const id of ['A01', 'A03', 'A04', 'A08', 'A09', 'A10']) {
    const it = item(items, id)
    assert.equal(it.status, 'manual', id)
    assert.equal(it.evidence[0].entryId, '')
    assert.equal(it.evidence[0].note, `capture.sec.guide.${id}`)
  }
})

test('evaluateOwasp: doc thiếu CSP → A05 suspect với findingId', () => {
  const items = owasp([doc([['Strict-Transport-Security', 'max-age=1']])])
  const a05 = item(items, 'A05')
  assert.equal(a05.status, 'suspect')
  assert.ok(a05.evidence.some((e) => e.findingId === 'missingCsp'))
})

test('evaluateOwasp: cookie thiếu HttpOnly → A07 suspect; credential trong URL → A02', () => {
  const items = owasp([
    entry({ url: 'https://x.com/?token=abc123', responseHeaders: [['Set-Cookie', 'a=1; Path=/']] }),
  ])
  assert.equal(item(items, 'A07').status, 'suspect')
  const a02 = item(items, 'A02')
  assert.equal(a02.status, 'suspect')
  assert.ok(a02.evidence.some((e) => e.findingId === 'credentialsInUrl'))
})

test('evaluateOwasp: lỗi SQL trong body → A03 + A05 + A09; stack trace thường chỉ A05+A09', () => {
  const sql = entry({ responseBody: text('Error: SQLSTATE[42S02] Base table not found') })
  const a = owasp([sql])
  assert.equal(item(a, 'A03').status, 'suspect')
  assert.equal(item(a, 'A05').status, 'suspect')
  assert.equal(item(a, 'A09').status, 'suspect')

  const py = entry({ responseBody: text('Traceback (most recent call last): File "x.py"') })
  const b = owasp([py])
  assert.equal(item(b, 'A03').status, 'manual')
  assert.equal(item(b, 'A09').status, 'suspect')
})

test('evaluateOwasp: fingerprint có version → A06 suspect; không version → manual; không có → clean', () => {
  const versioned = entry({ responseHeaders: [['Server', 'nginx/1.18.0']] })
  const a = owasp([versioned])
  assert.equal(item(a, 'A06').status, 'suspect')
  assert.ok(item(a, 'A06').evidence[0].note.includes('nginx 1.18.0'))

  const unversioned = entry({ responseHeaders: [['Server', 'nginx']] })
  const b = owasp([unversioned])
  assert.equal(item(b, 'A06').status, 'manual')
})

test('evaluateOwasp: param chứa URL tuyệt đối → A10 suspect; script ngoài thiếu integrity → A08', () => {
  const ssrf = entry({ url: 'https://x.com/f?url=https://evil.com/x' })
  const a = owasp([ssrf])
  assert.equal(item(a, 'A10').status, 'suspect')
  assert.match(item(a, 'A10').evidence[0].note, /url → https:\/\/evil\.com/)

  const noIntegrity = doc([], {
    responseBody: text('<html><script src="https://cdn.example.com/lib.js"></script></html>'),
  })
  assert.equal(item(owasp([noIntegrity]), 'A08').status, 'suspect')

  const withIntegrity = doc([], {
    responseBody: text(
      '<html><script src="https://cdn.example.com/lib.js" integrity="sha384-x"></script></html>',
    ),
  })
  assert.equal(item(owasp([withIntegrity]), 'A08').status, 'manual')
})

test('evaluateOwasp: note evidence = finding.evidence, hoặc khoá title khi không có', () => {
  const e = entry({ url: 'https://x.com/?token=abc123' })
  const a02 = item(owasp([e]), 'A02')
  assert.equal(a02.evidence[0].note, 'token') // evidence của credentialsInUrl là tên param

  const c = doc()
  const a05 = item(owasp([c]), 'A05')
  const missing = a05.evidence.find((v) => v.findingId === 'missingCsp')
  assert.equal(missing.note, 'capture.finding.missingCsp.title')
})

// ---------- fingerprintTech ----------

test('fingerprint: Server header parse name + version, token comment bị bỏ', () => {
  const hits = fingerprintTech([
    entry({ responseHeaders: [['Server', 'nginx/1.18.0']] }),
    entry({ id: '2', responseHeaders: [['Server', 'Apache/2.4.41 (Ubuntu)']] }),
  ])
  assert.ok(hits.some((h) => h.name === 'nginx' && h.version === '1.18.0'))
  assert.ok(hits.some((h) => h.name === 'Apache httpd' && h.version === '2.4.41'))
  assert.ok(!hits.some((h) => h.name === 'Ubuntu'))
})

test('fingerprint: X-Powered-By / X-AspNet-Version / X-Generator', () => {
  const hits = fingerprintTech([
    entry({
      responseHeaders: [
        ['X-Powered-By', 'Express'],
        ['X-AspNet-Version', '4.0.30319'],
      ],
    }),
    entry({ id: '2', responseHeaders: [['X-Powered-By', 'PHP/7.4.3']] }),
    entry({ id: '3', responseHeaders: [['X-Generator', 'WordPress 6.5.3']] }),
  ])
  assert.ok(hits.some((h) => h.name === 'Express' && h.version === null))
  assert.ok(hits.some((h) => h.name === 'ASP.NET' && h.version === '4.0.30319'))
  assert.ok(hits.some((h) => h.name === 'PHP' && h.version === '7.4.3'))
  assert.ok(hits.some((h) => h.name === 'WordPress' && h.version === '6.5.3'))
})

test('fingerprint: tên cookie (Set-Cookie + Cookie request)', () => {
  const hits = fingerprintTech([
    entry({ responseHeaders: [['Set-Cookie', 'PHPSESSID=abc; Path=/']] }),
    entry({ id: '2', requestHeaders: [['Cookie', 'JSESSIONID=x; laravel_session=y']] }),
  ])
  assert.ok(hits.some((h) => h.name === 'PHP'))
  assert.ok(hits.some((h) => h.name === 'Java Servlet'))
  assert.ok(hits.some((h) => h.name === 'Laravel'))
})

test('fingerprint: HTML meta generator + asset marker; dedupe theo name+version', () => {
  const hits = fingerprintTech([
    entry({
      responseBody: text('<meta name="generator" content="Drupal 9">'),
      mimeType: 'text/html',
    }),
    entry({ id: '2', responseBody: text('<script src="/wp-content/themes/x/s.js"></script>') }),
    entry({ id: '3', responseBody: text('<script>window.__NEXT_DATA__={}</script>') }),
    // trùng nginx ở entry khác → không nhân đôi
    entry({ id: '4', responseHeaders: [['Server', 'nginx/1.18']] }),
    entry({ id: '5', responseHeaders: [['Server', 'nginx/1.18']] }),
  ])
  assert.ok(hits.some((h) => h.name === 'Drupal' && h.version === '9'))
  assert.ok(hits.some((h) => h.name === 'WordPress'))
  assert.ok(hits.some((h) => h.name === 'Next.js'))
  assert.equal(hits.filter((h) => h.name === 'nginx').length, 1)
  assert.equal(hits.find((h) => h.name === 'nginx').entryId, '4')
})

test('fingerprint: hit có version thắng hit trần của cùng tech', () => {
  const hits = fingerprintTech([
    entry({
      responseBody: text(
        '<script src="/a/jquery.min.js"></script><script src="/b/jquery-3.6.0.min.js"></script>',
      ),
    }),
  ])
  const jq = hits.filter((h) => h.name === 'jQuery')
  assert.equal(jq.length, 1)
  assert.equal(jq[0].version, '3.6.0')
})

test('fingerprint: body base64 không quét', () => {
  const hits = fingerprintTech([
    entry({ responseBody: { text: 'AAA=', base64: true, truncated: false, size: 4 } }),
  ])
  assert.equal(hits.length, 0)
})

// ---------- PAYLOAD_PRESETS + URL builders ----------

test('PAYLOAD_PRESETS: ~18-20 preset, id duy nhất, kind/owasp hợp lệ, snippet không rỗng', () => {
  assert.ok(PAYLOAD_PRESETS.length >= 18 && PAYLOAD_PRESETS.length <= 20)
  const ids = new Set(PAYLOAD_PRESETS.map((p) => p.id))
  assert.equal(ids.size, PAYLOAD_PRESETS.length)
  const kinds = new Set(['query', 'header', 'body', 'note'])
  const owaspIds = new Set([
    'A01',
    'A02',
    'A03',
    'A04',
    'A05',
    'A06',
    'A07',
    'A08',
    'A09',
    'A10',
    'other',
  ])
  for (const p of PAYLOAD_PRESETS) {
    assert.ok(kinds.has(p.kind), p.id)
    assert.ok(owaspIds.has(p.owasp), p.id)
    assert.ok(typeof p.snippet === 'string' && p.snippet.length > 0, p.id)
  }
  // nhóm 'note' có mặt (jwt, idor)
  assert.ok(PAYLOAD_PRESETS.filter((p) => p.kind === 'note').length >= 3)
})

test('URL builders: encode đúng, nvdApiUrl clamp limit', () => {
  assert.equal(nvdSearchUrl('log4j'), 'https://nvd.nist.gov/vuln/search/results?query=log4j')
  assert.equal(exploitDbUrl('a b'), 'https://www.exploit-db.com/search?text=a%20b')
  assert.equal(ghsaUrl('x'), 'https://github.com/advisories?query=x')
  assert.match(
    nvdApiUrl('nginx'),
    /^https:\/\/services\.nvd\.nist\.gov\/rest\/json\/cves\/2\.0\?keywordSearch=nginx&resultsPerPage=20$/,
  )
  assert.match(nvdApiUrl('nginx', 5), /resultsPerPage=5$/)
  assert.match(nvdApiUrl('nginx', 999), /resultsPerPage=100$/)
})

// ---------- parseNvdJson (fixture cves/2.0 thật) ----------

const NVD = {
  resultsPerPage: 2,
  startIndex: 0,
  totalResults: 2,
  format: 'NVD_CVE',
  version: '2.0',
  timestamp: '2026-10-14T00:00:00.000',
  vulnerabilities: [
    {
      cve: {
        id: 'CVE-2021-44228',
        sourceIdentifier: 'security@apache.org',
        published: '2021-12-10T10:15:09.143',
        vulnStatus: 'Modified',
        descriptions: [
          {
            lang: 'en',
            value:
              'Apache Log4j2 2.0-beta9 through 2.15.0 (excluding security releases 2.12.2, 2.12.3, and 2.3.1) JNDI features...',
          },
          { lang: 'es', value: 'Apache Log4j2 ...' },
        ],
        metrics: {
          cvssMetricV31: [
            {
              source: 'nvd@nist.gov',
              type: 'Primary',
              cvssData: {
                version: '3.1',
                vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
                baseScore: 10.0,
                baseSeverity: 'CRITICAL',
              },
              exploitabilityScore: 3.9,
              impactScore: 6.0,
            },
          ],
          cvssMetricV2: [
            {
              source: 'nvd@nist.gov',
              type: 'Primary',
              cvssData: {
                version: '2.0',
                vectorString: 'AV:N/AC:L/Au:N/C:C/I:C/A:C',
                baseScore: 9.3,
              },
              baseSeverity: 'HIGH',
            },
          ],
        },
      },
    },
    {
      cve: {
        id: 'CVE-2017-5638',
        descriptions: [
          { lang: 'en', value: 'The Jakarta Multipart parser in Apache Struts 2 ...' },
        ],
        metrics: {
          cvssMetricV2: [
            {
              cvssData: { version: '2.0', baseScore: 10.0 },
              baseSeverity: 'HIGH',
            },
          ],
        },
      },
    },
  ],
}

test('parseNvdJson: đọc đúng fixture cves/2.0 (v3.1 ưu tiên, v2 fallback)', () => {
  const cves = parseNvdJson(NVD)
  assert.equal(cves.length, 2)
  assert.deepEqual(cves[0], {
    id: 'CVE-2021-44228',
    score: 10,
    severity: 'CRITICAL',
    summary:
      'Apache Log4j2 2.0-beta9 through 2.15.0 (excluding security releases 2.12.2, 2.12.3, and 2.3.1) JNDI features...',
  })
  assert.deepEqual(cves[1], {
    id: 'CVE-2017-5638',
    score: 10,
    severity: 'HIGH',
    summary: 'The Jakarta Multipart parser in Apache Struts 2 ...',
  })
})

test('parseNvdJson: cvssMetricV40 ưu tiên cao nhất', () => {
  const j = {
    vulnerabilities: [
      {
        cve: {
          id: 'CVE-2099-0001',
          descriptions: [{ lang: 'en', value: 'x' }],
          metrics: {
            cvssMetricV40: [{ cvssData: { version: '4.0', baseScore: 7.5, baseSeverity: 'HIGH' } }],
            cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' } }],
          },
        },
      },
    ],
  }
  assert.deepEqual(parseNvdJson(j), [
    { id: 'CVE-2099-0001', score: 7.5, severity: 'HIGH', summary: 'x' },
  ])
})

test('parseNvdJson: garbage → [] và entry lỗi bị bỏ qua', () => {
  assert.deepEqual(parseNvdJson(null), [])
  assert.deepEqual(parseNvdJson(42), [])
  assert.deepEqual(parseNvdJson('x'), [])
  assert.deepEqual(parseNvdJson({}), [])
  assert.deepEqual(parseNvdJson({ vulnerabilities: 'x' }), [])
  assert.deepEqual(parseNvdJson({ vulnerabilities: [{}, { cve: {} }, { cve: { id: '' } }] }), [])
  // thiếu descriptions/metrics vẫn giữ entry
  assert.deepEqual(parseNvdJson({ vulnerabilities: [{ cve: { id: 'CVE-1-1' } }] }), [
    { id: 'CVE-1-1', score: null, severity: null, summary: '' },
  ])
})
