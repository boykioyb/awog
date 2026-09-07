import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { engine, type EngineEvent } from './engine'
import { log } from './logger'
import { notifyOs, notifyStrings } from './notify'
import { openSessionIds } from './session-window'
import type { TrayCommand } from './tray'

// Đánh thức khi KHÔNG CÒN CỬA SỔ NÀO NHẬN (gói #22).
//
// ─── Vấn đề ────────────────────────────────────────────────────────────────
// Phiên trong AWOG do RENDERER lái: `session.background-done` (bg-registry của
// sidecar) được `stores/sessions.ts` tiêu thụ thành `pendingWakes` → card "Tiếp
// tục" hoặc auto-continue. Đóng cửa sổ UI thì engine vẫn chạy nhưng KHÔNG CÒN AI
// NGHE: lệnh nền xong lúc đó rơi vào hư không — mở lại app cũng không có card,
// vì hàng đợi wake sống trong bộ nhớ renderer.
//
// ─── Mô hình đã chọn: PARK + REPLAY, hàng đợi ở MAIN ────────────────────────
// Main sống lâu hơn mọi renderer VÀ là nơi duy nhất biết cửa sổ nào đang mở, nên
// hàng đợi nằm ở đây (sidecar không có khái niệm "cửa sổ"). Ba bước:
//   1. Sự kiện tới mà KHÔNG cửa sổ nào sở hữu phiên đó ⇒ park (hàng đợi có trần).
//   2. Báo cho người dùng bằng thông báo OS phát từ main (notify.ts) — kênh duy
//      nhất còn lại khi renderer đã chết.
//   3. Cửa sổ chính mở lại và renderer đăng ký nghe ⇒ phát lại NGUYÊN VĂN sự
//      kiện trên đúng kênh `engine:event`. Store xử lý y như lúc nhận trực tiếp:
//      KHÔNG có nhánh code thứ hai, không đụng gì tới renderer.
//
// ─── KHÔNG tự chạy lượt LLM khi không ai nhìn ──────────────────────────────
// Park xong thì dừng. Muốn "tự chạy tiếp khi cửa sổ đóng" phải có primitive
// "bắt đầu một lượt" ở sidecar (hiện KHÔNG có — mọi lượt do renderer gọi
// `sessions.sendMessage`), và nó tiêu tiền thật của người dùng khi không ai
// giám sát. Toggle `autoContinueOnBackground` (mặc định TẮT) vẫn quyết định như
// cũ, chỉ khác là nó chạy lúc cửa sổ mở lại. Xem ADR 0084.
//
// ─── Ai "sở hữu" một phiên ──────────────────────────────────────────────────
// Đúng luật hand-off của session popout (`ownsSession` trong store): phiên đã
// pop ra cửa sổ riêng thì cửa sổ đó sở hữu; còn lại thuộc cửa sổ chính. Nhờ vậy
// main tính được chính xác "có ai nhận được không" mà không cần hỏi renderer.

interface WakeDeps {
  // Cửa sổ chính hiện tại (null khi đã đóng).
  getWindow: () => BrowserWindow | null
  // Mở/đưa cửa sổ chính lên trước — dùng khi người dùng bấm vào thông báo.
  showWindow: () => void
}

// Trần hàng đợi: đủ cho một đêm chạy nền, không đủ để phình bộ nhớ nếu có gì đó
// phát sự kiện liên tục. Vượt trần thì bỏ cái CŨ nhất.
const MAX_PARKED = 50
// Nhịp chờ trước khi phát lại. Renderer có NHIỀU nơi cùng gọi `onEvent` (store
// phiên, git, wiki…), và cái đăng ký ĐẦU TIÊN không chắc là store phiên; sự kiện
// phát lại quá sớm sẽ rơi vào lúc store chưa kịp `await sc.onEvent(...)`. Chờ một
// nhịp ngắn để mọi listener vòng đời app kịp gắn — người dùng không cảm nhận được.
const SUBSCRIBE_SETTLE_MS = 750

let deps: WakeDeps | null = null
const parked: EngineEvent[] = []
let pendingRoute: TrayCommand | null = null
// webContents của cửa sổ chính đã đăng ký nghe engine event. So sánh theo id nên
// cửa sổ đóng/mở lại (id mới) tự động về trạng thái "chưa sẵn sàng".
let readyWebContentsId: number | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function installWakeBridge(d: WakeDeps): void {
  deps = d
  engine.onEvent(observe)
  // Preload báo mỗi lần renderer đăng ký nghe engine event (xem preload.ts).
  ipcMain.on('engine:subscribed', (e) => onSubscribed(e.sender))
  // Điều hướng của thông báo được KÉO đúng lúc renderer gắn handler tray command
  // — không đoán mò thời điểm mount.
  ipcMain.handle('wake:drainRoute', (e) => (isMainSender(e.sender) ? takeRoute() : null))
}

