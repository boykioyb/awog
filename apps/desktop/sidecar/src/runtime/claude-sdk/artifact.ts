// Bật tool `Artifact` của CLI trên nhánh Claude SDK (parity #35).
//
// `Artifact` là tool BUILT-IN của Claude Code CLI: publish một file `.html` thành
// trang có URL chia sẻ được, kèm version (`label` + lịch sử) và bình luận — tức
// đúng ba thứ hạng mục #35 đòi. Hosting là của Anthropic, dưới tài khoản Claude
// của chính người dùng. Vì thế AWOG KHÔNG dựng lại gì cả: không store, không
// backend, không schema version. Chỉ mở đúng một cái cổng.
//
// ── VÌ SAO LÀ BIẾN MÔI TRƯỜNG, KHÔNG PHẢI `Options.settings.enableArtifact` ──
//
// Doc của SDK (`sdk.d.ts`) mô tả `enableArtifact` là "Unset defaults to on once
// the feature is available", nên thoạt nhìn chỉ cần thêm một khoá settings. ĐO
// THẬT thì không phải vậy. Bảng dưới đo trên SDK 0.3.260 / CLI 2.1.260, tài khoản
// OAuth, đọc danh sách `tools` trong message `system/init`:
//
//   env CLAUDE_CODE_ARTIFACT | settings.enableArtifact | Artifact trong toolset
//   -------------------------|-------------------------|-----------------------
//   (không đặt)              | (không đặt)             | KHÔNG
//   (không đặt)              | true                    | KHÔNG   ← khoá settings vô tác dụng
//   1                        | (không đặt)             | CÓ
//   1                        | false                   | KHÔNG   ← vẫn tắt được
//
// Lý do nằm trong chính binary CLI (hàm đã giải mã từ bản minify):
//
//   Kl()  = ... if(!Ie(env.CLAUDE_CODE_ARTIFACT) && Ch()) return 'sdk_default_off'
//   Ch()  = TP() || entrypoint==='claude-code-github-action' || entrypoint==='mcp'
//   TP()  = entrypoint==='sdk-ts' || 'sdk-py' || 'sdk-cli'
//
// SDK luôn đặt `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, nên MỌI phiên chạy qua SDK rơi
// vào `sdk_default_off` — đó là một cổng của ENTRYPOINT, và tầng settings không
// hề được hỏi tới trước khi cổng đó đóng. Câu "unset defaults to on" trong doc
// đúng cho CLI tương tác, KHÔNG đúng cho người nhúng SDK. Đặt `enableArtifact:
// true` là một dòng no-op nằm im trong code.
//
// Ngược lại `enableArtifact: false` VẪN tắt được (hàng cuối bảng), vì cổng
// settings được hỏi TRƯỚC cổng entrypoint. Nhưng AWOG không dùng đường đó: công
// tắc cho người dùng đã có sẵn ở `disabledTools` → `disallowedTools`, dùng chung
// với mọi tool built-in khác (đo thật: deny `Artifact` ⇒ biến khỏi toolset). Thêm
// một khoá settings song song chỉ tạo hai nguồn sự thật cho cùng một câu hỏi.
//
// ── PHẠM VI: KHÔNG BẮC CẦU ĐƯỢC SANG PROVIDER KHÁC ──
//
// Khác 7 tool AWOG bắc cầu sang nhánh SDK, tool này KHÔNG có phần thân của AWOG
// để dùng chung — thân của nó là dịch vụ hosting của Anthropic. Nên nó chỉ tồn
// tại khi provider là `anthropic`; đổi agent sang OpenAI/Google/Ollama là mất
// hẳn, và không có bản vá nào lấy lại được. Đây là ca ĐẦU TIÊN trong repo mà mối
// nguy của ADR 0058 ("đổi provider là đổi năng lực agent") không sửa được — chỉ
// nói ra được. Xem docs/features/claude-desktop-parity.md #35.
//
// Chỗ ở tự nhiên của hằng này là `buildSdkEnv` (shared.ts), nơi đã giữ
// `CLAUDE_CODE_ENABLE_TODO_TOOLS` và `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS`.
// Nó nằm riêng ra đây để chính sách + bằng chứng đo được ở trên có một nhà duy
// nhất, thay vì bị chép hai bản vào run-stream.ts và invoke.ts.
export const ARTIFACT_ENV: Readonly<Record<string, string>> = Object.freeze({
  CLAUDE_CODE_ARTIFACT: '1',
})

