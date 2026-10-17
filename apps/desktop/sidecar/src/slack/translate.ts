// Dịch tin Slack, có cache theo `ts:editedTs:lang:<biến thể>:sha1(text)`.
//
// ts + editedTs định danh một phiên bản tin (sửa tin thì `edited.ts` đổi ⇒ khoá
// tự đổi). Nhưng `text` do RENDERER gửi lên (L1): nếu khoá chỉ có ts thì một
// renderer bị chiếm gửi ts của tin thật kèm chữ bịa sẽ ghi bản "dịch" bịa vào
// cache, rồi cửa sổ kia đọc ra như bản dịch của tin thật. Thêm 12 hex đầu của
// sha1(text) vào khoá ⇒ chữ khác thì khoá khác, không đầu độc được tin thật.
// Cache sống qua lần khởi động lại: mở lại thread cũ không tốn lại tiền gọi model.
//
// <biến thể> = phong cách dịch + cờ giữ chữ Nhật + hash bảng thuật ngữ (cài đặt Slack):
// đổi một trong ba thì bản dịch cũ KHÔNG còn đúng cài đặt mới ⇒ khoá khác ⇒ dịch lại,
// không trả bản cũ ra như thể đã theo cài đặt mới.
//
// Token Slack (`<@U…>`, `<#C…|x>`, `<url|chữ>`, `<!here>`, `:emoji:`) được thay
// bằng placeholder trước khi dịch rồi trả lại sau. Chỉ dặn model "giữ nguyên"
// là không đủ: model hay dịch luôn phần chữ trong `<url|chữ>` hoặc đổi
// `:thumbsup:` thành 👍, làm UI không còn dựng lại được chip.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { translateText, type TranslateArgs } from '../runtime/translate.js'
import {
  buildSlackTranslatePrompt,
  loadGlossary,
  type PromptOptions,
  type TranslateDirection,
} from './translate-prompt.js'
import { log } from '../util/logger.js'
import { mapLimit } from './concurrency.js'
import { teamCacheDir } from './directory.js'
import { readJsonFile, serialize, writeJsonAtomic } from './json-file.js'
import { getSlackSettings } from './settings.js'

const TRANSLATE_CONCURRENCY = 3
// Trần số bản dịch giữ trong cache mỗi workspace — bỏ cái cũ nhất (thứ tự chèn).
const CACHE_MAX_ENTRIES = 5000

const CacheSchema = z.record(z.string())

// Giữ export cũ (method + test import từ đây); định nghĩa ở params.ts.
export { TARGET_LANG_RE, TargetLangSchema } from './params.js'

type ModelArgs = Omit<TranslateArgs, 'text' | 'targetLang'>

export type TranslateItem = { ts: string; editedTs: string | null; text: string }

