// Các VIEW của Explorer: S3 · EC2 (task 3.6, 3.7) · mười dịch vụ mức "Danh sách"
// (task 3.8 — mức rẻ nhất trong ba mức hỗ trợ) · và bốn màn Delivery/API/DNS của
// Mốc 4 (task 4.1: CloudFront + lịch sử invalidation · API Gateway REST/HTTP ·
// Route 53 bản ghi · ACM).
//
// MỘT FILE, KHÔNG PHẢI HAI MƯƠI TRANG. Đúng tinh thần "thêm một dịch vụ = thêm
// một mô tả ~15–60 dòng". View mức "Danh sách" chỉ khai một lệnh `list-*`/`describe-*`
// cộng 3–4 cột; view mức "Đầy đủ" thêm chi tiết + hành động ngày-2.
//
// LỆNH Ở ĐÂY KHÔNG BAO GIỜ TỰ CHẠY. Không hàm nào trong file này gọi CLI — nó chỉ
// mô tả. Việc chạy thuộc RPC `infra.resource-list`/`-detail`/`-action`, và tất cả
// đều đi qua `runGated()` (cổng duy nhất: classify → ma trận quyền → vé duyệt →
// `runInfra` ghi nhật ký). Nhờ vậy một view mới KHÔNG mở thêm đường ra mạng nào.

import {
  arnTail,
  asArray,
  asObj,
  at,
  formatBytes,
  formatWhen,
  str,
  tagName,
  type InfraFormField,
  type InfraRow,
  type InfraRowAction,
  type InfraViewSpec,
} from './spec.js'

/**
 * Mốc giờ dạng epoch giây của API Gateway v1 (`createdDate: 1735689600`). CLI in
 * số, không in ISO như phần lớn dịch vụ, nên cần một phép đổi — và phải chịu
 * được cả hai thang (giây/mili) vì không có gì bảo đảm AWS giữ nguyên một thang.
 */
function epochWhen(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(str(v))
  if (!Number.isFinite(n) || n <= 0) return ''
  const ms = n > 1e12 ? n : n * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? '' : formatWhen(d.toISOString())
}

// ─── S3 ──────────────────────────────────────────────────────────────────────

const BUCKET = [{ key: 'bucket', label: 'infra.explorer.form.bucket', required: true }] as const

const s3Buckets: InfraViewSpec = {
  id: 's3.buckets',
  service: 's3',
  label: 'infra.explorer.view.s3.buckets',
  about: 'infra.explorer.about.s3',
  support: 'full',
  list: {
    args: ['s3api', 'list-buckets'],
    pick: (json) =>
      asArray(asObj(json)['Buckets']).map((b) => {
        const o = asObj(b)
        const name = str(o['Name'])
        return {
          id: name,
          name,
          created: formatWhen(str(o['CreationDate'])),
        }
      }),
    tokenPath: 'NextToken',
    tokenFlag: '--starting-token',
    pageSize: 200,
    pageSizeFlag: '--max-items',
  },
  columns: {
    simple: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'id', label: 'infra.explorer.col.id', width: '260px' },
      { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
    ],
  },
  consoleUrl: (row, ctx) =>
    `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(row['name'] ?? '')}` +
    (ctx.region ? `?region=${encodeURIComponent(ctx.region)}` : ''),
  forms: [
    {
      id: 's3.createBucket',
      label: 'infra.explorer.form.createBucket',
      consequence: 'infra.explorer.consequence.createBucket',
      danger: false,
      confirm: 'type-name',
      iam: 's3:CreateBucket',
      typeNameField: 'bucket',
      fields: [
        {
          key: 'bucket',
          label: 'infra.explorer.form.bucket',
          placeholder: 'my-bucket-name',
          required: true,
        },
      ],
      args: ['s3api', 'create-bucket', '--bucket', '{bucket}'],
    },
  ],
  probe: { actions: ['s3:CreateBucket'] },
}

