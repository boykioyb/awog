// Gợi ý dòng công cho một ngày — "Hôm nay bạn đã làm gì".
//
// Hai nguồn DUY NHẤT, cả hai đều là thứ AWOG tự đo được: phiên chat có hoạt động
// trong ngày, và task tạo trong ngày. Không suy từ git log, không đoán từ lịch, không
// hỏi model — một gợi ý sai còn tệ hơn không gợi ý, vì người dùng sẽ bấm rồi đẩy nó
// lên PMS như giờ công thật.
//
// ⚠ CỐ Ý không có trường `hours` trong kết quả. AWOG không biết người dùng bỏ bao lâu
// cho một phiên; con số duy nhất suy được là khoảng cách giữa hai mốc thời gian, mà
// khoảng cách đó đo *thời gian phiên tồn tại*, không đo *công sức* (phiên mở qua đêm
// sẽ ra 9 tiếng). Người dùng tự đặt giờ bằng nút ± rồi đi qua cổng `addEntry` như mọi
// dòng khác — trần giờ/ngày chỉ có một cửa vào, không mở cửa thứ hai ở đây.
//
// ⚠ Chỉ dự án ĐÃ NỐI PMS (`LogtimeLink.pmsProjectId`) mới được gợi ý. Không phải để
// tiết kiệm chỗ: một gợi ý của dự án chưa nối là một lời mời bấm mà kết quả không đẩy
// đi đâu được, và bảng gợi ý sẽ đầy những hàng đúng-đắn-nhưng-vô-dụng. Việc đo được
// của dự án chưa nối vẫn được ĐẾM (`skippedUntracked`) để panel nói ra chứ không im
// lặng bỏ sót — người dùng cần biết hôm đó mình có làm gì khác.

import type { LogtimeSuggestion, SessionSummary, Task } from '../types/shared.js'
import { localDayKey } from '../usage/rollup.js'

export interface SuggestionInput {
  // YYYY-MM-DD, giờ ĐỊA PHƯƠNG.
  date: string
  sessions: SessionSummary[]
  tasks: Task[]
  // projectKey của những dự án ĐÃ NỐI PMS (`LogtimeLink.pmsProjectId` khác rỗng). Chỉ
  // việc thuộc các dự án này mới thành gợi ý — dự án chưa nối cho ra dòng không đẩy
  // được. `projectKey` của logtime CHÍNH LÀ `Project.id` (xem LogtimeSetup), nên so
  // trực tiếp với `session.projectId` / `task.projectId`.
  trackedProjectKeys: Set<string>
}

export interface SuggestionResult {
  suggestions: LogtimeSuggestion[]
  // Số việc đo được nhưng KHÔNG gợi ý được vì phiên không thuộc dự án nào. Không có
  // projectKey thì không dựng nổi một dòng công (`LogtimeEntry.projectKey` bắt buộc),
  // nên bỏ qua là đường duy nhất — nhưng phải trả con số về cho panel nói ra, không
  // thì bảng gợi ý im lặng bỏ sót và trông như bị hỏng.
  skippedNoProject: number
  // Số việc CÓ dự án nhưng dự án đó CHƯA nối PMS. Cũng phải đếm rồi nói ra vì cùng lý
  // do: giấu đi thì người dùng tưởng hôm đó mình không làm gì. Tách khỏi
  // `skippedNoProject` vì cách xử lý khác nhau — cái này nối PMS ở Thiết lập là hết.
  skippedUntracked: number
}

// `at` là chuỗi ISO. Chuỗi hỏng ⇒ Date.parse ra NaN ⇒ localDayKey ra "NaN-NaN-NaN"
// ⇒ không khớp ngày nào. Hỏng thì loại, chứ không rơi nhầm vào hôm nay.
function isOnDay(at: string | undefined, date: string): boolean {
  return typeof at === 'string' && localDayKey(Date.parse(at)) === date
}

