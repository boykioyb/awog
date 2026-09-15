// Bảng giá TĨNH cho phần "mỗi phát hiện kèm số tiền" của việc 7.2.
//
// ĐÂY LÀ ƯỚC LƯỢNG, VÀ PHẢI ĐƯỢC GỌI ĐÚNG TÊN Ở MỌI TẦNG. Con số ở đây là giá niêm
// yết on-demand của `us-east-1`, chép tay vào ngày ghi ở `PRICING_AS_OF`. Nó KHÔNG
// phải hoá đơn của người dùng, và sai lệch so với thực tế theo ít nhất bốn đường:
//   · vùng khác có giá khác (Tokyo/Singapore đắt hơn `us-east-1` đáng kể);
//   · hợp đồng riêng, EDP, Savings Plans, Reserved Instances đều không thấy được ở đây;
//   · giá AWS đổi, còn bảng này thì không tự đổi;
//   · dung lượng snapshot tính theo phần TĂNG THÊM, không theo kích thước volume.
// Vì vậy mọi số tiền đi ra từ đây mang cờ `estimated: true` và UI phải nói "ước
// lượng" — không có đường nào để một con số ở đây hiện ra như số tiền đã chốt.
//
// VÌ SAO KHÔNG GỌI PRICING API. `pricing get-products` trả đúng giá theo vùng, nhưng
// nó là một bề mặt mạng nữa phải allowlist, trả về hàng trăm KB JSON cho mỗi SKU, và
// vẫn không biết gì về chiết khấu hợp đồng — tức là vẫn là ước lượng, chỉ đắt hơn để
// lấy. Cùng lý do `INSIGHTS_USD_PER_GB` trong `aws/logs.ts` là một hằng số chép tay.
//
// KHI SỬA BẢNG NÀY: đổi luôn `PRICING_AS_OF`. Ngày đó hiện lên UI; một bảng giá không
// có ngày là một bảng giá không ai kiểm được.

/** Ngày các con số dưới đây được chép từ trang giá của AWS. Hiện lên UI. */
export const PRICING_AS_OF = '2026-09-15'

/** Vùng mà bảng này lấy giá. Mọi vùng khác ⇒ con số chỉ còn là bậc độ lớn. */
export const PRICING_REGION = 'us-east-1'

const HOURS_PER_MONTH = 730

/**
 * Elastic IP KHÔNG gắn vào đâu: $0.005/giờ.
 *
 * ⚠ Từ 2024-02-01 AWS tính tiền MỌI IPv4 công cộng, kể cả IP đang gắn — nhưng phần
 * "đang gắn" không phải lãng phí, nên chỉ IP rỗi mới được đếm ở đây.
 */
export const EIP_IDLE_USD_PER_HOUR = 0.005

/** EBS `gp3` $0.08/GB-tháng; `gp2` $0.10. Loại khác rơi về `gp3` (ước lượng thấp). */
export const EBS_USD_PER_GB_MONTH: Readonly<Record<string, number>> = {
  gp3: 0.08,
  gp2: 0.1,
  io1: 0.125,
  io2: 0.125,
  st1: 0.045,
  sc1: 0.015,
  standard: 0.05,
}

/** Snapshot EBS: $0.05/GB-tháng cho phần tăng thêm. */
export const SNAPSHOT_USD_PER_GB_MONTH = 0.05

/** NAT Gateway: $0.045/giờ, CHƯA kể $0.045/GB dữ liệu đi qua. */
export const NAT_USD_PER_HOUR = 0.045

/** ALB/NLB: $0.0225/giờ, CHƯA kể LCU. */
export const LB_USD_PER_HOUR = 0.0225

/**
 * CloudWatch Logs lưu trữ: $0.03/GB-tháng.
 *
 * Dùng cho log group KHÔNG đặt hạn lưu: chi phí của nó không phải một con số cố định
 * mà là một con số TĂNG MÃI. Ước lượng ở đây là tiền của phần ĐANG lưu, và phần đó
 * lớn dần mỗi ngày — đó mới là lý do phát hiện này đáng sửa.
 */
export const LOGS_STORAGE_USD_PER_GB_MONTH = 0.03

/**
 * Giá on-demand theo giờ của vài họ instance phổ biến, cho phát hiện "instance idle".
 *
 * CỐ Ý KHÔNG ĐẦY ĐỦ. Bảng đủ mọi instance type là vài nghìn dòng và sẽ cũ trong một
 * tháng. Type không có trong bảng ⇒ phát hiện vẫn được báo, nhưng KHÔNG kèm số tiền
 * (`monthlyUsd: null`) — im lặng đoán một con số cho `m7i.48xlarge` bằng giá
 * `t3.micro` còn tệ hơn là không nói gì.
 */
export const EC2_USD_PER_HOUR: Readonly<Record<string, number>> = {
  't2.micro': 0.0116,
  't2.small': 0.023,
  't2.medium': 0.0464,
  't3.micro': 0.0104,
  't3.small': 0.0208,
  't3.medium': 0.0416,
  't3.large': 0.0832,
  't3a.medium': 0.0376,
  't4g.micro': 0.0084,
  't4g.small': 0.0168,
  't4g.medium': 0.0336,
  'm5.large': 0.096,
  'm5.xlarge': 0.192,
  'm5.2xlarge': 0.384,
  'm6i.large': 0.096,
  'm6i.xlarge': 0.192,
  'm7i.large': 0.1008,
  'c5.large': 0.085,
  'c5.xlarge': 0.17,
  'c6i.large': 0.085,
  'c6i.xlarge': 0.17,
  'r5.large': 0.126,
  'r5.xlarge': 0.252,
  'r6i.large': 0.126,
  'r6i.xlarge': 0.252,
}

/** Giờ → tháng, làm tròn 2 chữ số. Một nơi duy nhất để mọi phát hiện quy đổi giống nhau. */
export function monthlyFromHourly(usdPerHour: number): number {
  return Math.round(usdPerHour * HOURS_PER_MONTH * 100) / 100
}

/** Giá tháng của một volume EBS. Loại lạ ⇒ dùng `gp3` (ước lượng THẤP, không thổi lên). */
export function ebsMonthlyUsd(volumeType: string, sizeGb: number): number {
  const rate = EBS_USD_PER_GB_MONTH[volumeType] ?? EBS_USD_PER_GB_MONTH.gp3 ?? 0.08
  return Math.round(rate * sizeGb * 100) / 100
}

/** Giá tháng của một instance. `null` khi type không có trong bảng — xem `EC2_USD_PER_HOUR`. */
export function ec2MonthlyUsd(instanceType: string): number | null {
  const rate = EC2_USD_PER_HOUR[instanceType]
  return rate === undefined ? null : monthlyFromHourly(rate)
}
