// Bảng ca cho lớp CHE thông tin hạ tầng (mốc 6.5).
//
// ĐÂY LÀ LỚP DUY NHẤT ĐỨNG GIỮA "một playbook" VÀ "một tệp ai cũng đọc được", nên
// bảng ca phải phủ HẾT các nhánh, kể cả nhánh của công tắc riêng `bucketsDomains`
// — một công tắc chỉ có hai trạng thái thì trạng thái không ai test chính là trạng
// thái sai. Ba nhóm:
//   1. `enabled` (mặc định BẬT): account id · ARN · endpoint/private IP.
//   2. `bucketsDomains` (mặc định TẮT): bốn hình của tham chiếu S3 + tên miền nội bộ.
//   3. THỨ TỰ: bucket/domain trước ARN, endpoint trước ARN/account. Sai thứ tự thì
//      công tắc riêng mất tác dụng dù mọi luật đều đúng.
import { describe, expect, it } from 'vitest'
import {
  MASKED_BUCKET,
  MASKED_DOMAIN,
  MASKED_ENDPOINT,
  maskAccountIds,
  maskArns,
  maskBucketsAndDomains,
  maskEndpoints,
  maskText,
} from '../mask.js'

describe('maskAccountIds', () => {
  it('giữ 4 số đầu, che phần còn lại', () => {
    expect(maskAccountIds('account 229012345678')).toBe('account 2290********')
  })

  it('không cắt vào giữa một định danh dài hơn', () => {
    expect(maskAccountIds('i-0123456789ab')).toBe('i-0123456789ab')
    expect(maskAccountIds('1.229012345678')).toBe('1.229012345678')
  })

  it('che nhiều lần trong cùng một chuỗi', () => {
    expect(maskAccountIds('229012345678 vs 123456789012')).toBe('2290******** vs 1234********')
  })

  it('che cả khi đứng cuối câu — dấu chấm KHÔNG phải dấu thập phân', () => {
    // Bản đầu của luật này chặn cả `[\w.]` ở lookahead, nên account id đứng trước
    // dấu chấm kết câu đi qua nguyên vẹn.
    expect(maskAccountIds('runs in account 229012345678.')).toBe('runs in account 2290********.')
  })
})

describe('maskArns', () => {
  it('rút ARN còn phần resource', () => {
    expect(maskArns('arn:aws:ecs:ap-southeast-1:229012345678:service/checkout')).toBe(
      '…:service/checkout',
    )
  })

  it('giữ nguyên resource có dấu hai chấm (log group)', () => {
    expect(
      maskArns('arn:aws:logs:ap-southeast-1:229012345678:log-group:/aws/ecs/checkout:log-stream:x'),
    ).toBe('…:log-group:/aws/ecs/checkout:log-stream:x')
  })

  it('không nuốt dấu câu đóng của câu văn quanh ARN', () => {
    expect(maskArns('see (arn:aws:iam::229012345678:role/Admin).')).toBe('see (…:role/Admin).')
  })
})

describe('maskEndpoints', () => {
  it('che private IP kèm cổng', () => {
    expect(maskEndpoints('connect to 10.0.0.5:5432 now')).toBe(`connect to ${MASKED_ENDPOINT} now`)
    expect(maskEndpoints('192.168.1.10')).toBe(MASKED_ENDPOINT)
    expect(maskEndpoints('172.16.0.9')).toBe(MASKED_ENDPOINT)
    expect(maskEndpoints('172.31.255.4')).toBe(MASKED_ENDPOINT)
    expect(maskEndpoints('127.0.0.1')).toBe(MASKED_ENDPOINT)
    expect(maskEndpoints('169.254.169.254')).toBe(MASKED_ENDPOINT)
  })

  it('KHÔNG che địa chỉ công khai', () => {
    expect(maskEndpoints('8.8.8.8 and 172.32.0.1 and 11.0.0.5')).toBe(
      '8.8.8.8 and 172.32.0.1 and 11.0.0.5',
    )
  })

  it('che cả khi đứng cuối câu', () => {
    expect(maskEndpoints('the replica lives at 10.0.0.5.')).toBe(
      `the replica lives at ${MASKED_ENDPOINT}.`,
    )
  })

  it('che host endpoint AWS', () => {
    expect(maskEndpoints('db.prod.ap-southeast-1.rds.amazonaws.com')).toBe(MASKED_ENDPOINT)
  })

  it('cố ý ĐỂ YÊN host S3 — tên bucket thuộc công tắc riêng', () => {
    expect(maskEndpoints('checkout-assets.s3.us-east-1.amazonaws.com')).toBe(
      'checkout-assets.s3.us-east-1.amazonaws.com',
    )
  })

  it('che tên miền nội bộ của cluster', () => {
    expect(maskEndpoints('ip-10-0-0-5.compute.internal')).toBe(MASKED_ENDPOINT)
    expect(maskEndpoints('api.default.svc.cluster.local')).toBe(MASKED_ENDPOINT)
  })
})