// `aboutGhUrl` là "issue/PR này sinh ra phiên" (ADR 0055), KHÔNG đảm bảo là issue —
// link PR cũng nằm đó. Quy ước của tính năng là *chỉ issue mới auto-link; link PR để
// trong note*, nên ở đây chỉ nhận dạng `/issues/<n>`; `/pull/<n>` rơi ra `undefined`
// và người dùng tự ghi nó vào note nếu muốn.
function issueOfUrl(url: string | undefined): number | undefined {
  if (typeof url !== 'string') return undefined
  const m = /\/issues\/(\d+)(?:[/?#]|$)/.exec(url)
  return m ? Number(m[1]) : undefined
}

// Số PR nếu `aboutGhUrl` là link `/pull/<n>`. KHÁC issue: PR KHÔNG auto-link được (API
// worklog trả `createError is not defined` với link PR), nên chỉ để model nhắc trong
// NOTE — không nhét vào `task.issue`.
function prOfUrl(url: string | undefined): number | undefined {
  if (typeof url !== 'string') return undefined
  const m = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)
  return m ? Number(m[1]) : undefined
}

// Số issue của task: `TaskSource` github mang `issueNumber` đã được parse sẵn ở biên
// tạo task, nên nó là dữ kiện có kiểu chứ không phải chuỗi để đoán lại.
function issueOfTask(task: Task): number | undefined {
  return task.source.type === 'github' ? task.source.issueNumber : undefined
}

export function buildLogtimeSuggestions(input: SuggestionInput): SuggestionResult {
  const { date, trackedProjectKeys } = input
  let skippedNoProject = 0
  let skippedUntracked = 0

  const sessions = input.sessions.filter((s) => {
    // Chỉ phiên gốc. Phiên con là việc của agent được giao trong một phiên cha — kể
    // cả cha lẫn con thì một buổi làm ra N+1 dòng y hệt nhau, mời gọi khai trùng công.
    if (s.parentSessionId) return false
    // Phiên chưa có tin nào là vỏ rỗng (mở ra rồi đóng), không phải việc đã làm.
    if (s.messageCount === 0) return false
    // Xét `updatedAt` (lần hoạt động cuối) chứ không `createdAt`: nó bao trùm cả phiên
    // vừa tạo vừa dùng trong ngày, mà vẫn bắt được phiên cũ vừa được làm tiếp hôm nay.
    // `updatedAt >= createdAt` luôn đúng nên "tạo hôm nay" là tập con, không bị sót.
    return isOnDay(s.updatedAt, date)
  })

  const tasks = input.tasks.filter(
    // ⚠ `Task` KHÔNG có `updatedAt` (xem types/shared.ts) nên đành lọc theo `createdAt`:
    // một task tạo tuần trước rồi chạy hôm nay sẽ KHÔNG được gợi ý. Đây là hạn chế đã
    // biết, không phải lựa chọn — thêm `updatedAt` cho Task là việc của luồng task,
    // không phải của tính năng này.
    (t) => isOnDay(t.createdAt, date),
  )

  // Khử trùng hai chiều. Task sinh ra từ phiên (`source.type === 'session'`, ADR 0055)
  // và phiên mở ra để bàn một task (`aboutTaskId`) là hai mặt của CÙNG một việc; giữ cả
  // hai thì người dùng thấy hai dòng cho một buổi làm.
  const sessionIds = new Set(sessions.map((s) => s.id))
  const taskIds = new Set(tasks.map((t) => t.id))
  const keptTasks = tasks.filter((t) =>
    t.source.type === 'session' ? !sessionIds.has(t.source.sessionId) : true,
  )
  const keptSessions = sessions.filter((s) => (s.aboutTaskId ? !taskIds.has(s.aboutTaskId) : true))

  const suggestions: LogtimeSuggestion[] = []

  for (const s of keptSessions) {
    if (!s.projectId) {
      skippedNoProject += 1
      continue
    }
    if (!trackedProjectKeys.has(s.projectId)) {
      skippedUntracked += 1
      continue
    }
    suggestions.push({
      kind: 'session',
      refId: s.id,
      projectKey: s.projectId,
      title: s.title,
      at: s.updatedAt,
      issue: issueOfUrl(s.aboutGhUrl),
      pr: prOfUrl(s.aboutGhUrl),
    })
  }

  for (const t of keptTasks) {
    // `Task.projectId` có kiểu `string` (không nullable) nên nhánh này không chạy —
    // giữ lại vì dữ liệu task cũ trên đĩa có thể thiếu, và `undefined` lọt xuống đây
    // sẽ tạo ra một dòng công không có dự án.
    if (!t.projectId) {
      skippedNoProject += 1
      continue
    }
    if (!trackedProjectKeys.has(t.projectId)) {
      skippedUntracked += 1
      continue
    }
    suggestions.push({
      kind: 'task',
      refId: t.id,
      projectKey: t.projectId,
      title: t.title,
      at: t.createdAt,
      issue: issueOfTask(t),
    })
  }

  // Mới nhất lên đầu. `localeCompare` trên ISO 8601 so được theo thứ tự từ điển vì
  // chuỗi ISO cùng định dạng; `b.at.localeCompare(a.at)` là giảm dần.
  suggestions.sort((a, b) => b.at.localeCompare(a.at))

  return { suggestions, skippedNoProject, skippedUntracked }
}
