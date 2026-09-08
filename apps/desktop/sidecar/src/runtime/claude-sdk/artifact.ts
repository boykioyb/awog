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
