import { ref } from 'vue'

// Tuỳ chọn hiển thị của bảng log — sở thích của MỘT MÁY, theo khuôn hộp thoại
// "Preferences" của CloudWatch Logs: kiểu xem chi tiết một dòng, có xuống dòng hay
// không, và những cột nào hiện.
//
// localStorage, KHÔNG qua IPC: đây không phải dữ liệu của tài khoản AWS hay của
// phiên, nó là "tôi muốn nhìn bảng này theo kiểu nào trên màn hình của tôi". Cùng
// hạng với `awog.browserPins` và cỡ chữ Appearance.
//
// MỘT key cho cả bốn tuỳ chọn, vì hộp thoại ghi cả bốn cùng lúc khi bấm Xác nhận —
// bốn key rời sẽ cho phép ghi nửa vời nếu quota bục giữa chừng.

const KEY = 'awog.infraLogs.prefs'
/** Key của riêng danh sách cột, dùng trước 2026-09-17. Đọc một lần rồi bỏ. */
const LEGACY_COLUMNS_KEY = 'awog.infraLogs.hiddenColumns'

/** Chi tiết một dòng hiện ở đâu. */
export type LogRowMode = 'pane' | 'inline'

export type LogPrefs = {
  /** Tên cột đang ẩn. Nhớ theo TÊN, không theo chỉ số — xem ghi chú ở `visible`. */
  hiddenColumns: string[]
  rowMode: LogRowMode
  /** Chỉ có nghĩa với `inline`: mở sẵn mọi dòng thay vì chờ bấm. */
  expandByDefault: boolean
  /** Cho ô nội dung xuống dòng để đọc hết, đổi lại hàng cao không đều. */
  wrapLines: boolean
}

export const DEFAULT_PREFS: LogPrefs = {
  hiddenColumns: [],
  rowMode: 'pane',
  // MẶC ĐỊNH TẮT, khác CloudWatch. Đo được: một dòng log JSON 2.4KB khi xuống dòng
  // chiếm 883px — cao hơn cả khung bảng — và một mình nó đẩy 32 hàng khác ra khỏi
  // tầm nhìn. Ai cần đọc nguyên dòng thì đã có chi tiết một dòng; ai thực sự muốn
  // đánh đổi thì bật ở đây.
  expandByDefault: false,
  wrapLines: false,
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function load(): LogPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      // File localStorage sửa tay được; một giá trị lạ ở đây không được phép làm
      // hỏng bảng, nên từng trường rơi về mặc định riêng lẻ chứ không bỏ cả cụm.
      const o = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
      >
      return {
        hiddenColumns: readStringList(o.hiddenColumns),
        rowMode: o.rowMode === 'inline' ? 'inline' : 'pane',
        expandByDefault: o.expandByDefault === true,
        wrapLines: o.wrapLines === true,
      }
    }
    // Bản trước chỉ lưu danh sách cột. Giữ lại lựa chọn đó thay vì bắt người dùng
    // ẩn lại từ đầu chỉ vì hộp thoại đổi khuôn.
    const legacy = localStorage.getItem(LEGACY_COLUMNS_KEY)
    if (legacy) {
      const hidden = readStringList(JSON.parse(legacy))
      return { ...DEFAULT_PREFS, hiddenColumns: hidden }
    }
  } catch {
    // Chế độ riêng tư / JSON hỏng: mất phần GHI NHỚ, không mất tính năng.
  }
  return { ...DEFAULT_PREFS }
}

const prefs = ref<LogPrefs>(load())

export function useLogPrefs() {
  /** Ghi cả cụm — hộp thoại gọi đúng một lần khi người dùng bấm Xác nhận. */
  function save(next: LogPrefs): void {
    prefs.value = {
      hiddenColumns: [...next.hiddenColumns],
      rowMode: next.rowMode,
      expandByDefault: next.expandByDefault,
      wrapLines: next.wrapLines,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs.value))
      localStorage.removeItem(LEGACY_COLUMNS_KEY)
    } catch {
      // Ghi hỏng thì phiên này vẫn dùng được, chỉ không nhớ sang lần sau.
    }
  }

  /**
   * Lọc danh sách cột theo lựa chọn đang lưu, giữ nguyên thứ tự gốc.
   *
   * NHỚ THEO TÊN, KHÔNG THEO CHỈ SỐ: Insights trả về đúng những trường câu lệnh hỏi,
   * nên tập cột đổi theo từng lượt chạy và một chỉ số lượt sau sẽ trỏ vào trường
   * khác. Tên đã ẩn mà lượt này không có thì im lặng bỏ qua.
   */
  function visible(all: readonly string[]): string[] {
    const out = all.filter((c) => !prefs.value.hiddenColumns.includes(c))
    // Ẩn hết thì bảng thành một khối trống không giải thích được. Hộp thoại đã khoá
    // cột cuối, nhưng dữ liệu cũ trong localStorage có thể ẩn đúng mọi cột của một
    // tập cột MỚI — ca đó rơi về hiện đủ, không phải hiện rỗng.
    return out.length > 0 ? out : [...all]
  }

  return { prefs, save, visible }
}
