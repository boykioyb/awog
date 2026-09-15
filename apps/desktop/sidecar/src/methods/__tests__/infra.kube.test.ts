// `infra.kube` — phần đáng test nhất là chỗ tên do CLUSTER trả về đi vào argv.
// Tên pod/namespace/deployment là dữ liệu bên ngoài: một cluster (hoặc một người
// đặt tên pod) có thể đặt tên `--kubeconfig=/etc/passwd`, và nếu chỗ ghép argv
// không chặn thì nó trở thành CỜ của lệnh kubectl.
import { describe, expect, it } from 'vitest'
import { buildKubeCommand, parseEksClusterNames } from '../infra.kube.js'

const kctx = { cluster: 'readonly-context', namespace: 'apps-b2c' }

describe('buildKubeCommand — tên độc hại bị chặn trước khi thành argv', () => {
  it.each<string>([
    '--kubeconfig=/etc/passwd',
    '--namespace=prod',
    '-o',
    'app; rm -rf /',
    'app\n--context other',
    '',
  ])('pod %j ⇒ ném, không dựng lệnh', (pod) => {
    expect(() => buildKubeCommand({ op: 'logs', context: kctx, pod })).toThrow()
  })

  it('namespace độc hại cũng bị chặn (nó vào context, không vào args)', () => {
    expect(() =>
      buildKubeCommand({ op: 'pods', context: { cluster: 'c', namespace: '--context other' } }),
    ).toThrow()
  })

  it('region/profile độc hại bị chặn', () => {
    expect(() =>
      buildKubeCommand({ op: 'eks-clusters', context: { region: '--endpoint-url http://evil' } }),
    ).toThrow()
    expect(() =>
      buildKubeCommand({ op: 'eks-clusters', context: { profile: '-x' } }),
    ).toThrow()
  })
})

describe('buildKubeCommand — ngữ cảnh đi bằng context, KHÔNG thành cờ của UI', () => {
  it('bảng pods không tự mang -n/--namespace trong argv', () => {
    const built = buildKubeCommand({ op: 'pods', context: kctx })
    expect(built.args).toEqual(['get', 'pods', '--no-headers'])
    // `--namespace` nằm trong danh sách cờ bị `infra/run.ts` từ chối, nên nó chỉ
    // có thể đến từ context — nếu có trong args thì lệnh này luôn bị từ chối.
    expect(built.args.some((a) => a.includes('namespace'))).toBe(false)
    expect(built.context).toEqual(kctx)
  })

  it('add-cluster: --name trong argv, --region/--profile trong context', () => {
    const built = buildKubeCommand({
      op: 'add-cluster',
      context: { profile: 'dev', region: 'ap-southeast-1' },
      cluster: 'prod-eks',
    })
    expect(built.args).toEqual(['eks', 'update-kubeconfig', '--name', 'prod-eks'])
    expect(built.args.some((a) => a.startsWith('--region'))).toBe(false)
    expect(built.context).toEqual({ profile: 'dev', region: 'ap-southeast-1' })
  })

  it('add-cluster thiếu region ⇒ ném (không để CLI tự đoán region)', () => {
    expect(() =>
      buildKubeCommand({ op: 'add-cluster', context: { profile: 'dev' }, cluster: 'prod-eks' }),
    ).toThrow(/region/i)
  })

  it('logs có tail mặc định và container khi được chọn', () => {
    const plain = buildKubeCommand({ op: 'logs', context: kctx, pod: 'app-0' })
    expect(plain.args).toEqual(['logs', 'app-0', '--tail', '200'])
    const withContainer = buildKubeCommand({
      op: 'logs',
      context: kctx,
      pod: 'app-0',
      container: 'sidecar',
      tail: 50,
    })
    expect(withContainer.args).toEqual(['logs', 'app-0', '--tail', '50', '--container', 'sidecar'])
  })

  it('delete-pod và restart dựng đúng động từ', () => {
    expect(buildKubeCommand({ op: 'delete-pod', context: kctx, pod: 'app-0' }).args).toEqual([
      'delete',
      'pod',
      'app-0',
    ])
    expect(
      buildKubeCommand({ op: 'restart', context: kctx, deployment: 'api' }).args,
    ).toEqual(['rollout', 'restart', 'deployment/api'])
  })

  it('container độc hại bị chặn', () => {
    expect(() =>
      buildKubeCommand({ op: 'logs', context: kctx, pod: 'app-0', container: '--all-containers' }),
    ).toThrow()
  })
})

describe('parseEksClusterNames', () => {
  it('đọc danh sách từ output JSON của aws', () => {
    expect(parseEksClusterNames('{"clusters":["a","b"]}')).toEqual(['a', 'b'])
  })

  it('bỏ giá trị không phải tên hợp lệ', () => {
    expect(parseEksClusterNames('{"clusters":["ok","--evil",1,null]}')).toEqual(['ok'])
  })

  it('output hỏng ⇒ rỗng, không ném', () => {
    expect(parseEksClusterNames('not json')).toEqual([])
    expect(parseEksClusterNames('')).toEqual([])
    expect(parseEksClusterNames('{"clusters":"x"}')).toEqual([])
  })
})
