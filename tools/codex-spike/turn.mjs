// Đo 3 cơ chế cần cho AWOG, bằng lượt model THẬT (tốn quota) — mỗi F là một lượt:
//   F1 dynamic tool do host phục vụ   -> item/tool/call
//   F2 permission gate                -> item/commandExecution/requestApproval (ở đây: DENY)
//   F3 steering giữa lượt             -> turn/steer
import { connect } from './client.mjs'

const t0 = Date.now()
const ms = () => String(Date.now() - t0).padStart(6)

let toolCalled = false
let approvalSeen = null
let activeTurnId = null
let turnWaiter = null
const waitTurn = () => new Promise((r) => (turnWaiter = r))

const { call, initialize, close } = connect({
  onRequest: (msg) => {
    console.log(`${ms()}ms  SERVER-REQ  ${msg.method}  ${JSON.stringify(msg.params).slice(0, 200)}`)
    if (msg.method === 'item/tool/call') {
      toolCalled = true
      // ⚠️ content item là `inputText`, KHÔNG phải `text`. Sai shape thì server không
      // báo lỗi — nó đưa chuỗi "dynamic tool response was invalid" cho model làm kết quả.
      return { contentItems: [{ type: 'inputText', text: 'PONG-FROM-AWOG-HOST' }], success: true }
    }
    if (msg.method.endsWith('requestApproval')) {
      approvalSeen = msg.method
      return { decision: { denied: { rejection: 'spike: cố tình từ chối' } } }
    }
    return {}
  },
  onNotification: (msg) => {
    if (/[Dd]elta/.test(msg.method)) return
    if (msg.method === 'turn/started') activeTurnId = msg.params?.turn?.id ?? activeTurnId
    console.log(`${ms()}ms  EVENT  ${msg.method}  ${JSON.stringify(msg.params ?? {}).slice(0, 220)}`)
    if (msg.method === 'turn/completed') {
      const w = turnWaiter
      turnWaiter = null
      w?.(msg)
    }
  },
})

await initialize()

const started = await call('thread/start', {
  cwd: process.cwd(),
  ephemeral: true,
  approvalPolicy: 'on-request',
  sandbox: 'read-only',
  model: process.env.SPIKE_MODEL || 'gpt-6-astra',
  modelProvider: process.env.SPIKE_PROVIDER || 'openai',
  dynamicTools: [
    {
      type: 'function',
      name: 'awog_ping',
      description: 'AWOG host tool. Trả về token do tiến trình host kiểm soát.',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
    },
  ],
})
const threadId = started.result?.thread?.id
if (!threadId) {
  console.log('thread/start thất bại:', JSON.stringify(started).slice(0, 500))
  close()
  process.exit(1)
}

async function turn(text) {
  const done = waitTurn()
  await call('turn/start', { threadId, effort: 'low', input: [{ type: 'text', text, text_elements: [] }] })
  return done
}

// F1 — buộc model gọi tool của host
await turn('Call the awog_ping tool with message "hi", then reply with exactly what it returned. No other text.')
console.log(`${ms()}ms  F1 dynamicToolCalled=${toolCalled}`)

// F2 — xin duyệt chạy lệnh, host từ chối => lệnh KHÔNG được chạy
await turn('Run this shell command: touch /tmp/awog-spike-should-not-exist')
console.log(`${ms()}ms  F2 approvalSeen=${approvalSeen}`)

// F3 — steer giữa một lượt đang chạy
const counting = turn('Count from 1 to 40, one number per line.')
await new Promise((r) => setTimeout(r, 2500))
const steered = await call('turn/steer', {
  threadId,
  expectedTurnId: activeTurnId,
  input: [{ type: 'text', text: 'STOP counting. Reply with exactly: STEERED', text_elements: [] }],
})
console.log(`${ms()}ms  F3 turn/steer -> ${JSON.stringify(steered.result ?? steered.error).slice(0, 200)}`)
await counting

close()