const s3Objects: InfraViewSpec = {
  id: 's3.objects',
  service: 's3',
  label: 'infra.explorer.view.s3.objects',
  about: 'infra.explorer.about.s3',
  support: 'full',
  list: {
    required: BUCKET,
    args: [
      's3api',
      'list-objects-v2',
      '--bucket',
      '{bucket}',
      '--delimiter',
      '/',
      '--prefix',
      '{prefix}',
    ],
    pick: (json) => {
      const o = asObj(json)
      const rows: InfraRow[] = []
      // Thư mục đứng TRƯỚC tệp: `CommonPrefixes` là "thư mục con" ở delimiter `/`.
      for (const p of asArray(o['CommonPrefixes'])) {
        const prefix = str(asObj(p)['Prefix'])
        const name = prefix.replace(/\/$/, '').split('/').pop() ?? prefix
        rows.push({ id: prefix, name, kind: 'folder', key: prefix, size: '', modified: '' })
      }
      for (const c of asArray(o['Contents'])) {
        const obj = asObj(c)
        const key = str(obj['Key'])
        if (key === '') continue
        rows.push({
          id: key,
          name: key.split('/').pop() ?? key,
          kind: 'file',
          key,
          size: formatBytes(obj['Size']),
          storageClass: str(obj['StorageClass']),
          modified: formatWhen(str(obj['LastModified'])),
        })
      }
      return rows
    },
    tokenPath: 'NextToken',
    tokenFlag: '--starting-token',
    pageSize: 200,
    pageSizeFlag: '--max-items',
  },
  columns: {
    simple: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'size', label: 'infra.explorer.col.size', width: '90px', align: 'right' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'key', label: 'infra.explorer.col.key', wide: true },
      { key: 'size', label: 'infra.explorer.col.size', width: '90px', align: 'right' },
      { key: 'storageClass', label: 'infra.explorer.col.storageClass', width: '130px' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
  },
  actions: [
    {
      id: 's3.download',
      label: 'infra.explorer.action.download',
      consequence: 'infra.explorer.consequence.download',
      danger: false,
      confirm: 'simple',
      iam: 's3:GetObject',
      // KHÔNG có đích ghi trong argv: `download.bucket/key` báo cho `execute.ts`
      // biết phải tự ghép đường dẫn trong cache của sidecar. Renderer không bao
      // giờ đặt tên file — đó là điều kiện để `classify` nâng `get-object` lên
      // `read` một cách chắc chắn (xem `infra/cache.ts`).
      args: ['s3api', 'get-object', '--bucket', '{bucket}', '--key', '{key}'],
      download: { bucket: 'bucket', key: 'key' },
    },
    {
      id: 's3.deleteObject',
      label: 'infra.explorer.action.delete',
      consequence: 'infra.explorer.consequence.deleteObject',
      danger: true,
      confirm: 'type-name',
      iam: 's3:DeleteObject',
      typeNameKey: 'name',
      args: ['s3api', 'delete-object', '--bucket', '{bucket}', '--key', '{key}'],
    },
  ],
  forms: [
    {
      id: 's3.putFolder',
      label: 'infra.explorer.form.createFolder',
      consequence: 'infra.explorer.consequence.createFolder',
      danger: false,
      confirm: 'simple',
      iam: 's3:PutObject',
      fields: [
        { key: 'prefix', label: 'infra.explorer.form.prefix', placeholder: 'logs/2026/' },
      ],
      args: ['s3api', 'put-object', '--bucket', '{bucket}', '--key', '{folderKey}'],
      // S3 không có "thư mục": một key rỗng kết thúc bằng `/` là thư mục. Luật này
      // là của AWS nên nó ở đây, không nằm rải trong component.
      derive: (v) => ({ ...v, folderKey: v['prefix']?.endsWith('/') ? v['prefix'] : `${v['prefix'] ?? ''}/` }),
    },
    {
      id: 's3.upload',
      label: 'infra.explorer.form.upload',
      consequence: 'infra.explorer.consequence.upload',
      danger: false,
      confirm: 'simple',
      iam: 's3:PutObject',
      fields: [
        { key: 'source', label: 'infra.explorer.form.localFile', required: true },
        { key: 'objectKey', label: 'infra.explorer.form.objectKey', required: true },
      ],
      args: ['s3api', 'put-object', '--bucket', '{bucket}', '--key', '{objectKey}', '--body', '{source}'],
    },
    {
      id: 's3.presign',
      label: 'infra.explorer.form.presign',
      consequence: 'infra.explorer.consequence.presign',
      danger: false,
      confirm: 'simple',
      // `presign` chỉ KÝ một URL; quyền nằm ở hành động mà URL đó cho phép đọc.
      iam: 's3:GetObject',
      fields: [{ key: 'objectKey', label: 'infra.explorer.form.objectKey', required: true }],
      args: ['s3', 'presign', 's3://{bucket}/{objectKey}', '--expires-in', '900'],
      class: 'read',
    },
  ],
  // Dò quyền cho cả ba hành động ghi của view này (tạo "thư mục", tải lên, xoá).
  // Không khai thì task 3.3 không có gì để ẩn ở đây và người dùng chỉ gặp
  // `AccessDenied` sau khi đã bấm.
  probe: { actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'] },
}

// ─── EC2 ─────────────────────────────────────────────────────────────────────

const EC2_PLAIN = { key: 'infra.explorer.plain.ec2', fields: ['type', 'state', 'privateIp'] }

const ec2Instances: InfraViewSpec = {
  id: 'ec2.instances',
  service: 'ec2',
  label: 'infra.explorer.view.ec2.instances',
  about: 'infra.explorer.about.ec2',
  support: 'full',
  list: {
    args: ['ec2', 'describe-instances'],
    pick: (json) => {
      const rows: InfraRow[] = []
      for (const r of asArray(asObj(json)['Reservations'])) {
        for (const i of asArray(asObj(r)['Instances'])) {
          const o = asObj(i)
          const id = str(o['InstanceId'])
          const state = str(at(o, 'State.Name'), 'unknown')
          rows.push({
            id,
            name: tagName(o['Tags']),
            type: str(o['InstanceType']),
            state,
            az: str(at(o, 'Placement.AvailabilityZone')),
            privateIp: str(o['PrivateIpAddress']),
            publicIp: str(o['PublicIpAddress']),
            launched: formatWhen(str(o['LaunchTime'])),
          })
        }
      }
      return rows
    },
    tokenPath: 'NextToken',
    tokenFlag: '--starting-token',
    pageSize: 200,
    pageSizeFlag: '--max-items',
  },
  columns: {
    simple: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'state', label: 'infra.explorer.col.state', width: '110px' },
      { key: 'type', label: 'infra.explorer.col.type', width: '110px' },
      { key: 'privateIp', label: 'infra.explorer.col.privateIp', width: '130px' },
    ],
    full: [
      { key: 'id', label: 'infra.explorer.col.id', width: '160px' },
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'type', label: 'infra.explorer.col.type', width: '110px' },
      { key: 'state', label: 'infra.explorer.col.state', width: '110px' },
      { key: 'az', label: 'infra.explorer.col.az', width: '150px' },
      { key: 'privateIp', label: 'infra.explorer.col.privateIp', width: '130px' },
      { key: 'publicIp', label: 'infra.explorer.col.publicIp', width: '130px' },
      { key: 'launched', label: 'infra.explorer.col.launched', width: '120px' },
    ],
  },
  plain: EC2_PLAIN,
  detail: { args: ['ec2', 'describe-instances', '--instance-ids', '{id}'] },
  actions: [
    {
      id: 'ec2.start',
      label: 'infra.explorer.action.start',
      consequence: 'infra.explorer.consequence.start',
      danger: false,
      confirm: 'simple',
      iam: 'ec2:StartInstances',
      args: ['ec2', 'start-instances', '--instance-ids', '{id}'],
    },
    {
      id: 'ec2.stop',
      label: 'infra.explorer.action.stop',
      consequence: 'infra.explorer.consequence.stop',
      danger: false,
      confirm: 'simple',
      iam: 'ec2:StopInstances',
      args: ['ec2', 'stop-instances', '--instance-ids', '{id}'],
    },
    {
      id: 'ec2.reboot',
      label: 'infra.explorer.action.reboot',
      consequence: 'infra.explorer.consequence.reboot',
      danger: false,
      confirm: 'simple',
      iam: 'ec2:RebootInstances',
      args: ['ec2', 'reboot-instances', '--instance-ids', '{id}'],
    },
    {
      id: 'ec2.terminate',
      label: 'infra.explorer.action.terminate',
      consequence: 'infra.explorer.consequence.terminate',
      danger: true,
      confirm: 'type-name',
      iam: 'ec2:TerminateInstances',
      typeNameKey: 'name',
      args: ['ec2', 'terminate-instances', '--instance-ids', '{id}'],
    },
  ],
  consoleUrl: (row, ctx) =>
    `https://${ctx.region || 'us-east-1'}.console.aws.amazon.com/ec2/home?region=` +
    `${encodeURIComponent(ctx.region || 'us-east-1')}#InstanceDetails:instanceId=` +
    `${encodeURIComponent(row['id'] ?? '')}`,
  probe: {
    actions: [
      'ec2:StartInstances',
      'ec2:StopInstances',
      'ec2:RebootInstances',
      'ec2:TerminateInstances',
    ],
  },
}

