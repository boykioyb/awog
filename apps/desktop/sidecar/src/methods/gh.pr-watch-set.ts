// gh.prWatchSet → bật/tắt theo dõi một Pull Request
// (docs/features/github-notifications.md).
//
// Một method cho cả hai chiều (`watch: true|false`) vì UI là một cái công tắc:
// tách thành add/remove chỉ để hai handler cùng đọc-sửa-ghi một file.
//
// BẢO MẬT: mọi trường đều đi qua schema trước khi chạm đĩa hay chạm `gh`.
//   • `repo` phải đúng charset owner/name — nó sẽ thành biến GraphQL và thành một
//     đoạn của đường dẫn REST khi lấy log job.
//   • `url` chỉ nhận https://github.com/… : UI đưa thẳng chuỗi này cho
//     openExternal, nên một url tuỳ ý ở đây là một cú click mở link lạ.
//   • `sessionId` bị chặn charset để không có gì hình dạng-đường-dẫn lọt vào file
//     trạng thái rồi quay lại làm khoá tra cứu.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { REPO_RE } from '../github/pr-status.js'
import { addWatch, removeWatch, WatchLimitError } from '../github/pr-watch-store.js'
import { listWatchViews, pollPrWatch, type PrWatchView } from '../github/pr-watch.js'

// Engine session id (`ses-…`) — chỉ chữ, số, `.`, `_`, `-`.
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

const Params = z.object({
  repo: z.string().regex(REPO_RE),
  number: z.number().int().positive(),
  watch: z.boolean(),
  title: z.string().max(300).optional(),
  url: z
    .string()
    .max(300)
    .refine((u) => u === '' || u.startsWith('https://github.com/'), 'url must be on github.com')
    .optional(),
  account: z.string().max(39).optional(),
  projectId: z.string().max(128).nullable().optional(),
  // Phiên sẽ nhận tin khi PR có biến động. null = chỉ theo dõi trên UI.
  sessionId: z.string().regex(SESSION_ID_RE).nullable().optional(),
})

interface Result {
  items: PrWatchView[]
}

register('gh.prWatchSet', async (raw): Promise<Result> => {
  const p = Params.parse(raw)
  if (!p.watch) {
    await removeWatch(p.repo, p.number)
    return { items: await listWatchViews() }
  }
  try {
    await addWatch({
      repo: p.repo,
      number: p.number,
      title: p.title,
      url: p.url,
      account: p.account,
      projectId: p.projectId,
      sessionId: p.sessionId,
    })
  } catch (err) {
    if (err instanceof WatchLimitError) throw new RpcError(-32602, err.message)
    throw err
  }
  // Vòng poll ngay lập tức (bỏ qua sàn nhịp): người dùng vừa bấm theo dõi thì phải
  // thấy trạng thái CI hiện tại, chứ không phải một dòng trống tới tận nhịp sau.
  // Vòng này cũng chính là lúc lập MỐC NỀN cho entry mới — nên nó im lặng.
  const result = await pollPrWatch(true)
  return { items: result.items }
})