const TOKEN_RE = /<[^<>\n]+>|:[\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{1,100}:(?::skin-tone-[2-6]:)?/gu
const PLACEHOLDER_RE = /[⟦[]\s*S(\d+)\s*[⟧\]]/g

export type Protected = { text: string; tokens: string[] }

export function protectTokens(text: string): Protected {
  const tokens: string[] = []
  const out = text.replace(TOKEN_RE, (tok) => {
    tokens.push(tok)
    return `⟦S${tokens.length - 1}⟧`
  })
  return { text: out, tokens }
}

// Trả token về chỗ. Token model làm rơi mất thì nối lại cuối câu: mất một
// mention trong bản dịch tệ hơn là nó đứng sai chỗ.
export function restoreTokens(translated: string, tokens: readonly string[]): string {
  const used = new Set<number>()
  let out = translated.replace(PLACEHOLDER_RE, (whole, n: string) => {
    const i = Number(n)
    const tok = tokens[i]
    if (tok === undefined) return whole
    used.add(i)
    return tok
  })
  const lost = tokens.filter((_, i) => !used.has(i))
  if (lost.length > 0) {
    log.warn('slack: translation dropped tokens', { count: lost.length })
    out = `${out.trimEnd()} ${lost.join(' ')}`
  }
  return out
}

export function escapeAngles(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const TEXT_HASH_LEN = 12
const GLOSSARY_HASH_LEN = 8
const CACHE_VERSION = 'v3'

// Ngữ cảnh dịch do sidecar tự đọc (renderer không gửi): cài đặt Slack + bảng thuật ngữ.
export type TranslateContext = PromptOptions & { glossary: string }

export async function loadTranslateContext(): Promise<TranslateContext> {
  const [settings, glossary] = await Promise.all([getSlackSettings(), loadGlossary()])
  const { style, keepJapaneseTerms } = settings.translate
  return { style, keepJapaneseTerms, glossary }
}

const sha1Hex = (s: string, len: number): string =>
  createHash('sha1').update(s, 'utf8').digest('hex').slice(0, len)

// Đoạn khoá cache theo cài đặt: `precise:j:<hash thuật ngữ>` (`j` = giữ chữ Nhật, `t` = chỉ dịch nghĩa).
export function translateVariant(ctx: TranslateContext): string {
  return `${ctx.style}:${ctx.keepJapaneseTerms ? 'j' : 't'}:${sha1Hex(ctx.glossary, GLOSSARY_HASH_LEN)}`
}

export function cacheKey(
  item: { ts: string; editedTs: string | null; text: string },
  lang: string,
  variant: string,
): string {
  const hash = sha1Hex(item.text, TEXT_HASH_LEN)
  // CACHE_VERSION: đổi prompt/cách dịch ⇒ bỏ các bản dịch cũ. v2 → v3: khoá thêm biến thể
  // cài đặt (phong cách + thuật ngữ) — bản v2 không biết mình dịch theo cài đặt nào.
  return `${CACHE_VERSION}:${item.ts}:${item.editedTs ?? ''}:${lang}:${variant}:${hash}`
}

function cacheFile(teamId: string): string {
  return join(teamCacheDir(teamId), 'translations.json')
}

async function loadCache(teamId: string): Promise<Record<string, string>> {
  return (await readJsonFile(cacheFile(teamId), CacheSchema)) ?? {}
}

async function saveEntries(teamId: string, entries: Record<string, string>): Promise<void> {
  if (Object.keys(entries).length === 0) return
  await serialize(`slack-tr-${teamId}`, async () => {
    const cache = { ...(await loadCache(teamId)), ...entries }
    const keys = Object.keys(cache)
    const trimmed =
      keys.length > CACHE_MAX_ENTRIES
        ? Object.fromEntries(keys.slice(keys.length - CACHE_MAX_ENTRIES).map((k) => [k, cache[k]]))
        : cache
    await writeJsonAtomic(cacheFile(teamId), trimmed)
  })
}

// Dịch một đoạn mrkdwn (không cache) — dùng cho cả chiều đọc lẫn chiều gửi đi.
//
// GIỮ THỨ TỰ: dịch THEO DÒNG. Gửi cả tin với placeholder thì model hay làm rơi
// ⟦S…⟧ (nhất là dòng chỉ có một link/mention), và token rơi bị nối xuống CUỐI TIN —
// link của từng mục dồn hết về cuối, mention đầu tin chạy ra sau (đo 2026-10-16). Nên:
//  - dòng chỉ gồm token/khoảng trắng (link riêng một dòng, dòng mention) giữ nguyên
//    tại chỗ, KHÔNG gửi model;
//  - các dòng còn lại gửi MỘT lần dạng mảng JSON (model vẫn thấy cả tin làm ngữ cảnh),
//    bắt trả mảng cùng độ dài, cùng thứ tự;
//  - trả sai hình (không phải mảng / lệch độ dài) ⇒ dịch lại từng dòng một;
//  - token bị rơi chỉ nối vào cuối DÒNG chứa nó, không phải cuối tin.
//
// `ctx` vắng ⇒ tự đọc cài đặt + thuật ngữ (chiều gửi đi gọi một lần, không cần đọc trước).
export async function translateSlackText(
  text: string,
  targetLang: string,
  model: ModelArgs,
  direction: TranslateDirection = 'incoming',
  ctx?: TranslateContext,
): Promise<string> {
  if (!text.trim()) return text
  const lines = text.split('\n')
  const prots = lines.map((line) => protectTokens(line))
  const todo: number[] = []
  prots.forEach((p, i) => {
    if (p.text.replace(/⟦S\d+⟧/g, '').trim()) todo.push(i)
  })
  // Chỉ toàn token (một emoji, một link) ⇒ không có gì để dịch.
  if (todo.length === 0) return text

  const c = ctx ?? (await loadTranslateContext())
  const systemPrompt = buildSlackTranslatePrompt(targetLang, direction, c.glossary, c)
  const translated = await translateLines(
    todo.map((i) => prots[i]?.text ?? ''),
    targetLang,
    model,
    systemPrompt,
  )
  const out = [...lines]
  todo.forEach((lineIdx, k) => {
    const prot = prots[lineIdx]
    const tr = translated[k]
    if (!prot || tr === undefined) return
    // Mọi token THẬT đã nằm trong placeholder, nên `<`/`>` còn trong câu trả lời là do
    // model tự tạo — có thể là `<!channel>` hay `<url|nhãn>` mà một câu injection trong
    // tin đã xúi. Mã hoá thành chữ trước khi trả token gốc về chỗ: chỉ token có trong
    // nguồn mới thành cú pháp Slack.
    out[lineIdx] = restoreTokens(escapeAngles(tr), prot.tokens)
  })
  return out.join('\n')
}

const LINES_FORMAT = `

INPUT FORMAT: the user message is a JSON array of strings — the lines of ONE Slack message, in order (lines that only hold a link or mention were removed and stay where they are). Translate every element using the whole array as context. Return ONLY a JSON array of strings with EXACTLY the same number of elements, in the same order, one translated line per element. Never merge, split, reorder or drop elements; an element that needs no translation is returned unchanged. No markdown fence, no commentary.`

async function translateLines(
  segments: string[],
  targetLang: string,
  model: ModelArgs,
  systemPrompt: string,
): Promise<string[]> {
  if (segments.length === 1) {
    const one = await translateText(
      { ...model, text: segments[0] ?? '', targetLang },
      { systemPrompt },
    )
    return [one.trim()]
  }
  const raw = await translateText(
    { ...model, text: JSON.stringify(segments), targetLang },
    { systemPrompt: systemPrompt + LINES_FORMAT },
  )
  const parsed = parseLineArray(raw, segments.length)
  if (parsed) return parsed
  log.warn('slack: line-array translation came back malformed, falling back per line', {
    lines: segments.length,
  })
  // Lượt dự phòng tuần tự: hiếm, và chạy song song thì nhân số lời gọi model lên.
  const out: string[] = []
  for (const seg of segments) {
    // eslint-disable-next-line no-await-in-loop -- dự phòng tuần tự có chủ ý
    out.push((await translateText({ ...model, text: seg, targetLang }, { systemPrompt })).trim())
  }
  return out
}

// Mảng chuỗi đúng độ dài, hoặc null. Chịu được model bọc thêm chữ quanh mảng.
export function parseLineArray(raw: string, expected: number): string[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const val: unknown = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(val) || val.length !== expected) return null
    if (!val.every((v): v is string => typeof v === 'string')) return null
    return val.map((v) => v.replace(/\n+$/, ''))
  } catch {
    return null
  }
}

