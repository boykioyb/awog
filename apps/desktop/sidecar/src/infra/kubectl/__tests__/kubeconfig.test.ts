// Bảng ca cho parser kubeconfig — việc 19 / 8.3 (ADR 0088 §7).
//
// Hai thứ được kiểm ở đây, và thứ hai quan trọng hơn:
//   1. Đọc ĐÚNG tên context/cluster/namespace + URL server ở cả hai dạng file mà
//      kubectl tự ghi (`- cluster:` trước và `- name:` trước).
//   2. KHÔNG BAO GIỜ cắt ra giá trị của `token`, `*-data`, `exec.*`. Ca này khẳng
//      định trên chính CHUỖI JSON của kết quả, nên nó bắt được cả đường rò qua
//      một trường mới thêm sau này.
import { describe, expect, it } from 'vitest'
import { listKubeContexts, parseKubeConfig } from '../kubeconfig.js'

const CANONICAL = `apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: Q0EtREFUQQ==
    server: https://ABCDEF.gr7.ap-southeast-1.eks.amazonaws.com
  name: arn:aws:eks:ap-southeast-1:1:cluster/prod
contexts:
- context:
    cluster: arn:aws:eks:ap-southeast-1:1:cluster/prod
    namespace: apps-b2c
    user: readonly-serviceaccount
  name: readonly-context
current-context: readonly-context
users:
- name: readonly-serviceaccount
  user:
    token: eyJhbGciOiJSUzI1NiJ9.SECRET.SIGNATURE
preferences: {}
`

const NAME_FIRST = `clusters:
  - name: dev
    cluster:
      server: "https://dev.example:6443"
      insecure-skip-tls-verify: true
users:
  - name: dev-user
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1beta1
        command: aws
        args:
          - eks
          - get-token
          - --cluster-name
          - dev
          - --region
          - ap-southeast-1
contexts:
  - name: dev
    context:
      cluster: dev
`

describe('parseKubeConfig', () => {
  it('reads context/cluster/namespace/user + server (canonical layout)', () => {
    const parsed = parseKubeConfig(CANONICAL)
    expect(parsed.currentContext).toBe('readonly-context')
    expect(parsed.contexts).toEqual([
      new Map([
        ['name', 'readonly-context'],
        ['cluster', 'arn:aws:eks:ap-southeast-1:1:cluster/prod'],
        ['namespace', 'apps-b2c'],
        ['user', 'readonly-serviceaccount'],
      ]),
    ])
    expect(parsed.clusters).toEqual([
      new Map([
        ['name', 'arn:aws:eks:ap-southeast-1:1:cluster/prod'],
        ['server', 'https://ABCDEF.gr7.ap-southeast-1.eks.amazonaws.com'],
      ]),
    ])
  })

  it('reads the `- name:` first layout too', () => {
    const parsed = parseKubeConfig(NAME_FIRST)
    expect(parsed.clusters).toEqual([new Map([['name', 'dev'], ['server', 'https://dev.example:6443']])])
    expect(parsed.contexts).toEqual([new Map([['name', 'dev'], ['cluster', 'dev']])])
    expect(parsed.users).toEqual([new Map([['name', 'dev-user']])])
  })

  it('never materialises token, *-data or exec contents', () => {
    const dump = JSON.stringify([
      ...parseKubeConfig(CANONICAL).users.map((e) => [...e]),
      ...parseKubeConfig(CANONICAL).clusters.map((e) => [...e]),
    ])
    expect(dump).not.toContain('SECRET')
    expect(dump).not.toContain('Q0EtREFUQQ')
    expect(JSON.stringify(parseKubeConfig(NAME_FIRST).users.map((e) => [...e]))).not.toContain(
      'get-token',
    )
  })

  it('ignores comments and accepts quoted scalars', () => {
    const parsed = parseKubeConfig(`clusters:
- name: a # trailing comment
  cluster:
    server: 'https://a#fragment.example'
`)
    expect(parsed.clusters[0].get('name')).toBe('a')
    expect(parsed.clusters[0].get('server')).toBe('https://a#fragment.example')
  })

  it('returns empty structures for empty/garbage input instead of throwing', () => {
    const parsed = parseKubeConfig('')
    expect(parsed).toEqual({ currentContext: '', clusters: [], contexts: [], users: [] })
    expect(parseKubeConfig('not: [yaml').contexts).toEqual([])
  })
})

describe('listKubeContexts', () => {
  it('merges KUBECONFIG files (first wins) and resolves the cluster server', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'awog-kube-'))
    const first = join(dir, 'first')
    const second = join(dir, 'second')
    await writeFile(
      first,
      `clusters:
- name: a
  cluster:
    server: https://a.example
contexts:
- name: a-ctx
  context:
    cluster: a
    namespace: ns-a
current-context: a-ctx
`,
      'utf8',
    )
    await writeFile(
      second,
      `clusters:
- name: b
  cluster:
    server: https://b.example
contexts:
- name: b-ctx
  context:
    cluster: b
- name: a-ctx
  context:
    cluster: b
`,
      'utf8',
    )

    const prev = process.env.KUBECONFIG
    process.env.KUBECONFIG = `${first}:${join(dir, 'missing')}:${second}`
    try {
      const { contexts, paths } = await listKubeContexts()
      // File thiếu bị bỏ qua chứ không làm hỏng cả danh sách.
      expect(paths).toEqual([first, second])
      expect(contexts.map((c) => c.name)).toEqual(['a-ctx', 'b-ctx'])
      const a = contexts[0]
      expect(a.server).toBe('https://a.example')
      expect(a.namespace).toBe('ns-a')
      // `a-ctx` khai lại ở file sau nhưng FILE ĐẦU THẮNG (luật của kubectl).
      expect(a.cluster).toBe('a')
      expect(a.current).toBe(true)
      expect(contexts[1].current).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.KUBECONFIG
      else process.env.KUBECONFIG = prev
    }
  })
})
