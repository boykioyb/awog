// slack.threads.list → danh sách thread đang theo dõi. Chỉ đọc đĩa, không gọi
// Slack: mở app là có cây thread ngay, số liệu mới đến qua slack.poll.
import { registerSlack } from '../slack/rpc.js'
import { listThreads } from '../slack/store.js'
import type { SlackThread } from '../slack/types.js'

registerSlack('slack.threads.list', async (): Promise<{ threads: SlackThread[] }> => ({
  threads: await listThreads(),
}))
