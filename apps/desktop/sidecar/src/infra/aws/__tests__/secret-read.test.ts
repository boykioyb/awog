// `readStaticSecrets()` — đường ĐỌC secret duy nhất của AWOG, nên test phải đo
// cả thứ nó KHÔNG trả về, không chỉ thứ nó trả về.
//
// Mọi ca chạy trong thư mục tạm (`HOME` + hai biến `AWS_*` đổi chỗ file) — không
// ca nào chạm `~/.aws` thật của người chạy test.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readStaticSecrets } from '../secret-read.js'

const KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
const SECRET = 'wJalrXUtnFEMI-K7MDENG-bpRfiCYEXAMPLEKEY'
const TOKEN = 'IQoJb3JpZ2luX2VjEXAMPLEtoken0000'

let dir = ''
let configPath = ''
let credentialsPath = ''
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-secret-read-'))
  await mkdir(join(dir, 'aws'), { recursive: true })
  configPath = join(dir, 'aws', 'config')
  credentialsPath = join(dir, 'aws', 'credentials')
  for (const k of ['HOME', 'USERPROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE']) {
    savedEnv[k] = process.env[k]
  }
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  process.env.AWS_CONFIG_FILE = configPath
  process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsPath
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function seedCredentials(text: string): Promise<void> {
  await writeFile(credentialsPath, text, 'utf8')
}
async function seedConfig(text: string): Promise<void> {
  await writeFile(configPath, text, 'utf8')
}

describe('readStaticSecrets — ba khoá của đúng profile được yêu cầu', () => {
  it('đọc đủ bộ ba, và KHÔNG trả khoá của profile khác', async () => {
    await seedCredentials(
      [
        '[dev]',
        `aws_access_key_id = ${KEY_ID}`,
        `aws_secret_access_key = ${SECRET}`,
        `aws_session_token = ${TOKEN}`,
        '',
        '[prod]',
        'aws_access_key_id = AKIAOTHERKEY00000000',
        'aws_secret_access_key = other-secret',
        '',
      ].join('\n'),
    )
    const got = await readStaticSecrets('dev')
    expect(got).toEqual({
      accessKeyId: KEY_ID,
      secretAccessKey: SECRET,
      sessionToken: TOKEN,
    })
    expect(JSON.stringify(got)).not.toContain('other-secret')
  })

  it('CRLF + comment + khoá lạ: giá trị vẫn đúng, khoá lạ không lọt vào kết quả', async () => {
    await seedCredentials(
      [
        '; comment đầu file',
        '[dev]',
        `aws_access_key_id = ${KEY_ID}`,
        '# comment giữa section',
        `aws_secret_access_key = ${SECRET}`,
        'endpoint_url = https://evil.example.com',
        'x_custom_key = không-được-trả-về',
        '',
      ].join('\r\n'),
    )
    const got = await readStaticSecrets('dev')
    expect(got.accessKeyId).toBe(KEY_ID)
    expect(got.secretAccessKey).toBe(SECRET)
    expect(JSON.stringify(got)).not.toContain('evil.example.com')
    expect(JSON.stringify(got)).not.toContain('không-được-trả-về')
  })

  it('khoá trùng trong cùng section: cái SAU thắng', async () => {
    await seedCredentials(
      ['[dev]', 'aws_access_key_id = FIRST', 'aws_access_key_id = SECOND', ''].join('\n'),
    )
    expect((await readStaticSecrets('dev')).accessKeyId).toBe('SECOND')
  })

  it('profile `dev` KHÔNG lấy khoá của section `[developer]` (khớp tên tuyệt đối)', async () => {
    await seedCredentials(['[developer]', 'aws_access_key_id = LEAK', ''].join('\n'))
    expect((await readStaticSecrets('dev')).accessKeyId).toBe('')
  })
})

describe('readStaticSecrets — file `config` và thứ tự thắng của botocore', () => {
  it('config đọc `[profile x]`; section `[x]` trần trong config bị BỎ QUA', async () => {
    await seedConfig(
      [
        '[profile dev]',
        'aws_access_key_id = FROM_PROFILE_BLOCK',
        '',
        '[dev]',
        'aws_access_key_id = FROM_BARE_SECTION',
        '',
      ].join('\n'),
    )
    expect((await readStaticSecrets('dev')).accessKeyId).toBe('FROM_PROFILE_BLOCK')
  })

  it('`default` đọc `[default]` của config', async () => {
    await seedConfig(['[default]', `aws_access_key_id = ${KEY_ID}`, ''].join('\n'))
    expect((await readStaticSecrets('default')).accessKeyId).toBe(KEY_ID)
  })

  it('credentials THẮNG config khi hai file khai cùng khoá', async () => {
    await seedConfig(['[profile dev]', 'aws_access_key_id = FROM_CONFIG', ''].join('\n'))
    await seedCredentials(['[dev]', 'aws_access_key_id = FROM_CREDENTIALS', ''].join('\n'))
    expect((await readStaticSecrets('dev')).accessKeyId).toBe('FROM_CREDENTIALS')
  })

  it('khoá chỉ có ở config vẫn được nhặt khi credentials thiếu', async () => {
    await seedConfig(['[profile dev]', 'aws_secret_access_key = CONFIG_SECRET', ''].join('\n'))
    await seedCredentials(['[dev]', 'aws_access_key_id = FROM_CREDENTIALS', ''].join('\n'))
    const got = await readStaticSecrets('dev')
    expect(got.accessKeyId).toBe('FROM_CREDENTIALS')
    expect(got.secretAccessKey).toBe('CONFIG_SECRET')
  })
})

describe('readStaticSecrets — trạng thái rỗng và đầu vào không hợp lệ', () => {
  it('thiếu file ⇒ ba chuỗi rỗng, KHÔNG ném', async () => {
    expect(await readStaticSecrets('dev')).toEqual({
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
    })
  })

  it('section có nhưng khoá rỗng (hoặc bị block thụt che) ⇒ không trả giá trị', async () => {
    await seedCredentials(
      ['[dev]', 'aws_access_key_id =', '  aws_secret_access_key = NESTED', ''].join('\n'),
    )
    const got = await readStaticSecrets('dev')
    expect(got.accessKeyId).toBe('')
    expect(got.secretAccessKey).toBe('')
  })

  it('tên profile không hợp lệ ⇒ ném INVALID_NAME (không đọc file)', async () => {
    await expect(readStaticSecrets('dev\n[prod]')).rejects.toThrow(/INVALID_NAME/)
  })
})
