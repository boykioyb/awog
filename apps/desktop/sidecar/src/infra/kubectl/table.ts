// Bóc bảng chữ của kubectl thành hàng/cột.
//
// Vì sao KHÔNG dùng `-o json`/`-o custom-columns` cho các bảng của tab Kubernetes:
// hai định dạng đó in ra NỘI DUNG object (và `custom-columns` chọn được cả
// `.data.password`), nên `sensitiveReadOf()` xếp chúng vào nhóm "đọc nhưng trả nội
// dung" ⇒ mỗi lần nạp bảng là một lần hỏi người dùng. Bảng mặc định của kubectl
// (`--no-headers`) chỉ có metadata, nên nó là `read` chạy thẳng — đổi lại phải
// parse text, và đó là toàn bộ việc của file này.
//
// Luật parse: kubectl vẽ cột bằng `tabwriter` (đệm ≥2 dấu cách) nên cắt theo
// `/\s{2,}/` là đúng. Cách này cố ý KHÔNG cắt theo một dấu cách: giá trị như
// RESTARTS `3 (2m ago)` có dấu cách bên trong, cắt theo một dấu cách sẽ làm nó
// tách thành hai ô và đẩy lệch mọi cột phía sau.

/** Một bảng kubectl → mảng các hàng, mỗi hàng là mảng ô đã trim. */
export function parseKubeTable(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\s+$/, '')
    if (trimmed.trim() === '') continue
    rows.push(trimmed.split(/\s{2,}/).map((cell) => cell.trim()))
  }
  return rows
}

/**
 * Tên container của một pod, lấy từ `kubectl describe pod` — dùng cho ô chọn
 * container của màn log.
 *
 * Vì sao đi đường `describe` (text) chứ không `-o jsonpath={.spec.containers[*].name}`:
 * jsonpath thuộc nhóm "in nội dung object" ⇒ mỗi lần mở log là một lần hỏi duyệt.
 * `describe` thì không. Đổi lại phải đọc text, và khối `Containers:` trong describe
 * có hình dạng ổn định: tiêu đề không thụt lề, mỗi container là một dòng thụt 2 dấu
 * cách và kết thúc bằng ':', các field của nó thụt 4.
 *
 * Chỉ đọc khối `Containers:` (KHÔNG phải `Init Containers:`) — init container
 * thường đã chạy xong, log của nó hiếm khi là thứ người dùng đang tìm.
 */
export function parseDescribeContainerNames(text: string): string[] {
  const lines = text.split('\n')
  const names: string[] = []
  let i = 0
  while (i < lines.length && lines[i].trim() !== 'Containers:') i += 1
  if (i >= lines.length) return names
  for (i += 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    // Dòng không thụt lề ⇒ hết khối này (Conditions:, Volumes:, …).
    if (!/^\s/.test(line)) break
    const m = /^ {2}(\S.*):$/.exec(line)
    if (m) names.push(m[1].trim())
  }
  return names
}
