// Tests cho lớp đọc dòng lệnh của màn Giám sát tài nguyên.
//
// Mọi dòng lệnh dưới đây là dòng THẬT, chép từ `ps -o args=` trên một máy đang
// chạy AWOG bản đóng gói — không phải mẫu bịa. Đó là điểm mấu chốt: cả module
// classify.ts đứng trên giả định "argv nói ra tiến trình là gì", nên bài test chỉ
// có giá trị khi nó kiểm đúng cái argv mà hệ điều hành thật sự in ra.
//
// Run: `npx vitest@2 run`.
import { describe, expect, it } from 'vitest'
import { classify, safeCommand } from '../classify.js'
import { parseDuration } from '../process-table.js'
import { matchesMarkers } from '../identity.js'

const APP = '/Applications/AWOG.app'
const CLAUDE_BIN = `${APP}/Contents/Resources/sidecar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`

describe('parseDuration', () => {
  it('đọc mm:ss.cc của `ps -o time`', () => {
    expect(parseDuration('0:00.00')).toBe(0)
    expect(parseDuration('1:30.50')).toBeCloseTo(90.5)
  })

  it('đọc hh:mm:ss và dd-hh:mm:ss của `ps -o etime`', () => {
    expect(parseDuration('17:25:03')).toBe(17 * 3600 + 25 * 60 + 3)
    expect(parseDuration('01-20:07:45')).toBe(86_400 + 20 * 3600 + 7 * 60 + 45)
  })

  it('trả 0 cho rác thay vì NaN', () => {
    expect(parseDuration('')).toBe(0)
    expect(parseDuration('n/a')).toBe(0)
  })
})

describe('classify', () => {
  it('tách được Electron main và sidecar dù CHUNG một binary', () => {
    // Sidecar chạy chính binary của Electron với ELECTRON_RUN_AS_NODE, nên khác
    // biệt duy nhất nằm ở đối số script.
    expect(classify(`${APP}/Contents/MacOS/AWOG`).kind).toBe('electron-main')
    expect(
      classify(`${APP}/Contents/MacOS/AWOG ${APP}/Contents/Resources/sidecar/lib/src/index.js`).kind,
    ).toBe('sidecar')
  })

  it('đọc loại tiến trình con của Chromium từ --type', () => {
    expect(classify(`${APP}/Contents/Frameworks/AWOG Helper (GPU).app/Contents/MacOS/AWOG Helper (GPU) --type=gpu-process`).kind).toBe('electron-gpu')
    expect(classify(`${APP}/Contents/MacOS/AWOG Helper --type=renderer --enable-features=x`).kind).toBe('electron-renderer')
    const utility = classify(
      `${APP}/Contents/MacOS/AWOG Helper --type=utility --utility-sub-type=network.mojom.NetworkService`,
    )
    expect(utility.kind).toBe('electron-utility')
    expect(utility.label).toBe('Utility · NetworkService')
  })

  it('lấy được sdkSessionId + model từ CLI của Claude Agent SDK', () => {
    const cmd = `${CLAUDE_BIN} --output-format stream-json --verbose --input-format stream-json --effort high --model claude-opus-4-8 --resume=4c0843b5-a28b-49d6-ac13-e1055aa7f91f --allowedTools Skill`
    const info = classify(cmd)
    expect(info.kind).toBe('claude-cli')
    // Đây là cầu nối duy nhất giữa một tiến trình hệ điều hành và một phiên AWOG.
    expect(info.sdkSessionId).toBe('4c0843b5-a28b-49d6-ac13-e1055aa7f91f')
    expect(info.model).toBe('claude-opus-4-8')
  })

  it('phiên MỚI (chưa có resume) vẫn là claude-cli, chỉ là chưa quy được về phiên', () => {
    const info = classify(`${CLAUDE_BIN} --output-format stream-json --input-format stream-json`)
    expect(info.kind).toBe('claude-cli')
    expect(info.sdkSessionId).toBeUndefined()
  })

  it('nhận daemon codex nhưng không nhận lệnh codex khác', () => {
    expect(classify('/usr/local/bin/codex app-server').kind).toBe('codex-daemon')
    expect(classify('/usr/local/bin/codex exec "làm gì đó"').kind).not.toBe('codex-daemon')
  })
})

describe('safeCommand', () => {
  it('khử bí mật trước khi dòng lệnh rời sidecar', () => {
    const out = safeCommand('node app.js --token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(out).not.toContain('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  })

  it('cắt dòng lệnh dài thay vì bơm cả nghìn ký tự lên UI mỗi 2 giây', () => {
    expect(safeCommand(`node ${'x'.repeat(2000)}`).length).toBeLessThanOrEqual(401)
  })
})

describe('matchesMarkers — dò tiến trình AWOG mồ côi', () => {
  const markers = [APP, '/Users/me/awog/apps/desktop/sidecar']

  it('nhận tiến trình chạy TỪ bản cài', () => {
    expect(matchesMarkers(`${APP}/Contents/MacOS/AWOG`, markers)).toBe(true)
    expect(matchesMarkers(CLAUDE_BIN, markers)).toBe(true)
    // Bản dev: `node <script trong sidecar>` ⇒ dấu nhận diện nằm ở argv[1].
    expect(matchesMarkers('/usr/bin/node /Users/me/awog/apps/desktop/sidecar/dist-dev/lib/src/index.js', markers)).toBe(true)
  })

  it('KHÔNG nhận tiến trình chỉ NHẮC TỚI đường dẫn — lỗi đã đo được', () => {
    // Trước khi sửa, so khớp trên cả dòng lệnh khiến shell này bị gắn nhãn "mồ
    // côi" và UI mời người dùng giết nó.
    expect(matchesMarkers(`/bin/zsh -c cd /Users/me/awog/apps/desktop/sidecar && node x.js`, markers)).toBe(false)
    expect(matchesMarkers(`/bin/ls ${APP}`, markers)).toBe(false)
  })
})
