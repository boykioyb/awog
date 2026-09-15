// Bảng ca cho `pick()` — hàm biến JSON của CLI thành dòng bảng (Mốc 3).
//
// VÌ SAO PHẢI TEST BẰNG JSON THẬT: `pick` là chỗ dễ vỡ nhất của cả Explorer. AWS
// đổi tên một trường, hoặc CLI trả `undefined` cho một khoá, là cả bảng trắng im
// lặng — không lỗi, không cảnh báo, chỉ là "0 tài nguyên" trong khi tài khoản có
// 40 cái. Nên mỗi view ở đây có một mẫu JSON đúng hình dạng thật, và các ca xấu
// (rỗng, sai kiểu, thiếu khoá) phải trả về MẢNG RỖNG chứ không ném.
import { describe, expect, it } from 'vitest'
import { AWS_RESOURCE_VIEWS } from '../aws-views.js'
import type { InfraViewSpec } from '../spec.js'

function pick(viewId: string, json: unknown) {
  const spec = AWS_RESOURCE_VIEWS.find((v) => v.id === viewId)
  expect(spec, `view ${viewId} phải tồn tại`).toBeTruthy()
  return (spec as InfraViewSpec).list.pick(json)
}

describe('mọi view đều chịu được JSON rác', () => {
  it.each(AWS_RESOURCE_VIEWS.map((v) => v.id))('%s: {} → []', (id) => {
    expect(pick(id, {})).toEqual([])
  })
  it.each(AWS_RESOURCE_VIEWS.map((v) => v.id))('%s: null → []', (id) => {
    expect(pick(id, null)).toEqual([])
  })
  it.each(AWS_RESOURCE_VIEWS.map((v) => v.id))('%s: mảng → []', (id) => {
    expect(pick(id, [1, 2, 3])).toEqual([])
  })
})

describe('s3.buckets', () => {
  it('đọc Buckets', () => {
    const rows = pick('s3.buckets', {
      Buckets: [{ Name: 'b-1', CreationDate: '2026-01-02T03:04:05.000Z' }],
    })
    expect(rows).toEqual([{ id: 'b-1', name: 'b-1', created: '02/01 03:04' }])
  })
})

describe('s3.objects', () => {
  it('thư mục (CommonPrefixes) đứng trước tệp', () => {
    const rows = pick('s3.objects', {
      CommonPrefixes: [{ Prefix: 'logs/2026/' }],
      Contents: [
        { Key: 'logs/2026/a.txt', Size: 2048, LastModified: '2026-09-01T10:00:00.000Z' },
      ],
    })
    expect(rows.map((r) => r['kind'])).toEqual(['folder', 'file'])
    expect(rows[0]?.['name']).toBe('2026')
    expect(rows[1]?.['name']).toBe('a.txt')
    expect(rows[1]?.['size']).toBe('2.0 KB')
  })

  it('bỏ khoá rỗng (đối tượng "thư mục" của S3 không phải một dòng)', () => {
    const rows = pick('s3.objects', { Contents: [{ Key: '', Size: 0 }] })
    expect(rows).toEqual([])
  })
})

describe('ec2.instances', () => {
  it('làm phẳng Reservations[].Instances[] và lấy tag Name', () => {
    const rows = pick('ec2.instances', {
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-0a3f',
              InstanceType: 't3.medium',
              State: { Name: 'running' },
              Placement: { AvailabilityZone: 'ap-southeast-1a' },
              PrivateIpAddress: '10.0.3.14',
              LaunchTime: '2026-09-13T09:00:00.000Z',
              Tags: [
                { Key: 'Env', Value: 'prod' },
                { Key: 'Name', Value: 'web-prod-1' },
              ],
            },
          ],
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'i-0a3f',
      name: 'web-prod-1',
      type: 't3.medium',
      state: 'running',
      az: 'ap-southeast-1a',
      privateIp: '10.0.3.14',
      publicIp: '',
    })
  })

  it('thiếu State ⇒ "unknown" chứ không rỗng', () => {
    const rows = pick('ec2.instances', { Reservations: [{ Instances: [{ InstanceId: 'i-1' }] }] })
    expect(rows[0]?.['state']).toBe('unknown')
  })
})

describe('route53.zones', () => {
  it('bỏ tiền tố /hostedzone/ và dấu chấm cuối tên miền', () => {
    const rows = pick('route53.zones', {
      HostedZones: [
        { Id: '/hostedzone/Z123', Name: 'example.com.', ResourceRecordSetCount: 12 },
      ],
    })
    expect(rows[0]).toMatchObject({ id: 'Z123', zoneId: 'Z123', name: 'example.com' })
  })
})

describe('sqs.queues', () => {
  it('nhận cả QueueUrls lẫn QueueUrl đơn', () => {
    expect(pick('sqs.queues', { QueueUrls: ['https://sqs/x/q1'] })[0]?.['name']).toBe('q1')
    expect(pick('sqs.queues', { QueueUrl: 'https://sqs/x/q2' })[0]?.['name']).toBe('q2')
    expect(pick('sqs.queues', {})).toEqual([])
  })
})

describe('cfn.stacks', () => {
  it('bỏ stack đã xoá xong', () => {
    const rows = pick('cfn.stacks', {
      StackSummaries: [
        { StackId: 'a', StackName: 'kept', StackStatus: 'CREATE_COMPLETE' },
        { StackId: 'b', StackName: 'gone', StackStatus: 'DELETE_COMPLETE' },
      ],
    })
    expect(rows.map((r) => r['name'])).toEqual(['kept'])
  })
})

