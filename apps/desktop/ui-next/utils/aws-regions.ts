// Danh sách region AWS + luật "tự dò" cho form sửa profile.
//
// VÌ SAO CẦN. Trước đây `Region` là ô nhập tay trống trơn: người dùng phải nhớ
// đúng chuỗi `ap-southeast-1`, gõ sai một ký tự thì profile vẫn lưu, vẫn hiện
// trong danh sách, và chỉ lộ ra khi có lệnh chạy (`Could not connect to the
// endpoint URL`). Danh sách này biến việc chọn region thành một cú bấm; ô nhập
// tay vẫn còn cho region mới/chưa có trong danh sách (xem `AwsRegionField.vue`).
//
// KHÔNG có API nào để AWS "tự dò" region từ credential: region là khái niệm phía
// client (nó chỉ là một chuỗi để chọn endpoint). Ba nguồn thật sự dò được, theo
// thứ tự ưu tiên, nằm ở `detectRegion()`: chính profile đang sửa → ngữ cảnh đang
// ghim của app (thanh ngữ cảnh) → profile `default` của máy.
//
// Danh sách CỐ Ý không đầy đủ tuyệt đối: AWS mở region mới vài lần một năm, và
// một lựa chọn sai trong dropdown tệ hơn không có lựa chọn đó. Region lạ ⇒ dùng
// ô nhập tay.

/** Region thương mại + GovCloud + China + ISO, thứ tự theo nhóm như tài liệu AWS. */
export const AWS_REGIONS: readonly string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ca-west-1',
  'mx-central-1',
  'sa-east-1',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'af-south-1',
  'il-central-1',
  'me-central-1',
  'me-south-1',
  'ap-east-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-south-1',
  'ap-south-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-southeast-5',
  'ap-southeast-7',
  'cn-north-1',
  'cn-northwest-1',
  'us-gov-east-1',
  'us-gov-west-1',
  'us-iso-east-1',
  'us-iso-west-1',
  'us-isob-east-1',
  'us-isob-west-1',
  'eu-isoe-west-1',
]

const REGION_SET: ReadonlySet<string> = new Set(AWS_REGIONS)

export function isKnownRegion(region: string): boolean {
  return REGION_SET.has(region.trim())
}

/** Nguồn của giá trị vừa dò được — UI dịch thành câu giải thích cho người dùng. */
export type RegionSource = 'profile' | 'app' | 'default'

export type RegionDetection = { region: string; from: RegionSource }

/**
 * Dò region cho một profile theo ba nguồn, dừng ở nguồn đầu tiên có giá trị.
 *
 * Trả `null` khi cả ba đều rỗng — bịa ra một region lúc đó là ghi vào
 * `~/.aws/config` một giá trị người dùng chưa từng chọn.
 */
export function detectRegion(input: {
  profileRegion?: string | undefined
  appRegion?: string | undefined
  defaultProfileRegion?: string | undefined
}): RegionDetection | null {
  const candidates: [RegionSource, string | undefined][] = [
    ['profile', input.profileRegion],
    ['app', input.appRegion],
    ['default', input.defaultProfileRegion],
  ]
  for (const [from, raw] of candidates) {
    const region = raw?.trim() ?? ''
    if (region !== '') return { region, from }
  }
  return null
}
