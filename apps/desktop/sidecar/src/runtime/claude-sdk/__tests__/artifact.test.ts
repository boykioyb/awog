// Tool `Artifact` (parity #35) — cổng bật và cách nó hiện ra trong transcript.
//
// Run: `npx vitest run src/runtime/claude-sdk/__tests__/artifact.test.ts`
import { describe, expect, it } from 'vitest'
import { ARTIFACT_ENV } from '../artifact.js'
import { stepFromToolUse } from '../../../sessions/step-mapper.js'

describe('ARTIFACT_ENV', () => {
  // Phép kiểm này YẾU và nói thẳng ra ở đây: nó chỉ chốt lại giá trị của một hằng,
  // không chứng minh được cổng thật sự mở. Thứ chứng minh điều đó là phép ĐO trên
  // SDK thật (bảng truth-table trong artifact.ts), và nó không chạy được trong
  // vitest vì cần spawn CLI + tài khoản OAuth.
  //
  // Cái nó THẬT SỰ giữ là quyết định "env chứ không phải settings": ai đọc doc SDK
  // rồi rút gọn thành `settings: { enableArtifact: true }` sẽ phải xoá test này, và
  // lúc xoá thì đọc được lý do ngay bên cạnh. Đo thật: khoá settings đó là no-op vì
  // CLI đóng cổng theo ENTRYPOINT (`sdk_default_off`) trước khi hỏi tới settings.
  it('bật bằng biến môi trường CLAUDE_CODE_ARTIFACT', () => {
    expect(ARTIFACT_ENV.CLAUDE_CODE_ARTIFACT).toBe('1')
  })

  it('không mang theo khoá nào khác — đây là một cổng, không phải một bộ config', () => {
    expect(Object.keys(ARTIFACT_ENV)).toEqual(['CLAUDE_CODE_ARTIFACT'])
  })
})

describe('Artifact trong transcript', () => {
  const labelOf = (input: Record<string, unknown>): string =>
    stepFromToolUse({ id: 't1', name: 'Artifact', input }).label
  const iconOf = (input: Record<string, unknown>): string =>
    stepFromToolUse({ id: 't1', name: 'Artifact', input }).tool ?? ''

  // Lỗ hổng đã cắn repo này 5 lần: thêm một tool mà quên bảng nhãn ⇒ hàng transcript
  // hiện TÊN THÔ. Khác với `list_sessions` (nơi icon `task` trùng giá trị rơi mặc
  // định nên khẳng định icon không có răng), ở đây `save` KHÁC mặc định `task`, nên
  // cả hai khẳng định dưới đều bắt được việc gỡ dòng tương ứng.
  it('publish là hành động mặc định khi thiếu `action`', () => {
    expect(labelOf({ file_path: '/tmp/report.html' })).toBe('Publish artifact')
    expect(labelOf({ action: 'publish', file_path: '/tmp/report.html' })).toBe('Publish artifact')
  })

  it('nhãn mang theo action, kẻo mọi việc khác nhau đọc như một', () => {
    expect(labelOf({ action: 'list' })).toBe('Artifact: list')
    expect(labelOf({ action: 'read', url: 'https://claude.ai/public/artifacts/x' })).toBe(
      'Artifact: read',
    )
    expect(labelOf({ action: 'upload_asset', url: 'u', file_path: '/tmp/a.png' })).toBe(
      'Artifact: upload_asset',
    )
  })

  it('icon là `save`, không phải mặc định `task`', () => {
    expect(iconOf({ file_path: '/tmp/report.html' })).toBe('save')
    expect(iconOf({ action: 'list' })).toBe('save')
  })

  // `pickTarget` đã rút `file_path`/`url` sẵn cho mọi tool, nên hàng có ngữ cảnh mà
  // không cần thêm luật riêng. Chốt lại để lần dọn `pickTarget` sau không lặng lẽ
  // làm hàng Artifact trống ngữ cảnh.
  it('hàng mang theo file đăng, hoặc URL với hành động theo URL', () => {
    expect(
      stepFromToolUse({ id: 't1', name: 'Artifact', input: { file_path: '/tmp/r.html' } }).target,
    ).toBe('/tmp/r.html')
    expect(
      stepFromToolUse({ id: 't1', name: 'Artifact', input: { action: 'read', url: 'https://x/y' } })
        .target,
    ).toBe('https://x/y')
  })
})
