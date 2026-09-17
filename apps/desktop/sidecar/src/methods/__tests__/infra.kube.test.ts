// `infra.kube` — phần đáng test nhất là chỗ tên do CLUSTER trả về đi vào argv.
// Tên pod/namespace/deployment là dữ liệu bên ngoài: một cluster (hoặc một người
// đặt tên pod) có thể đặt tên `--kubeconfig=/etc/passwd`, và nếu chỗ ghép argv
// không chặn thì nó trở thành CỜ của lệnh kubectl.
import { describe, expect, it } from 'vitest'
import { buildKubeCommand, parseEksClusterNames } from '../infra.kube.js'
import { classify, findForbiddenFlag, hasFullFormatFlag } from '../../infra/classify.js'

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
    expect(built.args).toEqual(['get', 'pods', '-o', 'wide', '--no-headers'])
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

  it('logs nhận --since dạng tương đối, và GIỮ --tail', () => {
    const built = buildKubeCommand({ op: 'logs', context: kctx, pod: 'app-0', since: '15m' })
    // Giao của hai điều kiện: "1 giờ qua" của một service ồn vẫn phải bị --tail chặn.
    expect(built.args).toEqual(['logs', 'app-0', '--tail', '200', '--since', '15m'])
    expect(findForbiddenFlag(built.args)).toBeNull()
    expect(classify('kubectl', built.args)).toBe('read')
  })

  it.each(['15', 'm', '0m', '15d', '15 m', '--since-time=x', '15m; rm -rf /', '99999h'])(
    'since %j ⇒ ném, không dựng lệnh',
    (since) => {
      expect(() => buildKubeCommand({ op: 'logs', context: kctx, pod: 'app-0', since })).toThrow()
    },
  )

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

// ─── Số liệu của màn Báo cáo ────────────────────────────────────────────────
// Bốn thao tác này không nhận tên nào từ UI, nên phần đáng test là HẠNG của lệnh:
// chúng phải rơi vào `read` (chạy thẳng, không hỏi duyệt) và không được mang cờ
// ngữ cảnh nào trong argv. Một thao tác báo cáo mà mỗi lần nạp lại hỏi duyệt thì
// nút "Theo dõi mỗi 30s" trở thành 30 hộp thoại một phút.
describe('buildKubeCommand — thao tác số liệu của Báo cáo', () => {
  it.each<[string, string[]]>([
    ['nodes', ['get', 'nodes', '--no-headers']],
    ['top-pods', ['top', 'pods', '--no-headers']],
    ['top-nodes', ['top', 'nodes', '--no-headers']],
    // `describe nodes` KHÔNG kèm tên node: một lần gọi trả sức chứa của mọi node.
    ['describe-nodes', ['describe', 'nodes']],
    ['hpa', ['get', 'hpa', '--no-headers']],
    ['statefulsets', ['get', 'statefulsets', '--no-headers']],
    ['daemonsets', ['get', 'daemonsets', '--no-headers']],
    ['jobs', ['get', 'jobs', '--no-headers']],
    ['pvc', ['get', 'pvc', '--no-headers']],
    ['services', ['get', 'services', '--no-headers']],
    ['ingresses', ['get', 'ingresses', '--no-headers']],
    ['endpoints', ['get', 'endpoints', '--no-headers']],
    ['resourcequota', ['get', 'resourcequota', '--no-headers']],
    // Tên thao tác phía UI là `pdb`, nhưng argv dùng tên tài nguyên ĐẦY ĐỦ.
    ['pdb', ['get', 'poddisruptionbudgets', '--no-headers']],
    ['replicasets', ['get', 'rs', '--no-headers']],
    [
      'events',
      [
        'get',
        'events',
        '--field-selector',
        'type=Warning',
        '--sort-by=.metadata.creationTimestamp',
        '--no-headers',
      ],
    ],
  ])('%s ⇒ argv đúng, hạng read, không cờ ngữ cảnh', (op, args) => {
    const built = buildKubeCommand({
      op: op as
        | 'nodes'
        | 'top-pods'
        | 'top-nodes'
        | 'events'
        | 'describe-nodes'
        | 'hpa'
        | 'statefulsets'
        | 'daemonsets'
        | 'jobs'
        | 'pvc'
        | 'services'
        | 'ingresses'
        | 'endpoints'
        | 'resourcequota'
        | 'pdb'
        | 'replicasets',
      context: kctx,
    })
    expect(built.tool).toBe('kubectl')
    expect(built.args).toEqual(args)
    expect(built.context).toEqual(kctx)
    expect(findForbiddenFlag(built.args)).toBeNull()
    expect(hasFullFormatFlag(built.args)).toBe(false)
    expect(classify('kubectl', built.args)).toBe('read')
  })

  // Bất biến bảo mật, không phải chi tiết vặt: `-o wide` phải nằm ĐÚNG phía bảng
  // metadata. Nếu một ngày nào đó nó bị đổi thành `-o json`/`custom-columns` (hoặc
  // `hasFullFormatFlag` bị nới ra), bảng Deployments im lặng chuyển sang "in nội
  // dung object" ⇒ `sensitiveReadOf()` siết lên `ask` và mỗi lần nạp báo cáo là một
  // hộp thoại duyệt — hoặc tệ hơn, in ra thứ mà bảng tóm tắt vốn không in.
  it('deployments -o wide vẫn là bảng metadata ⇒ hạng read, không phải định dạng đầy đủ', () => {
    const built = buildKubeCommand({ op: 'deployments', context: kctx })
    expect(built.args).toEqual(['get', 'deployments', '-o', 'wide', '--no-headers'])
    expect(hasFullFormatFlag(built.args)).toBe(false)
    expect(findForbiddenFlag(built.args)).toBeNull()
    expect(classify('kubectl', built.args)).toBe('read')
  })

  it('namespace độc hại vẫn bị chặn ở các thao tác mới', () => {
    expect(() =>
      buildKubeCommand({ op: 'top-pods', context: { cluster: 'c', namespace: '-o' } }),
    ).toThrow()
  })
})
