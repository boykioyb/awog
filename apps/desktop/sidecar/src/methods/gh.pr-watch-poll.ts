// gh.prWatchPoll → một vòng hỏi trạng thái cho toàn bộ PR đang theo dõi
// (docs/features/github-notifications.md).
//
// NHỊP DO RENDERER LÁI, nhưng SÀN THÌ Ở ĐÂY. Renderer gọi method này trong đúng
// nhịp của hộp thư thông báo (useGhNotifications) thay vì dựng timer thứ hai; còn
// sidecar áp lại sàn 60s (pollPrWatch) vì RPC là bề mặt công khai — cửa sổ popout,
// nút làm mới, hay một lần reload đều gọi được nó.
//
// Vòng bị sàn chặn KHÔNG phải lỗi: `throttled: true` kèm ảnh chụp lần trước.
import { register } from '../transport/rpc.js'
import { pollPrWatch, type PrWatchPollResult } from '../github/pr-watch.js'

register('gh.prWatchPoll', async (): Promise<PrWatchPollResult> => {
  return pollPrWatch(false)
})
