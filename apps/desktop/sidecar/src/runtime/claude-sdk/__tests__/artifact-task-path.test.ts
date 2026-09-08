// Đường TASK không được bật `Artifact` — và đó là một khác biệt cố ý so với đường
// chat, không phải một dòng ai đó quên chép sang.
//
// Vì sao có file này: commit 013ff66 bật `ARTIFACT_ENV` vô điều kiện ở
// claude-sdk/invoke.ts với lập luận "node ở đây đã có `Bash` dưới
// `bypassPermissions`, nên publish một trang không mở thêm hạng rủi ro nào". Phản
// ví dụ nằm ngay trong repo: tasks/engine.ts (node 'discuss') khai
// `disabledTools: ['Write','Edit','MultiEdit','NotebookEdit','Bash']` kèm đúng một
// dòng "discussion must not touch the repo" — nên KHÔNG phải node nào cũng có
// `Bash`, và một node được thiết kế để không chạm gì vẫn publish được ra URL công
// khai. Thêm nữa, công tắc của người dùng cho tool này (`disabledTools` qua
// SessionConfigPopover) là công tắc PER-SESSION, không tồn tại trên đường task: bật
// ở đây là bật một năng lực có hệ quả ra ngoài máy, chạy không người trông, mà
// không có nút nào để tắt.
//
// Phép kiểm này ĐO THẬT `options.env` mà `invokeSdkClaude` đưa cho `query()`, chứ
// không đọc mã nguồn: gỡ bản vá ra là nó đỏ, và nó đỏ vì đúng cái biến đó xuất hiện
// trở lại trong env của tiến trình con.
//
// Run: `npx vitest run src/runtime/claude-sdk/__tests__/artifact-task-path.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { InvokeArgs } from '../../../sdk/invoke.js'

// `query` giả: giữ lại `options` rồi trả về một lượt kết thúc ngay.
const captured: { options?: Options } = {}

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (input: { options?: Options }) => {
    captured.options = input.options
    return (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: 'done',
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as SDKMessage
    })()
  },
}))

// Không đụng keychain / OAuth thật.
vi.mock('../../../credentials/credential-resolver.js', () => ({
  FROZEN_TOKEN_MIN_LIFETIME_MS: 0,
  resolveCredential: async () => ({
    account: { id: 'acc-1', provider: 'anthropic' },
    cred: { kind: 'oauth', accessToken: 'test-token' },
  }),
}))

const { invokeSdkClaude } = await import('../invoke.js')

const ARGS: InvokeArgs = {
  prompt: 'Write the report.',
  settings: { provider: 'anthropic', modelId: 'claude-sonnet-5', level: 'medium' },
} as unknown as InvokeArgs

// `buildSdkEnv` chép nguyên `process.env` vào env của tiến trình con, nên một biến
// đi lạc trong môi trường của người chạy test sẽ làm phép kiểm nói dối theo cả hai
// chiều. Dọn sạch trước, trả lại sau.
let originalArtifactEnv: string | undefined

beforeEach(() => {
  originalArtifactEnv = process.env.CLAUDE_CODE_ARTIFACT
  delete process.env.CLAUDE_CODE_ARTIFACT
  captured.options = undefined
})

afterEach(() => {
  if (originalArtifactEnv === undefined) delete process.env.CLAUDE_CODE_ARTIFACT
  else process.env.CLAUDE_CODE_ARTIFACT = originalArtifactEnv
})

describe('invokeSdkClaude (đường task)', () => {
  it('KHÔNG đặt CLAUDE_CODE_ARTIFACT — task chạy không người trông và không có công tắc', async () => {
    await invokeSdkClaude(ARGS, {})
    expect(captured.options?.env).toBeDefined()
    expect(captured.options?.env).not.toHaveProperty('CLAUDE_CODE_ARTIFACT')
  })

  it('vẫn dựng env như thường — bản vá gỡ đúng một cổng, không gỡ cả env', async () => {
    await invokeSdkClaude(ARGS, {})
    // Hai cờ này do buildSdkEnv đặt cho MỌI lượt; chúng ở đây để một bản vá kiểu
    // `env: {}` không lặng lẽ đi qua phép kiểm trên.
    expect(captured.options?.env).toHaveProperty('CLAUDE_CODE_ENABLE_TODO_TOOLS', '1')
    expect(captured.options?.env).toHaveProperty('CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', '1')
  })
})