// ─── Mốc 4 (task 4.1): phân phối, API và DNS ────────────────────────────────
//
// Bốn màn của "Delivery, API & CI/CD". Chúng là view THƯỜNG — cùng khung bảng,
// cùng cổng quyền, cùng nhật ký. Ba thứ mới so với Mốc 3, mỗi thứ chỉ thêm một
// khả năng khai báo (xem `spec.ts`):
//   · `notice` — cảnh báo luôn hiện (ACM bắt buộc `us-east-1` cho CloudFront);
//   · `fields` trên hành động một dòng — invalidation cần thêm danh sách đường dẫn;
//   · `opensView` — hành động KHÔNG chạy lệnh, nó mở view con (lịch sử invalidation,
//     bản ghi của một zone).

const cloudfrontDistributions: InfraViewSpec = {
  id: 'cloudfront.distributions',
  service: 'cloudfront',
  label: 'infra.explorer.view.cloudfront.distributions',
  about: 'infra.explorer.about.cloudfront',
  support: 'full',
  list: {
    args: ['cloudfront', 'list-distributions'],
    pick: (json) => {
      const list = asObj(asObj(json)['DistributionList'])
      return asArray(list['Items']).map((d) => {
        const o = asObj(d)
        // Tên người dùng nhận ra là CNAME (example.com), không phải `E1234…`.
        const alias = str(asArray(asObj(at(o, 'Aliases'))['Items'])[0])
        const domain = str(o['DomainName'])
        const origin = asObj(asArray(asObj(at(o, 'Origins'))['Items'])[0])
        return {
          id: str(o['Id']),
          name: alias || domain || str(o['Id']),
          alias,
          domain,
          origin: str(origin['DomainName']),
          status: str(o['Status']),
          enabled: str(o['Enabled']) === 'true' ? 'yes' : 'no',
          modified: formatWhen(str(o['LastModifiedTime'])),
        }
      })
    },
    tokenPath: 'NextToken',
    tokenFlag: '--starting-token',
    pageSize: 200,
    pageSizeFlag: '--max-items',
  },
  columns: {
    simple: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'status', label: 'infra.explorer.col.state', width: '130px' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'id', label: 'infra.explorer.col.id', width: '160px' },
      { key: 'domain', label: 'infra.explorer.col.domain', wide: true },
      { key: 'origin', label: 'infra.explorer.col.origin', wide: true },
      { key: 'status', label: 'infra.explorer.col.state', width: '130px' },
      { key: 'enabled', label: 'infra.explorer.col.enabled', width: '90px' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
  },
  actions: [
    {
      id: 'cloudfront.createInvalidation',
      label: 'infra.explorer.action.invalidate',
      consequence: 'infra.explorer.consequence.invalidate',
      danger: false,
      confirm: 'simple',
      iam: 'cloudfront:CreateInvalidation',
      // Đường dẫn là ô NHIỀU giá trị: một invalidation gần như luôn nhắm nhiều
      // đường dẫn, và bắt người dùng bấm nhiều lần là bắt họ trả nhiều lần tiền
      // (mỗi lần gọi là một invalidation riêng, tính phí riêng sau 1000 đường
      // dẫn/tháng).
      fields: [
        {
          key: 'paths',
          label: 'infra.explorer.form.invalidationPaths',
          placeholder: '/index.html /assets/*',
          required: true,
          list: true,
        },
      ],
      args: ['cloudfront', 'create-invalidation', '--distribution-id', '{id}', '--paths', '{paths}'],
    },
    {
      id: 'cloudfront.invalidations',
      label: 'infra.explorer.action.viewInvalidations',
      consequence: 'infra.explorer.consequence.viewInvalidations',
      danger: false,
      confirm: 'none',
      opensView: { viewId: 'cloudfront.invalidations', values: { distributionId: 'id' } },
      args: [],
    },
  ],
  // CloudFront là dịch vụ TOÀN CẦU: deep link không kèm region (task 3.4).
  consoleUrl: (row) =>
    `https://console.aws.amazon.com/cloudfront/v4/home#/distributions/${encodeURIComponent(
      row['id'] ?? '',
    )}`,
  probe: { actions: ['cloudfront:CreateInvalidation'] },
}

