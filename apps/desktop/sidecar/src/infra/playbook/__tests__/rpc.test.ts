// `infra.playbook-*` — bề mặt RPC đăng ký vào sổ của `transport/rpc.ts`.
//
// File này cố ý mỏng: nó KHÔNG kiểm lại vòng đời (đã có `runner.test.ts`), chỉ
// khoá hai thứ mà không test nào khác chạm tới —
//   · đúng MƯỜI phương thức được đăng ký, đúng tên, và tên có tiền tố `infra.`
//     (workstream UI A4 gọi thẳng chuỗi này; đổi tên lặng lẽ là UI vỡ),
//   · HAI playbook dựng sẵn của mốc 5.7 đi qua được chính `infra.playbook-list`
//     và đều thoả LUẬT SỐ MỘT (`canSubmit: true`) — một playbook dựng sẵn vi phạm
//     luật rollback là thứ không có cách nào sửa từ UI, vì nó nằm trong mã.
//
// Run với vitest: `npx vitest run src/infra/playbook/__tests__/rpc.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Nạp module để nó tự `register()` — không gọi hàm nào ở đây.
import '../../../methods/infra.playbook.js'
import { dispatch, listMethods } from '../../../transport/rpc.js'

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-playbook-rpc-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

const METHODS = [
  'infra.playbook-list',
  'infra.playbook-read',
  'infra.playbook-save',
  'infra.playbook-delete',
  'infra.playbook-preflight',
  'infra.playbook-submit',
  'infra.playbook-approve',
  'infra.playbook-run',
  'infra.playbook-rollback',
  'infra.playbook-runs',
] as const

describe('mười phương thức của playbook', () => {
  it('có mặt đủ trong sổ RPC', () => {
    const registered = new Set(listMethods())
    for (const name of METHODS) expect(registered.has(name), name).toBe(true)
  })
})

describe('hai playbook dựng sẵn (mốc 5.7)', () => {
  it('`infra.playbook-list` trả chúng trước tiên, và cả hai đều gửi duyệt được', async () => {
    const res = (await dispatch('infra.playbook-list', { projectIds: [] })) as {
      ok: boolean
      playbooks: { id: string; source: string; canSubmit: boolean; missingRollback: string[] }[]
    }

    expect(res.ok).toBe(true)
    const builtins = res.playbooks.filter((p) => p.source === 'builtin')
    expect(builtins.map((p) => p.id).sort()).toEqual(['static-site', 'teardown'])

    for (const pb of builtins) {
      // Luật số một áp cho cả playbook dựng sẵn: chúng phải có đủ cặp `do`↔`rollback`,
      // nếu không thì nút "Gửi duyệt" của chúng vĩnh viễn xám mà người dùng không
      // có cách nào sửa (chúng nằm trong mã, không trên đĩa).
      expect(pb.canSubmit, pb.id).toBe(true)
      expect(pb.missingRollback, pb.id).toEqual([])
    }
  })
})
