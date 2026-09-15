// Parser bảng chữ của kubectl — chỗ dễ sai âm thầm nhất trong cả nhánh này, vì
// sai thì bảng vẫn hiện, chỉ lệch cột.
import { describe, expect, it } from 'vitest'
import { parseDescribeContainerNames, parseKubeTable } from '../table.js'

describe('parseKubeTable', () => {
  it('cắt theo đệm ≥2 dấu cách (cách kubectl vẽ cột)', () => {
    const text = ['app-0   1/1   Running   0   3d', 'app-1   0/1   Pending   0   5m'].join('\n')
    expect(parseKubeTable(text)).toEqual([
      ['app-0', '1/1', 'Running', '0', '3d'],
      ['app-1', '0/1', 'Pending', '0', '5m'],
    ])
  })

  it('giữ RESTARTS có dấu cách bên trong là MỘT ô (không đẩy lệch cột AGE)', () => {
    const rows = parseKubeTable('app-2   1/1   Running   4 (2m ago)   8d')
    expect(rows[0]).toHaveLength(5)
    expect(rows[0][3]).toBe('4 (2m ago)')
    expect(rows[0][4]).toBe('8d')
  })

  it('bỏ dòng trống và dòng chỉ có khoảng trắng', () => {
    expect(parseKubeTable('\n  \napp-0   1/1   Running   0   3d\n')).toHaveLength(1)
  })

  it('bảng rỗng ⇒ không hàng nào', () => {
    expect(parseKubeTable('')).toEqual([])
    expect(parseKubeTable('   \n \n')).toEqual([])
  })

  it('hàng có ô rỗng ở giữa vẫn giữ đủ số ô', () => {
    // `kubectl get pods -o wide` để trống NOMINATED NODE / READINESS GATES.
    const rows = parseKubeTable('app-0   1/1   Running   0   3d   10.0.0.5   node-1   <none>   <none>')
    expect(rows[0]).toHaveLength(9)
    expect(rows[0][7]).toBe('<none>')
  })
})

describe('parseDescribeContainerNames', () => {
  const sample = [
    'Name:         app-0',
    'Namespace:    default',
    'Priority:     0',
    'Init Containers:',
    '  migrate:',
    '    Container ID:  containerd://aaa',
    'Containers:',
    '  app:',
    '    Container ID:   containerd://bbb',
    '    Image:          nginx:1.27',
    '  sidecar:',
    '    Container ID:   containerd://ccc',
    'Conditions:',
    '  Type              Status',
    '  Initialized       True',
    'Volumes:',
    '  kube-api-access:',
    '    Type:  Projected',
  ].join('\n')

  it('lấy đúng container chính, bỏ init container và các khối sau', () => {
    expect(parseDescribeContainerNames(sample)).toEqual(['app', 'sidecar'])
  })

  it('pod một container', () => {
    const text = ['Containers:', '  app:', '    Image:  nginx'].join('\n')
    expect(parseDescribeContainerNames(text)).toEqual(['app'])
  })

  it('không có khối Containers ⇒ rỗng (không ném)', () => {
    expect(parseDescribeContainerNames('Name:  app-0\nConditions:\n  Ready  True')).toEqual([])
    expect(parseDescribeContainerNames('')).toEqual([])
  })
})