const cloudfrontInvalidations = listView({
  id: 'cloudfront.invalidations',
  service: 'cloudfront',
  label: 'infra.explorer.view.cloudfront.invalidations',
  about: 'infra.explorer.about.cloudfront',
  args: ['cloudfront', 'list-invalidations', '--distribution-id', '{distributionId}'],
  required: [
    {
      key: 'distributionId',
      label: 'infra.explorer.form.distributionId',
      placeholder: 'E1234ABCDEF',
      required: true,
    },
  ],
  pick: (json) =>
    asArray(asObj(asObj(json)['InvalidationList'])['Items']).map((i) => {
      const o = asObj(i)
      return {
        id: str(o['Id']),
        name: str(o['Id']),
        status: str(o['Status']),
        issued: formatWhen(str(o['CreateTime'])),
      }
    }),
  columns: [
    { key: 'name', label: 'infra.explorer.col.id', wide: true },
    { key: 'status', label: 'infra.explorer.col.state', width: '140px' },
    { key: 'issued', label: 'infra.explorer.col.issued', width: '120px' },
  ],
})

const apigatewayRestApis = listView({
  id: 'apigateway.restApis',
  service: 'apigateway',
  label: 'infra.explorer.view.apigateway.restApis',
  about: 'infra.explorer.about.apigateway',
  // Bảng này CHỈ có REST API (v1). HTTP/WebSocket API (v2) là view anh em — nói ra
  // ở đây thay vì để bảng trống tự nhận là "không có API nào".
  notice: 'infra.explorer.notice.apigatewayRestOnly',
  args: ['apigateway', 'get-rest-apis'],
  pick: (json) =>
    asArray(asObj(json)['items']).map((i) => {
      const o = asObj(i)
      return {
        id: str(o['id']),
        name: str(o['name']),
        endpoint: str(asArray(asObj(o['endpointConfiguration'])['types'])[0]),
        description: str(o['description']),
        created: epochWhen(o['createdDate']),
      }
    }),
  columns: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'endpoint', label: 'infra.explorer.col.endpointType', width: '110px' },
    { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
  ],
  full: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'id', label: 'infra.explorer.col.id', width: '160px' },
    { key: 'endpoint', label: 'infra.explorer.col.endpointType', width: '110px' },
    { key: 'description', label: 'infra.explorer.col.description', wide: true },
    { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
  ],
  consoleUrl: (row, ctx) =>
    `https://console.aws.amazon.com/apigateway/home?region=${encodeURIComponent(
      ctx.region || 'us-east-1',
    )}#/apis/${encodeURIComponent(row['id'] ?? '')}`,
})

