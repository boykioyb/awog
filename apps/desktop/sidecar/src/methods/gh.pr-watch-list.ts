// gh.prWatchList → danh sách PR đang theo dõi + trạng thái CI/review lần cuối
// quan sát được (docs/features/github-notifications.md).
//
// KHÔNG gọi GitHub: chỉ đọc ảnh chụp trên đĩa. Mở bell ra là phải thấy ngay, và
// việc hỏi mạng thuộc về `gh.prWatchPoll` (có sàn nhịp riêng).
import { register } from '../transport/rpc.js'
import { listWatchViews, type PrWatchView } from '../github/pr-watch.js'

interface Result {
  items: PrWatchView[]
}

register('gh.prWatchList', async (): Promise<Result> => {
  return { items: await listWatchViews() }
})
