// `infra.identity-check` — hai chế độ loại trừ nhau, và bất biến của chế độ
// `secrets`: khoá đi bằng ENV (không thấy được từ `ps`), không bao giờ bằng cờ.
import { describe, expect, it } from 'vitest'
import { IdentityCheckParams, identityContext, secretsEnv } from '../infra.identity-check.js'

const SECRETS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI-K7MDENG-bpRfiCYEXAMPLEKEY',
}

describe('IdentityCheckParams — đúng một trong hai nguồn danh tính', () => {
  it('nhận `profile`', () => {
    expect(IdentityCheckParams.safeParse({ profile: 'dev' }).success).toBe(true)
  })

  it('nhận `secrets`', () => {
    expect(IdentityCheckParams.safeParse({ secrets: SECRETS }).success).toBe(true)
  })

  it('TỪ CHỐI khi thiếu cả hai (không có danh tính nào để kiểm)', () => {
    expect(IdentityCheckParams.safeParse({}).success).toBe(false)
  })

  it('TỪ CHỐI khi có cả hai (hai nguồn danh tính mâu thuẫn nhau)', () => {
    expect(
      IdentityCheckParams.safeParse({ profile: 'dev', secrets: SECRETS }).success,
    ).toBe(false)
  })

  it('TỪ CHỐI bộ khoá thiếu nửa sau', () => {
    expect(IdentityCheckParams.safeParse({ secrets: { accessKeyId: 'AKIA…' } }).success).toBe(
      false,
    )
  })
})

describe('secretsEnv — chỉ ba tên biến chuẩn của AWS', () => {
  it('không có session token ⇒ env đúng hai biến', () => {
    expect(secretsEnv(SECRETS)).toEqual({
      AWS_ACCESS_KEY_ID: SECRETS.accessKeyId,
      AWS_SECRET_ACCESS_KEY: SECRETS.secretAccessKey,
    })
  })

  it('có session token ⇒ thêm AWS_SESSION_TOKEN', () => {
    expect(secretsEnv({ ...SECRETS, sessionToken: 'tok' })).toEqual({
      AWS_ACCESS_KEY_ID: SECRETS.accessKeyId,
      AWS_SECRET_ACCESS_KEY: SECRETS.secretAccessKey,
      AWS_SESSION_TOKEN: 'tok',
    })
  })

  it('KHÔNG bao giờ đặt AWS_PROFILE — hai nguồn danh tính trên cùng tiến trình', () => {
    const env = secretsEnv({ ...SECRETS, sessionToken: 'tok' })
    expect(Object.keys(env).some((k) => k === 'AWS_PROFILE')).toBe(false)
  })
})

describe('identityContext — ngữ cảnh là context, không phải cờ của argv', () => {
  it('chế độ secrets: context rỗng (không profile) + region nếu có', () => {
    expect(identityContext(undefined, 'ap-southeast-1')).toEqual({ region: 'ap-southeast-1' })
    expect(identityContext(undefined, undefined)).toEqual({})
  })

  it('chế độ profile: profile + region, bỏ khoá vắng mặt', () => {
    expect(identityContext('dev', undefined)).toEqual({ profile: 'dev' })
  })
})
