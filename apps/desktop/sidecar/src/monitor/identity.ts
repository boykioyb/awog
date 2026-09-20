// "Tiến trình này có phải của AWOG không?" — một nguồn sự thật cho cả phần dò mồ
// côi (snapshot.ts) lẫn cổng bảo vệ lệnh giết (kill.ts).
//
// ⚠ KHÔNG được lấy `process.execPath` làm dấu nhận diện. Ở bản đóng gói nó là
// binary trong app bundle nên có vẻ đúng, nhưng ở bản dev sidecar chạy bằng
// `node` của máy — lấy nó làm dấu thì MỌI tiến trình Node trên máy (kể cả của
// người khác viết) đều bị tính là "của AWOG", tức là mở cổng giết nhầm. Hai dấu
// dưới đây đều là đường dẫn RIÊNG của bản cài này.

import { dirname } from 'node:path'

function markers(): string[] {
  const out = new Set<string>()

  // 1. App bundle của macOS: `/Applications/AWOG.app` — phủ Electron main, mọi
  //    helper, sidecar, và cả binary CLI nằm trong Resources.
  const exe = process.execPath
  const appIdx = exe.indexOf('.app/')
  if (appIdx > 0) out.add(exe.slice(0, appIdx + 4))

  // 2. Thư mục gốc của sidecar, suy từ chính script đang chạy. Ở bản đóng gói nó
  //    là `…/Resources/sidecar`, ở bản dev là `…/apps/desktop/sidecar` — cả hai
  //    đều đủ riêng để không đụng tiến trình của app khác.
  const entry = process.argv[1]
  if (entry) {
    const idx = entry.lastIndexOf('/sidecar/')
    if (idx > 0) out.add(entry.slice(0, idx + '/sidecar'.length))
    else out.add(dirname(entry))
  }

  return [...out].filter((m) => m.length > 8)
}

// Tính một lần: đường dẫn của bản cài không đổi trong đời tiến trình.
const MARKERS = markers()

// ⚠ So khớp trên FILE CHẠY, không phải trên cả dòng lệnh. Dùng `includes` trên
// toàn dòng lệnh thì một tiến trình chỉ NHẮC TỚI đường dẫn cũng bị tính là của
// AWOG — đo được: `zsh -c "cd …/sidecar && node …"` bị gắn nhãn mồ côi, và UI
// thì mời người dùng giết nó. Tiến trình AWOG thật luôn có đường dẫn đó ở argv[0]
// (bản đóng gói) hoặc argv[1] (bản dev chạy `node <script>`), nên chỉ xét hai
// token đầu và chỉ tính khi chúng BẮT ĐẦU bằng dấu nhận diện.
// argv[1] chỉ được tính khi argv[0] là một TRÌNH THÔNG DỊCH — tức trường hợp bản
// dev chạy `node <script của sidecar>`. Không có điều kiện này thì một lệnh vô
// hại nhận đường dẫn app làm THAM SỐ (`ls /Applications/AWOG.app`) cũng bị tính
// là tiến trình của AWOG, và cổng giết mở ra cho nó.
const INTERPRETERS = new Set(['node', 'node.exe', 'electron', 'electron.exe'])

function isInterpreter(argv0: string): boolean {
  const name = argv0.slice(argv0.lastIndexOf('/') + 1)
  return INTERPRETERS.has(name)
}

export function matchesMarkers(command: string, markers: readonly string[]): boolean {
  const [argv0, argv1] = command.split(/\s+/)
  if (argv0 === undefined) return false
  if (markers.some((m) => argv0.startsWith(m))) return true
  return isInterpreter(argv0) && argv1 !== undefined && markers.some((m) => argv1.startsWith(m))
}

export function isAwogProcess(command: string): boolean {
  return matchesMarkers(command, MARKERS)
}