// ─── Cổng quyền theo HÀNH ĐỘNG ───────────────────────────────────────────────
//
// `Artifact` là MỘT tool mang nhiều hành động, và hành động mặc định của nó
// (`publish`) đưa một trang lên mạng với URL công khai, gắn tài khoản Claude của
// người dùng. Trước bản vá này `isGatedTool()` (runtime/permission.ts) không biết
// tên nó, nên lời gọi thoát ở nhánh "không phải tool có hệ quả ⇒ cho chạy" —
// TRƯỚC cả nhánh plan mode. Hệ quả cụ thể: một phiên `mode: 'plan'` (hợp đồng:
// read-only) publish được ra internet, trong khi `Write` ở đúng phiên đó bị chặn
// cứng. Không còn tầng nào phía dưới đỡ: `permissionMode: 'bypassPermissions'` đã
// tắt engine quyền của CLI.
//
// Cùng khuôn `isMutatingBrowserAction` / `isMutatingDevServerAction`, nhưng ĐẢO
// CHIỀU MẶC ĐỊNH — và đó là điểm khác biệt cố ý duy nhất:
//
//   browser_tool / dev_server → liệt kê hành động CÓ HỆ QUẢ, còn lại không gate.
//   Artifact                  → liệt kê hành động CHỈ ĐỌC, còn lại GATE.
//
// Hai lý do bắt buộc phải đảo:
//  1. `action` là tuỳ chọn, và THIẾU nó nghĩa là `publish` — tức chính hành động
//     nặng nhất là giá trị rơi mặc định. Một danh sách "mutating" sẽ để lọt
//     `Artifact({ file_path: 'x.html' })`, đúng dạng model hay gọi nhất.
//  2. Phần thân tool nằm ở CLI của Anthropic, không phải trong repo này: danh sách
//     hành động đổi khi người dùng nâng CLI, không khi ai đó sửa code ở đây. Bản đo
//     0.3.260 có 11 hành động; các bản CLI mới hơn đã thấy thêm `write_db`,
//     `reply`, `resolve`. Với danh sách "mutating" thì mỗi hành động mới sẽ chạy
//     UNGATED cho tới khi có người nhớ ra phải cập nhật — im lặng, và đúng vào lúc
//     không ai nhìn.
//
// Nên: hành động lạ ⇒ hỏi. Giá phải trả là một lời hỏi thừa cho hành động chỉ-đọc
// nào đó xuất hiện sau này; giá của chiều ngược lại là một trang lên mạng mà không
// ai duyệt. Chỉ chiều thứ nhất là sửa được sau khi đã xảy ra.
//
// Phân loại dưới đây đọc từ `ArtifactInput` của SDK 0.3.260 (sdk-tools.d.ts):
//   CHỈ ĐỌC  list · read · list_types · list_assets · status · watch · unwatch
//            (`watch`/`unwatch`/`status` là đăng ký thông báo, và schema nói rõ
//            chúng không hoạt động trong phiên SDK — `watch` chỉ báo lại điều đó)
//   CÓ HỆ QUẢ (không liệt kê ở đây, rơi vào nhánh mặc định):
//            publish (kể cả khi thiếu `action`) · upload_asset (đẩy MỘT FILE CỤC BỘ
//            lên hosting của Anthropic — cùng hạng với việc lộ dữ liệu) ·
//            read_asset (tên nghe như đọc, nhưng nó GHI một file xuống `out_dir`,
//            mặc định là thư mục làm việc — cùng hạng với `Write`) · delete_asset
//            (xoá vĩnh viễn)
//
// ⚠ `read_db` và `comments` của CLI mới hơn KHÔNG nằm trong danh sách chỉ-đọc, dù
// tên gợi ý vậy: chúng chưa có trong schema đang ghim nên chưa ai đọc được hợp đồng
// thật của chúng. Miễn trừ theo cái tên là đoán, và đoán sai theo chiều cấp quyền
// là leo thang. Nâng SDK lên bản có chúng, đọc schema, rồi thêm vào đây.
const READ_ONLY_ARTIFACT_ACTIONS = new Set([
  'list',
  'read',
  'list_types',
  'list_assets',
  'status',
  'watch',
  'unwatch',
])

export const ARTIFACT_TOOL_NAME = 'Artifact'

// Chỉ so tên TRẦN, khác `isDevServerToolName`: `Artifact` là tool built-in của CLI,
// nó KHÔNG bắc cầu qua MCP nên không bao giờ mang dạng `mcp__<server>__Artifact`.
// Khớp thêm hậu tố ở đây sẽ vơ nhầm một tool bên thứ ba trùng tên.
export function isArtifactToolName(name: string): boolean {
  return name === ARTIFACT_TOOL_NAME
}

// Lời gọi này có phải đi qua cổng quyền không. Mọi thứ không nằm trong danh sách
// chỉ-đọc đều có — kể cả args dị dạng, thiếu `action`, hay `action` không phải chuỗi.
export function isGatedArtifactAction(args: unknown): boolean {
  const action = (args as { action?: unknown } | null | undefined)?.action
  if (typeof action !== 'string') return true
  return !READ_ONLY_ARTIFACT_ACTIONS.has(action)
}