// Dịch nhiều tin của một thread. Lỗi từng tin không chặn tin khác; chỉ khi
// TẤT CẢ tin cần gọi model đều hỏng mới ném lỗi (để UI hiện lý do).
export async function translateItems(
  teamId: string,
  items: readonly TranslateItem[],
  targetLang: string,
  model: ModelArgs,
): Promise<Record<string, string>> {
  // Đọc cài đặt MỘT lần cho cả lô: khoá cache và prompt cùng một biến thể, kể cả khi
  // người dùng đổi cài đặt giữa chừng.
  const ctx = await loadTranslateContext()
  const variant = translateVariant(ctx)
  const cache = await loadCache(teamId)
  const texts: Record<string, string> = {}
  const pending: TranslateItem[] = []
  for (const item of items) {
    const hit = cache[cacheKey(item, targetLang, variant)]
    if (hit !== undefined) texts[item.ts] = hit
    else if (!item.text.trim()) texts[item.ts] = item.text
    else pending.push(item)
  }
  if (pending.length === 0) return texts

  const fresh: Record<string, string> = {}
  let lastErr: unknown = null
  await mapLimit(pending, TRANSLATE_CONCURRENCY, async (item) => {
    try {
      const out = await translateSlackText(item.text, targetLang, model, 'incoming', ctx)
      texts[item.ts] = out
      fresh[cacheKey(item, targetLang, variant)] = out
    } catch (err) {
      lastErr = err
    }
  })
  try {
    await saveEntries(teamId, fresh)
  } catch (err) {
    log.warn('slack: failed to write translation cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  if (Object.keys(fresh).length === 0 && lastErr) throw lastErr
  return texts
}