describe('Mốc 4 — bốn màn Delivery/API/DNS (task 4.1)', () => {
  it('cloudfront.distributions: tên là CNAME nếu có, không thì domain', () => {
    const rows = pick('cloudfront.distributions', {
      DistributionList: {
        Items: [
          {
            Id: 'E123',
            DomainName: 'd111.cloudfront.net',
            Status: 'Deployed',
            Enabled: true,
            LastModifiedTime: '2026-09-01T10:00:00.000Z',
            Aliases: { Quantity: 1, Items: ['shop.example.com'] },
            Origins: { Quantity: 1, Items: [{ Id: 'o1', DomainName: 'origin.example.com' }] },
          },
          { Id: 'E456', DomainName: 'd222.cloudfront.net', Enabled: false },
        ],
      },
    })
    expect(rows[0]).toMatchObject({
      id: 'E123',
      name: 'shop.example.com',
      alias: 'shop.example.com',
      origin: 'origin.example.com',
      status: 'Deployed',
      enabled: 'yes',
    })
    // Không có CNAME ⇒ rơi về domain, KHÔNG rơi về id (id là thứ người dùng
    // không nhận ra).
    expect(rows[1]).toMatchObject({ name: 'd222.cloudfront.net', enabled: 'no' })
  })

  it('cloudfront.invalidations: đọc InvalidationList.Items', () => {
    const rows = pick('cloudfront.invalidations', {
      InvalidationList: {
        Items: [{ Id: 'I1', Status: 'Completed', CreateTime: '2026-09-01T10:00:00.000Z' }],
      },
    })
    expect(rows).toEqual([
      { id: 'I1', name: 'I1', status: 'Completed', issued: '01/09 10:00' },
    ])
  })

  it('apigateway.restApis: createdDate là epoch giây, không phải ISO', () => {
    const rows = pick('apigateway.restApis', {
      items: [
        {
          id: 'abc123',
          name: 'shop-api',
          description: 'prod',
          createdDate: 1756720800,
          endpointConfiguration: { types: ['EDGE'] },
        },
      ],
    })
    expect(rows[0]).toMatchObject({ id: 'abc123', name: 'shop-api', endpoint: 'EDGE' })
    // 1756720800 = 2025-09-01T10:00:00Z. Cột phải là ngày giờ, KHÔNG phải
    // "1756720800" — một con số thô trong cột ngày là cột hỏng.
    expect(rows[0]?.['created']).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
  })

  it('apigatewayv2.httpApis: đọc Items và giữ ProtocolType', () => {
    const rows = pick('apigatewayv2.httpApis', {
      Items: [
        {
          ApiId: 'xyz',
          Name: 'shop-http',
          ProtocolType: 'HTTP',
          ApiEndpoint: 'https://xyz.execute-api.ap-southeast-1.amazonaws.com',
          CreatedDate: '2026-09-01T10:00:00.000Z',
        },
      ],
    })
    expect(rows[0]).toMatchObject({ id: 'xyz', name: 'shop-http', protocol: 'HTTP' })
  })

  it('acm.certificates: inUse theo InUseBy, và KHÔNG hứa ngày hết hạn ở bảng', () => {
    const rows = pick('acm.certificates', {
      CertificateSummaryList: [
        {
          CertificateArn: 'arn:aws:acm:us-east-1:1:certificate/abc',
          DomainName: 'example.com',
          Status: 'ISSUED',
          Type: 'AMAZON_ISSUED',
          KeyAlgorithm: 'RSA_2048',
          InUseBy: ['arn:aws:cloudfront::1:distribution/E1'],
        },
        { CertificateArn: 'arn:aws:acm:us-east-1:1:certificate/def', DomainName: 'x.example.com' },
      ],
    })
    expect(rows[0]).toMatchObject({ name: 'example.com', inUse: 'yes', status: 'ISSUED' })
    // `list-certificates` không trả NotAfter, nên cột này PHẢI rỗng ở bảng —
    // hiện một ngày bịa (hay ngày hôm nay) là nói dối về hạn chứng chỉ.
    expect(rows[0]?.['expires']).toBe('')
    expect(rows[1]).toMatchObject({ inUse: 'no' })
  })

  it('route53.records: bỏ dấu chấm cuối tên, khoá dòng gồm cả type', () => {
    const rows = pick('route53.records', {
      ResourceRecordSets: [
        {
          Name: 'example.com.',
          Type: 'A',
          TTL: 300,
          ResourceRecords: [{ Value: '1.2.3.4' }, { Value: '5.6.7.8' }],
        },
        { Name: 'example.com.', Type: 'AAAA', TTL: 300 },
        {
          Name: 'www.example.com.',
          Type: 'A',
          AliasTarget: { DNSName: 'd111.cloudfront.net.' },
        },
      ],
    })
    expect(rows[0]).toMatchObject({ name: 'example.com', type: 'A', value: '1.2.3.4, 5.6.7.8' })
    // Cùng tên khác type ⇒ PHẢI khác khoá dòng, nếu không bảng nuốt một dòng.
    expect(rows[0]?.['id']).not.toBe(rows[1]?.['id'])
    expect(rows[2]?.['value']).toBe('d111.cloudfront.net.')
  })
})

describe('secretsmanager.secrets', () => {
  it('CHỈ trả tên + mô tả, không bao giờ trả giá trị', () => {
    const rows = pick('secretsmanager.secrets', {
      SecretList: [
        { Name: 'db/password', Description: 'prod db', SecretString: 'hunter2' },
      ],
    })
    expect(rows[0]?.['name']).toBe('db/password')
    expect(JSON.stringify(rows)).not.toContain('hunter2')
  })
})
