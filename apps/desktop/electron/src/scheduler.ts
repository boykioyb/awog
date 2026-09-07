import { powerMonitor } from 'electron'
import { engine } from './engine'
import { log } from './logger'

// Bộ đếm giờ cho Scheduled Runs (ADR 0082).
//
// GIỚI HẠN CỐ Ý: lịch chỉ chạy khi app AWOG đang chạy. Không có daemon, không có
// launchd/Task Scheduler — đóng app là không có gì bấm cò. UI phải nói thẳng
// điều này (trang Schedules có banner), đừng để người dùng tưởng nó là cron hệ
// thống.
//
// Vì sao TICK THƯA thay vì hẹn giờ dài tới đúng mốc: `setTimeout` dài KHÔNG sống
// qua giấc ngủ của máy — timer bị đóng băng cùng tiến trình, nên một cái hẹn 8
// tiếng nữa sẽ nổ muộn đúng bằng thời gian máy ngủ. Quét lại mỗi 30 giây rồi so
// `nextRunAt` với đồng hồ thật thì ngủ bao lâu cũng không sai; đổi giờ mùa cũng
// vậy vì mốc so sánh là epoch tuyệt đối.
//
// Toàn bộ phần "tới hạn thì làm gì" nằm ở sidecar (schedules/runner.ts). Ở đây
// chỉ có nhịp đập, nên host không cần biết gì về lịch — và không truyền "bây giờ
// là mấy giờ" xuống, để không ai đẩy được thời gian ép một lịch chạy sớm.

const TICK_MS = 30_000

// Hoãn nhịp đầu tiên: engine vừa spawn còn đang nạp, và một lịch quá hạn sẽ chạy
// bù ngay khi tick đầu chạm tới — không cần đua với lúc app đang khởi động.
const FIRST_TICK_DELAY_MS = 15_000

let timer: ReturnType<typeof setInterval> | null = null
let firstTick: ReturnType<typeof setTimeout> | null = null
let resumeHandler: (() => void) | null = null

function tick(reason: 'timer' | 'resume'): void {
  engine.request('schedules.tick', {}).then(
    (res) => {
      const r = res as { fired?: string[]; skipped?: string[] } | null
      if (r?.fired?.length || r?.skipped?.length) {
        log.info('scheduler tick', { reason, fired: r.fired, skipped: r.skipped })
      }
    },
    (err: unknown) => {
      // Engine chưa sẵn sàng / vừa restart: nhịp sau sẽ bắt lại. Log mức warn để
      // một engine chết hẳn vẫn để lại dấu vết, không nuốt lỗi.
      const message = err instanceof Error ? err.message : String(err)
      log.warn('scheduler tick failed', { reason, message })
    },
  )
}

export function startScheduler(): void {
  if (timer) return
  firstTick = setTimeout(() => {
    firstTick = null
    tick('timer')
    timer = setInterval(() => tick('timer'), TICK_MS)
  }, FIRST_TICK_DELAY_MS)

  // Máy vừa thức dậy → quét ngay thay vì đợi hết nhịp 30 giây, để lần chạy bù
  // xảy ra lúc người dùng vừa mở nắp máy chứ không phải nửa phút sau.
  resumeHandler = () => tick('resume')
  powerMonitor.on('resume', resumeHandler)
}

export function stopScheduler(): void {
  if (firstTick) {
    clearTimeout(firstTick)
    firstTick = null
  }
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (resumeHandler) {
    powerMonitor.off('resume', resumeHandler)
    resumeHandler = null
  }
}
