import { ref } from 'vue'

// Cột nào đang bị ẩn ở bảng kết quả log — sở thích hiển thị của MỘT MÁY.
//
// localStorage, KHÔNG qua IPC: đây không phải dữ liệu của tài khoản AWS hay của
// phiên, nó là "tôi không muốn nhìn cột này trên màn hình của tôi". Cùng hạng với
// `awog.browserPins` và cỡ chữ Appearance.
//
// NHỚ THEO TÊN CỘT, KHÔNG THEO CHỈ SỐ. Insights trả về đúng những trường mà câu
// lệnh hỏi, nên tập cột đổi theo từng lượt chạy; một chỉ số cột thì lượt sau trỏ
// vào một trường KHÁC. Tên đã ẩn mà lượt này không có thì im lặng bỏ qua — đổi câu
// lệnh không được phép làm mất lựa chọn cũ.
//
// Module-scoped: hai bảng của hai chế độ (Dòng mới nhất · Truy vấn nâng cao) dùng
// chung một danh sách, nên ẩn `@logStream` ở bên này thì bên kia cũng ẩn. Đó là
// điều mong muốn — chúng là cùng một màn hình đối với người dùng.

const KEY = 'awog.infraLogs.hiddenColumns'

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // File localStorage sửa tay được, và một giá trị lạ ở đây không được phép làm
    // hỏng bảng — rơi về "không ẩn cột nào" là trạng thái an toàn.
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function save(value: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Chế độ riêng tư / hết quota: mất phần GHI NHỚ, không mất tính năng.
  }
}

const hidden = ref<string[]>(load())

export function useLogColumnPrefs() {
  function toggle(column: string): void {
    hidden.value = hidden.value.includes(column)
      ? hidden.value.filter((c) => c !== column)
      : [...hidden.value, column]
    save(hidden.value)
  }

  function showAll(): void {
    hidden.value = []
    save(hidden.value)
  }

  /** Lọc một danh sách cột theo lựa chọn đang lưu, giữ nguyên thứ tự gốc. */
  function visible(all: readonly string[]): string[] {
    const out = all.filter((c) => !hidden.value.includes(c))
    // Ẩn hết thì bảng thành một khối trống không giải thích được. Bộ chọn đã khoá
    // cột cuối, nhưng dữ liệu cũ trong localStorage có thể ẩn đúng mọi cột của một
    // tập cột MỚI — ca đó rơi về hiện đủ, không phải hiện rỗng.
    return out.length > 0 ? out : [...all]
  }

  return { hidden, toggle, showAll, visible }
}
