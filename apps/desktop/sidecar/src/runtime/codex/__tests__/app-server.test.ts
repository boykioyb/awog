// Client JSON-RPC của `codex app-server` (ADR 0087) — chạy thật với một daemon
// GIẢ (script node) thay vì mock, vì thứ dễ hỏng ở đây là FRAMING và VÒNG ĐỜI
// TIẾN TRÌNH, hai thứ mock không đo được:
//
//   - NDJSON đến theo chunk của socket, không theo dòng: một message có thể bị
//     cắt làm đôi, và hai message có thể về trong cùng một chunk.
//   - Server request (có CẢ id lẫn method) BẮT BUỘC phải được trả lời. Không trả
//     lời thì lượt park cho tới khi server bỏ cuộc — không lỗi, không log, chỉ
//     treo. Đây là đường đi của mọi approval và mọi dynamic tool call.
//   - Daemon chết giữa lượt phải reject request đang bay VÀ báo cho thread đang
//     sống, nếu không lượt chờ `turn/completed` vĩnh viễn (ADR 0087 F8).
//
// Run: `npx vitest run src/runtime/codex/__tests__/app-server.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexDaemon } from '../app-server.js'
import { resetCodexBinaryCache } from '../binary.js'

let dir: string
let prevBin: string | undefined

// A stand-in for `codex app-server`: answers `initialize`, then runs whatever
// the test script tells it to emit.
async function fakeDaemon(body: string): Promise<string> {
  const script = join(dir, `fake-${Math.random().toString(36).slice(2)}.mjs`)
  await writeFile(
    script,
    `#!/usr/bin/env node
let buf = ''
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const sendRaw = (s) => process.stdout.write(s)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  buf += c
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.method === 'initialize') { send({ jsonrpc: '2.0', id: msg.id, result: { codexHome: 'fake' } }); continue }
    onMessage(msg, send, sendRaw)
  }
})
${body}
`,
    'utf8',
  )
  await chmod(script, 0o755)
  return script
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-codex-test-'))
  prevBin = process.env.AWOG_CODEX_BIN
  resetCodexBinaryCache()
})

afterEach(async () => {
  if (prevBin === undefined) delete process.env.AWOG_CODEX_BIN
  else process.env.AWOG_CODEX_BIN = prevBin
  resetCodexBinaryCache()
  await rm(dir, { recursive: true, force: true })
})

// The fake is a .mjs file, so it must be launched through node — which is what
// AWOG_CODEX_BIN cannot express (it takes a binary, and we append `app-server`).
// A tiny shell wrapper bridges that.
async function wrap(script: string): Promise<string> {
  const sh = join(dir, 'codex')
  await writeFile(sh, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`, 'utf8')
  await chmod(sh, 0o755)
  return sh
}

describe('CodexDaemon framing', () => {
  it('reassembles a message split across chunks and splits two in one chunk', async () => {
    const script = await fakeDaemon(`
function onMessage(msg, send, sendRaw) {
  if (msg.method === 'probe') {
    // One response cut in half, with a 20ms gap; then TWO notifications in one write.
    const res = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true } }) + '\\n'
    sendRaw(res.slice(0, 12))
    setTimeout(() => {
      sendRaw(res.slice(12))
      sendRaw(
        JSON.stringify({ jsonrpc: '2.0', method: 'a', params: { threadId: 't' } }) + '\\n' +
        JSON.stringify({ jsonrpc: '2.0', method: 'b', params: { threadId: 't' } }) + '\\n'
      )
    }, 20)
  }
}`)
    process.env.AWOG_CODEX_BIN = await wrap(script)
    const daemon = new CodexDaemon(dir, '0.0.0')
    const seen: string[] = []
    const route = daemon.openRoute({
      onNotification: (n) => seen.push(n.method),
      onServerRequest: async () => ({}),
    })
    route.bind('t')
    await daemon.start()
    const res = await daemon.request('probe', {})
    expect(res).toEqual({ ok: true })
    await new Promise((r) => setTimeout(r, 60))
    expect(seen).toEqual(['a', 'b'])
    daemon.kill('test done')
  })

  it('survives a non-JSON line on stdout instead of dying on it', async () => {
    const script = await fakeDaemon(`