const apigatewayHttpApis = listView({
  id: 'apigatewayv2.httpApis',
  // `service` là 'apigateway' chứ KHÔNG phải 'apigatewayv2': cột trái gom view
  // theo `service` của DANH MỤC, mà danh mục chỉ có một mục "API Gateway". Để
  // 'apigatewayv2' thì view này không xuất hiện ở đâu cả — nó mồ côi.
  service: 'apigateway',
  label: 'infra.explorer.view.apigatewayv2.httpApis',
  about: 'infra.explorer.about.apigatewayv2',
  args: ['apigatewayv2', 'get-apis'],
  pick: (json) =>
    asArray(asObj(json)['Items']).map((i) => {
      const o = asObj(i)
      return {
        id: str(o['ApiId']),
        name: str(o['Name']),
        protocol: str(o['ProtocolType']),
        endpoint: str(o['ApiEndpoint']),
        created: formatWhen(str(o['CreatedDate'])),
      }
    }),
  columns: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'protocol', label: 'infra.explorer.col.protocol', width: '110px' },
    { key: 'endpoint', label: 'infra.explorer.col.endpoint', wide: true },
  ],
  full: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'id', label: 'infra.explorer.col.id', width: '140px' },
    { key: 'protocol', label: 'infra.explorer.col.protocol', width: '110px' },
    { key: 'endpoint', label: 'infra.explorer.col.endpoint', wide: true },
    { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
  ],
  consoleUrl: (row, ctx) => {
    const r = encodeURIComponent(ctx.region || 'us-east-1')
    const id = encodeURIComponent(row['id'] ?? '')
    return `https://console.aws.amazon.com/apigateway/main/apis/${id}/routes?api=${id}&region=${r}`
  },
})

const acmCertificates = listView({
  id: 'acm.certificates',
  service: 'acm',
  label: 'infra.explorer.view.acm.certificates',
  about: 'infra.explorer.about.acm',
  // Cảnh báo này là lý do chính người dùng nhìn thấy bảng trống: chứng chỉ cho
  // CloudFront PHẢI ở `us-east-1`, còn chứng chỉ cho ALB thì phải CÙNG region với
  // ALB. Không nói ra thì "không có chứng chỉ nào" là một câu sai.
  notice: 'infra.explorer.notice.acmRegion',
  args: ['acm', 'list-certificates'],
  pick: (json) =>
    asArray(asObj(json)['CertificateSummaryList']).map((c) => {
      const o = asObj(c)
      const arn = str(o['CertificateArn'])
      return {
        id: arn,
        arn,
        name: str(o['DomainName']),
        status: str(o['Status']),
        type: str(o['Type']),
        algorithm: str(o['KeyAlgorithm']),
        inUse: asArray(o['InUseBy']).length > 0 ? 'yes' : 'no',
        // `list-certificates` KHÔNG trả ngày hết hạn (API không có trường đó).
        // Cột này để trống ở bảng và chỉ có số khi bấm vào dòng (xem `detail`).
        expires: formatWhen(str(o['NotAfter'])),
      }
    }),
  // Ngày hết hạn đến từ `describe-certificate` — một lời gọi cho MỘT dòng, chỉ
  // chạy khi người dùng bấm. Bảng không tự gọi N lần cho N chứng chỉ.
  detail: ['acm', 'describe-certificate', '--certificate-arn', '{arn}'],
  columns: [
    { key: 'name', label: 'infra.explorer.col.domain', wide: true },
    { key: 'status', label: 'infra.explorer.col.state', width: '140px' },
    { key: 'inUse', label: 'infra.explorer.col.inUse', width: '90px' },
  ],
  full: [
    { key: 'name', label: 'infra.explorer.col.domain', wide: true },
    { key: 'arn', label: 'infra.explorer.col.arn', wide: true },
    { key: 'type', label: 'infra.explorer.col.type', width: '110px' },
    { key: 'algorithm', label: 'infra.explorer.col.algorithm', width: '120px' },
    { key: 'status', label: 'infra.explorer.col.state', width: '140px' },
    { key: 'inUse', label: 'infra.explorer.col.inUse', width: '90px' },
  ],
  consoleUrl: (row, ctx) =>
    `https://${ctx.region || 'us-east-1'}.console.aws.amazon.com/acm/home?region=${encodeURIComponent(
      ctx.region || 'us-east-1',
    )}#/certificates/${encodeURIComponent(row['arn'] ?? row['id'] ?? '')}`,
})

