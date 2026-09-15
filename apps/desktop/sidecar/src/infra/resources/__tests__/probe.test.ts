// Bảng ca cho bước DÒ QUYỀN (task 3.3).
//
// Ba kết cục, và cái thứ ba là cái dễ làm sai nhất: `unknown`. Nếu `unknown` bị
// xử như `denied`, người dùng có quyền thật sẽ mất nút ghi mà không hiểu vì sao —
// nên bảng ca này khoá lại đúng ba giá trị đó.
import { describe, expect, it } from 'vitest'
import { interpretSimulation } from '../probe.js'

describe('interpretSimulation', () => {
  it('mọi action allowed ⇒ allowed', () => {
    expect(
      interpretSimulation({
        EvaluationResults: [
          { EvalActionName: 'ec2:StartInstances', EvalDecision: 'allowed' },
          { EvalActionName: 'ec2:StopInstances', EvalDecision: 'allowed' },
        ],
      }),
    ).toBe('allowed')
  })

  it('một action implicitDeny ⇒ denied (thiếu quyền là thiếu quyền)', () => {
    expect(
      interpretSimulation({
        EvaluationResults: [
          { EvalActionName: 'ec2:StartInstances', EvalDecision: 'allowed' },
          { EvalActionName: 'ec2:TerminateInstances', EvalDecision: 'implicitDeny' },
        ],
      }),
    ).toBe('denied')
  })

  it('explicitDeny ⇒ denied', () => {
    expect(
      interpretSimulation({ EvaluationResults: [{ EvalDecision: 'explicitDeny' }] }),
    ).toBe('denied')
  })

  it.each([[{}], [{ EvaluationResults: [] }], [null], ['nope'], [{ EvaluationResults: 'x' }]])(
    'hình dạng lạ %j ⇒ unknown (KHÔNG phải denied)',
    (json) => {
      expect(interpretSimulation(json)).toBe('unknown')
    },
  )
})