// ─── Quan sát luồng sự kiện ────────────────────────────────────────────────

function observe(event: EngineEvent): void {
  const sessionId = sessionIdOf(event.payload)
  if (!sessionId) return
  // Có cửa sổ nhận được ⇒ renderer lo tất (kể cả thông báo). Hai đường tách hẳn
  // nhau nên một sự kiện không bao giờ sinh hai thông báo.
  if (ownerWindowReady(sessionId)) return
  const s = notifyStrings()
  switch (event.type) {
    case 'session.background-done': {
      // `wake:false` = runtime tự nối lại lượt (nhánh Claude SDK) ⇒ không có gì
      // để giao lại, cũng không có gì để báo.
      if (readField(event.payload, 'wake') === false) return
      park(event)
      const ok =
        readField(event.payload, 'status') === 'exited' &&
        readField(event.payload, 'exitCode') === 0
      notify(ok ? s.bgDone : s.bgFailed, readText(event.payload, 'command'), sessionId)
      return
    }
    case 'session.permission-request': {
      const tool = readText(event.payload, 'displayName') || readText(event.payload, 'toolName')
      notify(s.permission, tool, sessionId)
      return
    }
    case 'session.message.done': {
      // Lượt chạy xong trong lúc cửa sổ đã đóng. Không park: transcript được dựng
      // lại từ JSONL khi mở phiên, chỉ có thông báo là mất.
      const errorMessage = readText(event.payload, 'errorMessage')
      const title = errorMessage ? s.turnError : s.turnDone
      notify(title, errorMessage || readText(event.payload, 'text'), sessionId)
      return
    }
    default:
      return
  }
}

// Cửa sổ sở hữu phiên này có đang nhận được sự kiện không?
function ownerWindowReady(sessionId: string): boolean {
  // Phiên đã pop out ⇒ cửa sổ popout sở hữu (map chỉ giữ cửa sổ còn sống).
  if (openSessionIds().includes(sessionId)) return true
  const win = deps?.getWindow() ?? null
  if (!win || win.isDestroyed()) return false
  // Cửa sổ chính vừa mở nhưng renderer chưa đăng ký nghe ⇒ gửi vào cũng mất.
  return win.webContents.id === readyWebContentsId
}

function park(event: EngineEvent): void {
  parked.push(event)
  if (parked.length > MAX_PARKED) parked.splice(0, parked.length - MAX_PARKED)
}

// ─── Giao lại khi cửa sổ mở lại ────────────────────────────────────────────

function onSubscribed(sender: WebContents): void {
  if (!isMainSender(sender)) return
  readyWebContentsId = sender.id
  if (!parked.length || flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushParked()
  }, SUBSCRIBE_SETTLE_MS)
}

function flushParked(): void {
  const win = deps?.getWindow() ?? null
  if (!win || win.isDestroyed() || win.webContents.id !== readyWebContentsId) return
  const batch = parked.splice(0, parked.length)
  for (const event of batch) win.webContents.send('engine:event', event)
  log.info('wake: replayed parked events', { count: batch.length })
}

function isMainSender(sender: WebContents): boolean {
  const win = deps?.getWindow() ?? null
  return !!win && !win.isDestroyed() && win.webContents.id === sender.id
}

// ─── Thông báo + điều hướng khi bấm ────────────────────────────────────────

function notify(title: string, body: string, sessionId: string): void {
  notifyOs({ title, body, onClick: () => routeToSession(sessionId) })
}

// Bấm thông báo: mở cửa sổ chính rồi đưa người dùng tới ĐÚNG phiên. Dùng lại kênh
// `tray:command` mà renderer đã xử lý sẵn (useTrayStatus) — không thêm đường mới.
// Cửa sổ chưa sẵn sàng thì để dành, preload sẽ kéo lúc gắn handler.
function routeToSession(engineId: string): void {
  const cmd: TrayCommand = { kind: 'session', engineId }
  deps?.showWindow()
  const win = deps?.getWindow() ?? null
  if (win && !win.isDestroyed() && win.webContents.id === readyWebContentsId) {
    win.webContents.send('tray:command', cmd)
    return
  }
  pendingRoute = cmd
}

function takeRoute(): TrayCommand | null {
  const cmd = pendingRoute
  pendingRoute = null
  return cmd
}

// ─── Đọc payload (L1 — sự kiện đi qua đây có shape do sidecar quyết) ────────

function readField(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== 'object') return undefined
  return (payload as Record<string, unknown>)[key]
}

function readText(payload: unknown, key: string): string {
  const value = readField(payload, key)
  return typeof value === 'string' ? value : ''
}

function sessionIdOf(payload: unknown): string | null {
  const value = readField(payload, 'sessionId')
  return typeof value === 'string' && value ? value : null
}