const route53Records = listView({
  id: 'route53.records',
  service: 'route53',
  label: 'infra.explorer.view.route53.records',
  about: 'infra.explorer.about.route53',
  args: ['route53', 'list-resource-record-sets', '--hosted-zone-id', '{zoneId}'],
  required: [
    {
      key: 'zoneId',
      label: 'infra.explorer.form.zoneId',
      placeholder: 'Z1234ABCDEF',
      required: true,
    },
  ],
  pick: (json) =>
    asArray(asObj(json)['ResourceRecordSets']).map((r) => {
      const o = asObj(r)
      const alias = str(at(o, 'AliasTarget.DNSName'))
      const values = asArray(o['ResourceRecords']).map((x) => str(asObj(x)['Value']))
      const shown = values.slice(0, 3).join(', ')
      const name = str(o['Name']).replace(/\.$/, '')
      const type = str(o['Type'])
      return {
        // Một zone có thể có nhiều bản ghi CÙNG tên khác type (A và AAAA), nên
        // khoá dòng phải gồm cả type — trùng khoá là bảng tự nuốt một dòng.
        id: `${name}|${type}|${str(o['SetIdentifier'])}`,
        name,
        type,
        ttl: str(o['TTL']),
        weight: str(o['SetIdentifier']),
        value: alias !== '' ? alias : shown + (values.length > 3 ? ` (+${values.length - 3})` : ''),
      }
    }),
  columns: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'type', label: 'infra.explorer.col.type', width: '90px' },
    { key: 'value', label: 'infra.explorer.col.value', wide: true },
  ],
  full: [
    { key: 'name', label: 'infra.explorer.col.name', wide: true },
    { key: 'type', label: 'infra.explorer.col.type', width: '90px' },
    { key: 'ttl', label: 'infra.explorer.col.ttl', width: '80px' },
    { key: 'weight', label: 'infra.explorer.col.setIdentifier', width: '140px' },
    { key: 'value', label: 'infra.explorer.col.value', wide: true },
  ],
})

// ─── Mức "Danh sách" (task 3.8 / E10) ────────────────────────────────────────
//
// Mười dịch vụ, mỗi cái một lệnh `list-*`/`describe-*` và 3–4 cột. Đây là mức rẻ
// nhất trong ba mức hỗ trợ, và `infra-explorer.md` nói rõ vì sao nó quan trọng:
// "rẻ tới mức thêm được hàng chục dịch vụ mỗi đợt". Chúng chỉ ĐỌC — không hành
// động, không form — nên bề mặt tấn công bằng 0 ngoài đúng một lệnh `read`.

type ListColumn = { key: string; label: string; width?: string; wide?: boolean }

function listView(p: {
  id: string
  service: string
  label: string
  about: string
  notice?: string
  args: readonly string[]
  pick: (json: unknown) => InfraRow[]
  columns: readonly ListColumn[]
  full?: readonly ListColumn[]
  consoleUrl?: (row: InfraRow, ctx: { region: string }) => string
  /** View cần tham số trước khi chạy (vd `route53.records` cần zone id). */
  required?: readonly InfraFormField[]
  /** Lệnh lấy chi tiết một dòng — view chỉ-đọc vẫn có thể có (ACM: ngày hết hạn). */
  detail?: readonly string[]
  actions?: readonly InfraRowAction[]
  probe?: readonly string[]
}): InfraViewSpec {
  return {
    id: p.id,
    service: p.service,
    label: p.label,
    about: p.about,
    ...(p.notice ? { notice: p.notice } : {}),
    support: 'list',
    list: {
      args: p.args,
      pick: p.pick,
      tokenPath: 'NextToken',
      tokenFlag: '--starting-token',
      pageSize: 200,
      pageSizeFlag: '--max-items',
      ...(p.required ? { required: p.required } : {}),
    },
    columns: { simple: p.columns, full: p.full ?? p.columns },
    ...(p.consoleUrl ? { consoleUrl: p.consoleUrl } : {}),
    ...(p.detail ? { detail: { args: p.detail } } : {}),
    ...(p.actions ? { actions: p.actions } : {}),
    ...(p.probe ? { probe: { actions: p.probe } } : {}),
  }
}