describe('maskBucketsAndDomains (công tắc RIÊNG)', () => {
  it('bốn hình của một tham chiếu S3', () => {
    expect(maskBucketsAndDomains('s3://checkout-assets/releases/x.zip')).toBe(
      `s3://${MASKED_BUCKET}/releases/x.zip`,
    )
    expect(maskBucketsAndDomains('arn:aws:s3:::checkout-assets')).toBe(`arn:s3:::${MASKED_BUCKET}`)
    expect(maskBucketsAndDomains('checkout-assets.s3.us-east-1.amazonaws.com')).toBe(
      `s3://${MASKED_BUCKET}`,
    )
    expect(maskBucketsAndDomains('s3.ap-southeast-1.amazonaws.com/checkout-assets')).toBe(
      `s3.ap-southeast-1.amazonaws.com/${MASKED_BUCKET}`,
    )
  })

  it('che tên miền nội bộ, KHÔNG che tên miền công khai', () => {
    expect(maskBucketsAndDomains('deploy.internal.corp')).toBe(MASKED_DOMAIN)
    expect(maskBucketsAndDomains('docs.github.com')).toBe('docs.github.com')
  })
})

describe('maskText — mặc định BẬT, bucket/domain mặc định TẮT', () => {
  it('che account id · ARN · endpoint khi không ai nói gì', () => {
    const out = maskText('arn:aws:ecs:ap-southeast-1:229012345678:service/checkout at 10.0.0.5')
    expect(out).toBe('…:service/checkout at <endpoint nội bộ>')
  })

  it('để YÊN tên bucket khi công tắc riêng chưa bật', () => {
    expect(maskText('s3://checkout-assets/x')).toBe('s3://checkout-assets/x')
  })

  it('bật công tắc riêng thì che bucket nhưng vẫn che phần còn lại', () => {
    const out = maskText('arn:aws:s3:::checkout-assets on 229012345678', { bucketsDomains: true })
    expect(out).toBe(`arn:s3:::${MASKED_BUCKET} on 2290********`)
  })

  it('tắt hẳn lớp che thì chỉ còn công tắc bucket/domain tác dụng', () => {
    const out = maskText('229012345678 s3://checkout-assets 10.0.0.5', {
      enabled: false,
      bucketsDomains: true,
    })
    expect(out).toBe(`229012345678 s3://${MASKED_BUCKET} 10.0.0.5`)
  })

  it('tắt cả hai thì chuỗi đi qua nguyên vẹn', () => {
    const s = 'arn:aws:ecs:ap-southeast-1:229012345678:service/checkout at 10.0.0.5'
    expect(maskText(s, { enabled: false, bucketsDomains: false })).toBe(s)
  })

  it('THỨ TỰ: ARN S3 phải bị công tắc bucket xử lý TRƯỚC khi ARN bị rút gọn', () => {
    // Nếu `maskArns` chạy trước, chuỗi thành `…:checkout-assets` — mất dấu "đây là
    // bucket" và công tắc riêng không còn gì để bật/tắt.
    expect(maskText('arn:aws:s3:::checkout-assets', { bucketsDomains: true })).toBe(
      `arn:s3:::${MASKED_BUCKET}`,
    )
  })

  it('THỨ TỰ: placeholder không bị luật sau chạm vào', () => {
    // `<endpoint nội bộ>` chứa dấu cách và `<`; nếu chạy ngược lại thì luật account
    // id / ARN có thể khớp vào chính placeholder.
    expect(maskText('rds at 10.0.0.5 for 229012345678')).toBe(
      `rds at ${MASKED_ENDPOINT} for 2290********`,
    )
  })
})
