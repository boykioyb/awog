import { computed, ref, watch } from 'vue'
import type { BgShellState, BgShellStatus } from '~/stores/sessions'

// State cho modal "xem output job nền" (ADR 0066): giữ job nào đang mở và lấy
// output THẬT của nó từ sidecar.
//
// NGUỒN CHỮ. Sidecar giữ toàn bộ stdout+stderr của lệnh nền ở
// `~/.awog/sessions/<sid>/bg/<shellId>/log`; RPC `sessions.backgroundRead` đọc phần
// ĐUÔI của file đó (log dài thì cắt, kèm cờ `truncated` để nói rõ với người dùng).
// RPC gọi với `markRead: false` — người dùng xem không phải "model đã đọc kết quả",
// nếu đánh dấu thì chip bị retire oan.
//
// Hai trường hợp output rỗng mà KHÔNG phải lỗi: lệnh đang chạy chưa in gì, và job
// nền của nhánh Claude SDK (`external`) vốn chạy trong tiến trình CLI nên không có
// file log nào để đọc. Modal nói riêng từng trường hợp.
export type BgOutputState = {
  text: string
  loading: boolean
  error: string | null
  truncated: boolean
  droppedBytes: number
  external: boolean
}

const EMPTY: BgOutputState = {
  text: '',
  loading: false,
  error: null,
  truncated: false,
  droppedBytes: 0,
  external: false,
}

export function useSessionBackgroundOutput(engineId: () => string | undefined) {
  const store = useSessionsStore()

  // Giữ SHELL ID chứ không giữ object: store thay nguyên entry mỗi lần đổi trạng
  // thái, giữ object sẽ đóng băng modal ở trạng thái cũ.
  const shellId = ref<string | null>(null)

  const shell = computed<BgShellState | null>(() => {
    const eid = engineId()
    if (!eid || !shellId.value) return null
    return store.bgShellsFor(eid).find((s) => s.shellId === shellId.value) ?? null
  })
  const isOpen = computed<boolean>(() => shell.value !== null)

  const output = ref<BgOutputState>({ ...EMPTY })

  // Chống race: chỉ nhận kết quả của lần fetch mới nhất (đóng/mở nhanh, hoặc lệnh
  // kết thúc ngay khi lần đọc trước còn đang bay).
  let seq = 0
  // Trạng thái ứng với lần fetch gần nhất — mốc để biết khi nào cần đọc lại.
  let fetchedStatus: BgShellStatus | undefined

  async function fetchOutput(): Promise<void> {
    const eid = engineId()
    const sid = shellId.value
    if (!eid || !sid) return
    const mine = ++seq
    fetchedStatus = shell.value?.status
    output.value = { ...output.value, loading: true, error: null }
    try {
      const res = await store.readBackgroundOutput(eid, sid)
      if (mine !== seq) return
      output.value = {
        text: res.output,
        loading: false,
        error: null,
        truncated: res.truncated,
        droppedBytes: res.droppedBytes,
        external: res.external,
      }
    } catch (err) {
      if (mine !== seq) return
      output.value = {
        ...EMPTY,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  function open(id: string): void {
    shellId.value = id
    output.value = { ...EMPTY, loading: true }
    void fetchOutput()
  }

  function close(): void {
    // Tăng seq để kết quả đang bay rơi vào hư không thay vì ghi đè state đã reset.
    seq += 1
    shellId.value = null
    fetchedStatus = undefined
    output.value = { ...EMPTY }
  }

  // Lệnh đang chạy thì log còn dài ra. Khi chip đổi trạng thái (đang chạy → xong)
  // đọc lại để modal hiện output cuối cùng, người dùng không phải đóng/mở lại.
  watch(
    () => shell.value?.status,
    (next) => {
      if (!shellId.value || !next || next === fetchedStatus) return
      void fetchOutput()
    },
  )

  return { isOpen, shell, output, open, close }
}
