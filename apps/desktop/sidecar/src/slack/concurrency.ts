// Chạy `fn` trên từng phần tử với tối đa `limit` lời gọi cùng lúc, giữ thứ tự
// kết quả. Slack Web API rate-limit theo method (tier 3–4 ≈ 50–100 lần/phút);
// bắn cả trăm `users.info` một lượt là tự chuốc 429.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next
      next += 1
      // eslint-disable-next-line no-await-in-loop -- mỗi worker xử lý tuần tự phần của mình
      results[i] = await fn(items[i] as T, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