function onMessage(msg, send, sendRaw) {
  if (msg.method === 'probe') {
    sendRaw('this is not json\\n')
    send({ jsonrpc: '2.0', id: msg.id, result: { ok: 1 } })
  }
}`)
    process.env.AWOG_CODEX_BIN = await wrap(script)
    const daemon = new CodexDaemon(dir, '0.0.0')
    await daemon.start()
    // Killing the daemon over a stray print would be worse than ignoring it.
    await expect(daemon.request('probe', {})).resolves.toEqual({ ok: 1 })
    daemon.kill('test done')
  })
})

describe('CodexDaemon server requests', () => {
  it('answers a server request from the bound thread handler', async () => {
    const script = await fakeDaemon(`
function onMessage(msg, send) {
  if (msg.method === 'go') {
    send({ jsonrpc: '2.0', id: 99, method: 'item/tool/call', params: { threadId: 't', tool: 'x' } })
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
  }
  if (msg.id === 99) { /* our answer came back — echo it out as a notification */ }
}
process.stdin.on('data', () => {})`)
    process.env.AWOG_CODEX_BIN = await wrap(script)
    const daemon = new CodexDaemon(dir, '0.0.0')
    let asked: string | undefined
    const route = daemon.openRoute({
      onNotification: () => {},
      onServerRequest: async (method) => {
        asked = method
        return { contentItems: [], success: true }
      },
    })
    route.bind('t')
    await daemon.start()
    await daemon.request('go', {})
    await new Promise((r) => setTimeout(r, 50))
    expect(asked).toBe('item/tool/call')
    daemon.kill('test done')
  })

  it('declines — in the right shape — when no thread owns the request', async () => {
    // Answering SOMETHING is mandatory. Which "no" depends on the family: a
    // dynamic tool call wants contentItems, an approval wants a decision — the
    // server validates the shape, so a generic {} would be as bad as silence.
    const out = join(dir, 'answers.json')
    const script = await fakeDaemon(`
import { writeFileSync } from 'node:fs'
const answers = {}
function onMessage(msg, send) {
  if (msg.method === 'go') {
    send({ jsonrpc: '2.0', id: 11, method: 'item/tool/call', params: { threadId: 'other', tool: 'x' } })
    send({ jsonrpc: '2.0', id: 12, method: 'item/commandExecution/requestApproval', params: { threadId: 'other' } })
    send({ jsonrpc: '2.0', id: 13, method: 'item/tool/requestUserInput', params: { threadId: 'other' } })
    send({ jsonrpc: '2.0', id: msg.id, result: {} })
    return
  }
  if (msg.id >= 11 && msg.id <= 13) {
    answers[msg.id] = msg.result
    if (Object.keys(answers).length === 3) writeFileSync(${JSON.stringify(out)}, JSON.stringify(answers))
  }
}`)
    process.env.AWOG_CODEX_BIN = await wrap(script)
    const daemon = new CodexDaemon(dir, '0.0.0')
    await daemon.start()
    await daemon.request('go', {})
    await new Promise((r) => setTimeout(r, 200))
    const answers = JSON.parse(await readFile(out, 'utf8')) as Record<string, unknown>
    expect(answers['11']).toEqual({
      contentItems: [{ type: 'inputText', text: 'AWOG could not run this tool.' }],
      success: false,
    })
    expect(answers['12']).toEqual({ decision: 'decline' })
    expect(answers['13']).toEqual({ answers: {} })
    daemon.kill('test done')
  })
})

describe('CodexDaemon exit', () => {
  it('rejects an in-flight request and tells the live thread when the process dies', async () => {
    const script = await fakeDaemon(`
function onMessage(msg) {
  if (msg.method === 'die') process.exit(3)
}`)
    process.env.AWOG_CODEX_BIN = await wrap(script)
    const daemon = new CodexDaemon(dir, '0.0.0')
    const notes: string[] = []
    const route = daemon.openRoute({
      onNotification: (n) => notes.push(n.method),
      onServerRequest: async () => ({}),
    })
    route.bind('t')
    await daemon.start()
    // Without this, a turn waits forever for a turn/completed that cannot arrive.
    await expect(daemon.request('die', {})).rejects.toThrow(/exited/)
    expect(notes).toContain('awog/daemonExited')
    expect(daemon.alive).toBe(false)
  })
})
