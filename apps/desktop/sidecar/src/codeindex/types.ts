// Hình dạng dữ liệu của chỉ mục mã nguồn (code index) + các trần cứng.
//
// Vì sao có module này: model chỉ có ripgrep. Với câu hỏi "hàm này gọi từ đâu"
// hay "sửa chỗ này thì vỡ gì", grep trả về hàng trăm dòng trùng tên, không theo
// được import alias / re-export, và — đã xảy ra thật trong repo này — một byte
// NUL làm ripgrep coi cả file là nhị phân rồi BỎ QUA IM LẶNG. Grep sai mà im
// lặng là chế độ hỏng tệ nhất; một chỉ mục biết rõ mình sai ở đâu thì tốt hơn.
//
// Chỉ mục CỐ Ý không hoàn hảo: nó do một parser tự viết (mask chuỗi/chú thích +
// đếm ngoặc có giới hạn) sinh ra, KHÔNG phải TypeScript compiler API. Giới hạn
// được liệt kê trong docs/features/code-index.md và được nói thẳng cho model
// trong mô tả tool — vì một công cụ giấu chỗ mù của mình sẽ bị tin quá mức.

// Đổi số này khi shape dưới đây đổi ⇒ mọi chỉ mục cũ trên đĩa tự bị bỏ và dựng
// lại, thay vì đọc nhầm dữ liệu cũ theo shape mới.
export const CODE_INDEX_SCHEMA_VERSION = 2

// ---------------------------------------------------------------------------
// Trần cứng. Repo lớn KHÔNG được làm treo sidecar, và file chỉ mục không được
// phình tới mức đọc lại còn đắt hơn quét lại.
// ---------------------------------------------------------------------------

// Số file nguồn tối đa đưa vào chỉ mục. Vượt trần ⇒ `truncated` = true và mọi
// câu trả lời phải nói rõ là chỉ mục chưa phủ hết cây.
export const MAX_INDEXED_FILES = 6_000
// File lớn hơn mức này bị bỏ qua (bundle, snapshot, file sinh tự động). 512 KB
// mã nguồn viết tay là bất thường; parse chúng chỉ tốn thời gian.
export const MAX_FILE_BYTES = 512 * 1024
// Ngân sách thời gian cho một lần dựng lại (tăng dần). Chạm trần ⇒ giữ phần đã
// làm, đánh dấu `deadlineHit`, lần gọi sau đi tiếp (mtime vẫn còn lệch).
export const BUILD_DEADLINE_MS = 20_000
// Số tên riêng biệt được nhớ tham chiếu trong MỘT file. File sinh tự động có thể
// có hàng nghìn; giữ hết thì chỉ mục phình mà giá trị không tăng.
export const MAX_REF_NAMES_PER_FILE = 800
// Số dòng nhớ cho MỘT tên trong MỘT file. Ai gọi 40 lần trong cùng file thì
// người đọc đã đủ thông tin để mở file ra xem.
export const MAX_REF_LINES_PER_NAME = 40
// Số khai báo tối đa nhớ cho một file.
export const MAX_DECLS_PER_FILE = 2_000

export type DeclKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method'

export interface CodeDecl {
  name: string
  kind: DeclKind
  // 1-based, tính trên TOÀN file (kể cả .vue — offset khối <script> được giữ).
  line: number
  exported: boolean
  // Tên class chứa nó, chỉ có với kind='method'.
  container?: string | undefined
}

export type ImportKind = 'import' | 'reexport' | 'dynamic' | 'require'

export interface CodeImport {
  // Chuỗi specifier đúng như đã viết ('./store.js', '~/composables/useTheme', 'zod').
  spec: string
  line: number
  // Tên được mang vào: tên thường, 'default', hoặc '*' cho namespace import.
  names: string[]
  kind: ImportKind
  // Đường dẫn tương đối so với root, đã resolve. Vắng = external hoặc không
  // resolve được (hai trường hợp phân biệt bằng `external`).
  target?: string | undefined
  // true = specifier trần của một package (node:fs, zod, vue) ⇒ không thuộc repo.
  external: boolean
}

export interface CodeFileIndex {
  // Đường dẫn tương đối so với root, luôn dùng dấu '/'.
  path: string
  mtimeMs: number
  size: number
  decls: CodeDecl[]
  imports: CodeImport[]
  // tên → các dòng có tham chiếu (lời gọi `name(`, `new Name(`, thẻ <Name> trong
  // template Vue). Gom theo tên để khỏi lặp chuỗi tên hàng trăm lần.
  refs: Record<string, number[]>
  // Đã chạm một trần nào đó khi parse file này ⇒ dữ liệu của nó là một phần.
  partial: boolean
}

export interface CodeIndex {
  version: number
  // Root tuyệt đối mà chỉ mục này thuộc về.
  root: string
  builtAt: number
  files: CodeFileIndex[]
  // Số file nguồn bị bỏ (quá lớn / đọc lỗi).
  skipped: number
  // Danh sách file đã chạm MAX_INDEXED_FILES ⇒ cây chưa phủ hết.
  truncated: boolean
  // Cách liệt kê file: theo git (tôn trọng .gitignore) hay đi bộ có chặn.
  source: 'git' | 'walk'
}

export interface CodeIndexStats {
  files: number
  decls: number
  refNames: number
  imports: number
  // Số cạnh import trỏ tới một file KHÁC trong repo (đã resolve được).
  internalEdges: number
  unresolvedInternal: number
  skipped: number
  truncated: boolean
  builtAt: number
  bytesOnDisk: number
}
