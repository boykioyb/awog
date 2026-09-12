// Tìm binary `codex` (ADR 0087).
//
// Vì sao đáng có test: cùng một file phải chạy đúng ở BA bố cục khác nhau —
// node_modules symlink của pnpm lúc dev, cây node_modules PHẲNG mà `pnpm deploy`
// dựng cho bản đóng gói, và một CLI người dùng tự cài. Resolve sai thì lỗi không
// phải "sai đường dẫn" mà là "mọi phiên OpenAI đều không chạy được", và chỉ lộ ra
// sau khi đóng gói.
//
// Run: `npx vitest run src/runtime/codex/__tests__/binary.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CodexBinaryMissingError,
  resolveCodexBinary,
  resetCodexBinaryCache,
} from '../binary.js'

let dir: string
let prevBin: string | undefined
let prevPath: string | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'awog-codex-bin-'))
  prevBin = process.env.AWOG_CODEX_BIN
  prevPath = process.env.PATH
  resetCodexBinaryCache()
})

afterEach(async () => {
  if (prevBin === undefined) delete process.env.AWOG_CODEX_BIN
  else process.env.AWOG_CODEX_BIN = prevBin
  process.env.PATH = prevPath
  resetCodexBinaryCache()
  await rm(dir, { recursive: true, force: true })
})

describe('resolveCodexBinary', () => {
  it('honours AWOG_CODEX_BIN above everything else', async () => {
    const bin = join(dir, 'my-codex')
    await writeFile(bin, '#!/bin/sh\n', 'utf8')
    await chmod(bin, 0o755)
    process.env.AWOG_CODEX_BIN = bin
    expect(resolveCodexBinary()).toBe(bin)
  })

  it('ignores an AWOG_CODEX_BIN that does not exist and keeps looking', () => {
    // A stale override in someone's shell profile must not brick the runtime.
    process.env.AWOG_CODEX_BIN = join(dir, 'gone')
    // The bundled/dev candidate is present in this repo, so resolution succeeds.
    expect(() => resolveCodexBinary()).not.toThrow()
  })

  it('resolves the platform package from the workspace in dev', () => {
    const resolved = resolveCodexBinary()
    // pnpm links the platform package INSIDE @openai/codex's own node_modules,
    // which is why this is resolved through Node rather than by walking parents.
    expect(resolved).toContain('vendor')
    expect(resolved.endsWith('codex') || resolved.endsWith('codex.exe')).toBe(true)
  })

  it('names the fix when nothing can be found', () => {
    const err = new CodexBinaryMissingError()
    expect(err.message).toContain('CODEX_UNAVAILABLE')
    // The message has to carry the remedy: the user cannot read this source.
    expect(err.message).toContain('AWOG_CODEX_BIN')
  })

  it('caches the answer for the process', () => {
    const a = resolveCodexBinary()
    // Resolution touches the filesystem; the layout cannot change under a
    // running sidecar, so it must not be paid per turn.
    process.env.PATH = ''
    expect(resolveCodexBinary()).toBe(a)
  })
})