const listViews: readonly InfraViewSpec[] = [
  listView({
    id: 'lambda.functions',
    service: 'lambda',
    label: 'infra.explorer.view.lambda.functions',
    about: 'infra.explorer.about.lambda',
    args: ['lambda', 'list-functions'],
    pick: (json) =>
      asArray(asObj(json)['Functions']).map((f) => {
        const o = asObj(f)
        return {
          id: str(o['FunctionName']),
          name: str(o['FunctionName']),
          runtime: str(o['Runtime']),
          memory: str(o['MemorySize']) ? `${str(o['MemorySize'])} MB` : '',
          timeout: str(o['Timeout']) ? `${str(o['Timeout'])} s` : '',
          modified: formatWhen(str(o['LastModified'])),
        }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'runtime', label: 'infra.explorer.col.runtime', width: '140px' },
      { key: 'memory', label: 'infra.explorer.col.memory', width: '90px' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'runtime', label: 'infra.explorer.col.runtime', width: '140px' },
      { key: 'memory', label: 'infra.explorer.col.memory', width: '90px' },
      { key: 'timeout', label: 'infra.explorer.col.timeout', width: '80px' },
      { key: 'modified', label: 'infra.explorer.col.modified', width: '120px' },
    ],
    consoleUrl: (row, ctx) =>
      `https://${ctx.region || 'us-east-1'}.console.aws.amazon.com/lambda/home?region=` +
      `${encodeURIComponent(ctx.region || 'us-east-1')}#/functions/${encodeURIComponent(row['name'] ?? '')}`,
  }),
  listView({
    id: 'rds.instances',
    service: 'rds',
    label: 'infra.explorer.view.rds.instances',
    about: 'infra.explorer.about.rds',
    args: ['rds', 'describe-db-instances'],
    pick: (json) =>
      asArray(asObj(json)['DBInstances']).map((d) => {
        const o = asObj(d)
        const host = str(at(o, 'Endpoint.Address'))
        const port = str(at(o, 'Endpoint.Port'))
        return {
          id: str(o['DBInstanceIdentifier']),
          name: str(o['DBInstanceIdentifier']),
          engine: [str(o['Engine']), str(o['EngineVersion'])].filter(Boolean).join(' '),
          class: str(o['DBInstanceClass']),
          status: str(o['DBInstanceStatus']),
          storage: str(o['AllocatedStorage']) ? `${str(o['AllocatedStorage'])} GB` : '',
          endpoint: host ? (port ? `${host}:${port}` : host) : '',
        }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'engine', label: 'infra.explorer.col.engine', width: '150px' },
      { key: 'class', label: 'infra.explorer.col.class', width: '120px' },
      { key: 'status', label: 'infra.explorer.col.state', width: '110px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'engine', label: 'infra.explorer.col.engine', width: '150px' },
      { key: 'class', label: 'infra.explorer.col.class', width: '120px' },
      { key: 'status', label: 'infra.explorer.col.state', width: '110px' },
      { key: 'storage', label: 'infra.explorer.col.storage', width: '90px' },
      { key: 'endpoint', label: 'infra.explorer.col.endpoint', wide: true },
    ],
  }),
  listView({
    id: 'dynamodb.tables',
    service: 'dynamodb',
    label: 'infra.explorer.view.dynamodb.tables',
    about: 'infra.explorer.about.dynamodb',
    args: ['dynamodb', 'list-tables'],
    pick: (json) =>
      asArray(asObj(json)['TableNames']).map((n) => ({ id: str(n), name: str(n) })),
    columns: [{ key: 'name', label: 'infra.explorer.col.name', wide: true }],
  }),
  listView({
    id: 'sqs.queues',
    service: 'sqs',
    label: 'infra.explorer.view.sqs.queues',
    about: 'infra.explorer.about.sqs',
    args: ['sqs', 'list-queues'],
    pick: (json) => {
      const o = asObj(json)
      const urls = asArray(o['QueueUrls']).map((u) => str(u))
      const single = str(o['QueueUrl'])
      if (!single && urls.length === 0) return []
      return (urls.length ? urls : [single]).map((u) => ({ id: u, name: arnTail(u), url: u }))
    },
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'url', label: 'infra.explorer.col.url', wide: true },
    ],
  }),
  listView({
    id: 'sns.topics',
    service: 'sns',
    label: 'infra.explorer.view.sns.topics',
    about: 'infra.explorer.about.sns',
    args: ['sns', 'list-topics'],
    pick: (json) =>
      asArray(asObj(json)['Topics']).map((t) => {
        const arn = str(asObj(t)['TopicArn'])
        return { id: arn, name: arnTail(arn, ':'), arn }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'arn', label: 'infra.explorer.col.arn', wide: true },
    ],
  }),
  listView({
    id: 'ecr.repositories',
    service: 'ecr',
    label: 'infra.explorer.view.ecr.repositories',
    about: 'infra.explorer.about.ecr',
    args: ['ecr', 'describe-repositories'],
    pick: (json) =>
      asArray(asObj(json)['repositories']).map((r) => {
        const o = asObj(r)
        return {
          id: str(o['repositoryName']),
          name: str(o['repositoryName']),
          uri: str(o['repositoryUri']),
          created: formatWhen(str(o['createdAt'])),
        }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'uri', label: 'infra.explorer.col.uri', wide: true },
      { key: 'created', label: 'infra.explorer.col.created', width: '120px' },
    ],
  }),
  listView({
    id: 'secretsmanager.secrets',
    service: 'secretsmanager',
    label: 'infra.explorer.view.secretsmanager.secrets',
    about: 'infra.explorer.about.secretsmanager',
    // CHỈ TÊN. `get-secret-value` không nằm trong allowlist `read` và không có
    // mặt ở đây: giá trị secret không được đi qua bảng, cache hay chat.
    args: ['secretsmanager', 'list-secrets'],
    pick: (json) =>
      asArray(asObj(json)['SecretList']).map((s) => {
        const o = asObj(s)
        return {
          id: str(o['Name']),
          name: str(o['Name']),
          description: str(o['Description']),
          changed: formatWhen(str(o['LastChangedDate'])),
        }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'description', label: 'infra.explorer.col.description', wide: true },
      { key: 'changed', label: 'infra.explorer.col.changed', width: '120px' },
    ],
  }),
  listView({
    id: 'cfn.stacks',
    service: 'cloudformation',
    label: 'infra.explorer.view.cfn.stacks',
    // Khoá `about` theo DỊCH VỤ (như mọi view khác), không theo view: thẻ
    // CloudFormation trong danh mục Dịch vụ đọc `about.<service id>`, và service
    // id ở đây là `cloudformation`. Trước 2026-09-14 chỗ này là `about.cfn`, nên
    // thẻ đó in ra một khoá i18n thô vì `about.cfn` là khoá duy nhất tồn tại.
    about: 'infra.explorer.about.cloudformation',
    args: ['cloudformation', 'list-stacks'],
    pick: (json) =>
      asArray(asObj(json)['StackSummaries'])
        .filter((s) => str(asObj(s)['StackStatus']) !== 'DELETE_COMPLETE')
        .map((s) => {
          const o = asObj(s)
          return {
            id: str(o['StackId']),
            name: str(o['StackName']),
            status: str(o['StackStatus']),
            updated: formatWhen(str(o['LastUpdatedTime']) || str(o['CreationTime'])),
          }
        }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'status', label: 'infra.explorer.col.state', width: '180px' },
      { key: 'updated', label: 'infra.explorer.col.modified', width: '120px' },
    ],
  }),
  listView({
    id: 'route53.zones',
    service: 'route53',
    label: 'infra.explorer.view.route53.zones',
    about: 'infra.explorer.about.route53',
    args: ['route53', 'list-hosted-zones'],
    pick: (json) =>
      asArray(asObj(json)['HostedZones']).map((z) => {
        const o = asObj(z)
        // `Id` có dạng `/hostedzone/Z123` — bỏ tiền tố để deep link và cột gọn.
        const id = str(o['Id']).replace(/^\/hostedzone\//, '')
        return {
          id,
          name: str(o['Name']).replace(/\.$/, ''),
          zoneId: id,
          private: str(at(o, 'Config.PrivateZone')) === 'true' ? 'yes' : 'no',
          records: str(o['ResourceRecordSetCount']),
        }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'zoneId', label: 'infra.explorer.col.id', width: '180px' },
      { key: 'records', label: 'infra.explorer.col.recordCount', width: '100px' },
    ],
    full: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'zoneId', label: 'infra.explorer.col.id', width: '180px' },
      { key: 'private', label: 'infra.explorer.col.privateZone', width: '110px' },
      { key: 'records', label: 'infra.explorer.col.recordCount', width: '100px' },
    ],
    // Xem bản ghi của một zone (Mốc 4, task 4.1). Đây là hành động MỞ VIEW, không
    // phải một lệnh: view con mới là chỗ gọi CLI, và nó tự đi qua cổng quyền.
    actions: [
      {
        id: 'route53.records',
        label: 'infra.explorer.action.viewRecords',
        consequence: 'infra.explorer.consequence.viewRecords',
        danger: false,
        confirm: 'none',
        opensView: { viewId: 'route53.records', values: { zoneId: 'id' } },
        args: [],
      },
    ],
    // Route53 là dịch vụ TOÀN CẦU: deep link không kèm region (task 3.4).
    consoleUrl: (row) =>
      `https://console.aws.amazon.com/route53/v2/hostedzones#ListRecordSets/${encodeURIComponent(
        row['id'] ?? '',
      )}`,
  }),
  listView({
    id: 'ecs.clusters',
    service: 'ecs',
    label: 'infra.explorer.view.ecs.clusters',
    about: 'infra.explorer.about.ecs',
    args: ['ecs', 'list-clusters'],
    pick: (json) =>
      asArray(asObj(json)['clusterArns']).map((a) => {
        const arn = str(a)
        return { id: arn, name: arnTail(arn), arn }
      }),
    columns: [
      { key: 'name', label: 'infra.explorer.col.name', wide: true },
      { key: 'arn', label: 'infra.explorer.col.arn', wide: true },
    ],
  }),
]

/** Toàn bộ view Explorer đang có. Thứ tự = thứ tự hiện trong danh mục Dịch vụ. */
export const AWS_RESOURCE_VIEWS: readonly InfraViewSpec[] = [
  s3Buckets,
  s3Objects,
  ec2Instances,
  // Mốc 4 (task 4.1). Đứng trước nhóm "Danh sách" vì chúng là màn có hành động,
  // và vì thứ tự này là thứ tự sidebar liệt kê view của một dịch vụ đã ghim.
  cloudfrontDistributions,
  cloudfrontInvalidations,
  apigatewayRestApis,
  apigatewayHttpApis,
  acmCertificates,
  route53Records,
  ...listViews,
]
