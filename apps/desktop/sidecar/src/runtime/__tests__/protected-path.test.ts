// Đường ghi mà agent KHÔNG bao giờ được chạm (`touchesProtectedPath` trong
// runtime/permission.ts).
//
// Vì sao file này tồn tại: danh sách đó là một REGEX, và một regex thì lặng lẽ
// lỗi thời. Audit #2 của Mốc 1 bắt đúng lớp lỗi ấy — A8 dựng file mới
// `~/.awog/infra/account-ids.json` nuôi `accountKindOf()` (vắng accountId ⇒
// `production`), nhưng regex vẫn chỉ kể tên hai đường cũ, nên một entry bịa ghi
// vào đó đi thẳng qua cổng quyền. Không có test nào bắt được vì lúc ấy chưa có
// test nào cho danh sách này.
//
// Hai nửa đều load-bearing: nửa "phải chặn" khoá lỗ, nửa "KHÔNG được chặn" giữ
// cho regex không nở ra thành một luật bắt nhầm mọi thứ có chữ `infra` (một rào
// chắn bắt nhầm là một rào chắn sẽ bị gỡ).
//
// Run: `npx vitest run src/runtime/__tests__/protected-path.test.ts`
import { describe, expect, it } from 'vitest'
import { touchesProtectedPath } from '../permission.js'

// Đủ ba đường được che, ở cả dạng đường tuyệt đối lẫn dạng `~` chưa resolve —
// chuỗi shell không bao giờ được resolve trước khi tới cổng, nên cả hai dạng
// đều phải khớp.
const PROTECTED = [
  '/Users/kyro/.awog/infra-policy.json',
  '~/.awog/infra-policy.json',
  '/Users/kyro/.awog/infra-audit/2026-09.jsonl',
  '~/.awog/infra-audit/2026-09.jsonl',
  '/Users/kyro/.awog/infra/account-ids.json',
  '~/.awog/infra/account-ids.json',
]

// Đường KHÔNG được chặn: file thường của người dùng, kể cả file có tên gần
// giống. `account-ids.json` trần (không có thư mục `infra/` phía trước) nằm ở
// đây vì nó không phải file của AWOG.
const ALLOWED = [
  '/Users/kyro/code/app/src/infra/index.ts',
  '/Users/kyro/code/app/account-ids.json',
  '/Users/kyro/code/app/infra-policy.md',
  '/Users/kyro/.awog/settings.json',
]

describe('touchesProtectedPath — Write/Edit', () => {
  it.each(PROTECTED)('chặn Write vào %s', (file_path) => {
    expect(touchesProtectedPath('Write', { file_path })).toBe(true)
  })

  it.each(ALLOWED)('cho Write vào %s', (file_path) => {
    expect(touchesProtectedPath('Write', { file_path })).toBe(false)
  })

  it('chặn mọi tool ghi, không riêng Write', () => {
    const file_path = '/Users/kyro/.awog/infra/account-ids.json'
    for (const tool of ['Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(touchesProtectedPath(tool, { file_path })).toBe(true)
    }
    // Tool ĐỌC không bị chặn ở cổng này — nó chỉ nói về đường GHI.
    expect(touchesProtectedPath('Read', { file_path })).toBe(false)
  })
})

describe('touchesProtectedPath — Bash', () => {
  it.each(PROTECTED)('chặn lệnh shell chạm %s', (path) => {
    expect(touchesProtectedPath('Bash', { command: `echo '{}' > ${path}` })).toBe(true)
  })

  it('chặn cả khi đường dẫn nằm giữa một lệnh dài', () => {
    expect(
      touchesProtectedPath('Bash', {
        command: 'cd /tmp && jq \'.entries += [{}]\' ~/.awog/infra/account-ids.json | sponge x',
      }),
    ).toBe(true)
  })

  it.each(ALLOWED)('cho lệnh shell chạm %s', (path) => {
    expect(touchesProtectedPath('Bash', { command: `cat ${path}` })).toBe(false)
  })

  it('args không phải object / thiếu trường ⇒ không chặn, không ném', () => {
    expect(touchesProtectedPath('Bash', null)).toBe(false)
    expect(touchesProtectedPath('Bash', { command: 42 })).toBe(false)
    expect(touchesProtectedPath('Write', {})).toBe(false)
  })
})
