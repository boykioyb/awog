// Thư viện snippet của terminal — lệnh hay dùng, theo project (+ tầng Global dùng chung).
//
// Trước đây snippet chỉ sống trong localStorage của renderer, nên agent không đọc
// hay ghi được. Giờ sidecar là nguồn duy nhất: một file `~/.awog/terminal-snippets.json`
// (snippet là tiện ích của MÁY này, không thuộc repo — không ghi vào `{project}/.awog`
// để khỏi lẫn vào git). UI và tool của agent cùng đi qua module này, và mọi lần ghi
// phát `terminalSnippets.changed` để rail trên UI cập nhật ngay khi agent sửa.
//
// Không có bí mật trong snippet theo thiết kế, nhưng file vẫn ghi 0600 như mọi file
// khác trong AWOG home.

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

export const MAX_SNIPPETS = 500
export const MAX_SNIPPET_NAME_LEN = 120
export const MAX_SNIPPET_COMMAND_LEN = 4000
export const SNIPPET_ID_RE = /^tsnip-[a-z0-9-]{1,64}$/

const SnippetSchema = z.object({
  id: z.string().regex(SNIPPET_ID_RE),
  name: z.string().min(1).max(MAX_SNIPPET_NAME_LEN),
  command: z.string().min(1).max(MAX_SNIPPET_COMMAND_LEN),
  // null = Global (hiện ở mọi project); còn lại = id project sở hữu.
  project: z.string().min(1).max(200).nullable(),
  updatedAt: z.number().int().nonnegative().optional(),
})
export type TerminalSnippet = z.infer<typeof SnippetSchema>

const FileSchema = z.object({
  version: z.literal(1),
  snippets: z.array(z.unknown()),
})

function snippetsFile(): string {
  return join(awogHome(), 'terminal-snippets.json')
}

// Đọc ở biên tin cậy (file trong AWOG home là L2 — sửa tay được): bỏ từng entry hỏng
// thay vì làm hỏng cả thư viện.
export async function listSnippets(): Promise<TerminalSnippet[]> {
  let raw: string
  try {
    raw = await readFile(snippetsFile(), 'utf8')
  } catch {
    return []
  }
  try {
    const file = FileSchema.parse(JSON.parse(raw))
    const out: TerminalSnippet[] = []
    for (const e of file.snippets) {
      const r = SnippetSchema.safeParse(e)
      if (r.success) out.push(r.data)
    }
    return out
  } catch (err) {
    log.warn('terminal-snippets: unreadable file, treating as empty', {
      err: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

// Snippet thấy được từ một project: của chính project đó + tầng Global.
export async function listSnippetsFor(project: string | null): Promise<TerminalSnippet[]> {
  const all = await listSnippets()
  return all.filter((s) => s.project === null || (project !== null && s.project === project))
}

async function writeAll(snippets: TerminalSnippet[]): Promise<void> {
  const dir = awogHome()
  await mkdir(dir, { recursive: true })
  const file = snippetsFile()
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify({ version: 1, snippets }, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  emit('terminalSnippets.changed', { count: snippets.length })
}

// Ghi tuần tự: UI và agent có thể ghi cùng lúc, đọc-sửa-ghi chồng nhau thì mất bản.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => undefined)
  return next
}

let counter = 0
function nextId(): string {
  counter += 1
  return `tsnip-${Date.now().toString(36)}-${counter.toString(36)}`
}

export class SnippetError extends Error {}

export type SnippetInput = {
  id?: string | undefined
  name: string
  command: string
  project: string | null
}

// Tạo mới (không có id) hoặc sửa (có id). Trả về bản đã lưu.
export function upsertSnippet(input: SnippetInput): Promise<TerminalSnippet> {
  return serial(async () => {
    const name = input.name.trim()
    const command = input.command.replace(/\s+$/, '')
    if (!name) throw new SnippetError('Snippet name is empty.')
    if (!command.trim()) throw new SnippetError('Snippet command is empty.')
    const all = await listSnippets()
    const now = Date.now()
    if (input.id) {
      const i = all.findIndex((s) => s.id === input.id)
      if (i < 0) throw new SnippetError(`No snippet with id "${input.id}".`)
      const next = SnippetSchema.parse({ ...all[i], name, command, project: input.project, updatedAt: now })
      all[i] = next
      await writeAll(all)
      return next
    }
    if (all.length >= MAX_SNIPPETS) throw new SnippetError(`Snippet library is full (${MAX_SNIPPETS}).`)
    const next = SnippetSchema.parse({ id: nextId(), name, command, project: input.project, updatedAt: now })
    all.push(next)
    await writeAll(all)
    return next
  })
}

export function deleteSnippet(id: string): Promise<TerminalSnippet> {
  return serial(async () => {
    const all = await listSnippets()
    const hit = all.find((s) => s.id === id)
    if (!hit) throw new SnippetError(`No snippet with id "${id}".`)
    await writeAll(all.filter((s) => s.id !== id))
    return hit
  })
}

// Chuyển thư viện cũ từ localStorage của renderer sang file — CHỈ khi file chưa có
// snippet nào, để chạy lại (hai cửa sổ, reload) không nhân đôi. Entry hỏng bị bỏ.
export function importSnippets(raw: unknown[]): Promise<{ imported: number }> {
  return serial(async () => {
    const existing = await listSnippets()
    if (existing.length > 0) return { imported: 0 }
    const out: TerminalSnippet[] = []
    for (const e of raw.slice(0, MAX_SNIPPETS)) {
      const r = SnippetSchema.safeParse(e)
      if (r.success) out.push(r.data)
    }
    if (out.length > 0) await writeAll(out)
    return { imported: out.length }
  })
}
