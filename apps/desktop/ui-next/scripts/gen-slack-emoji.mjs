// Sinh assets/slack-emoji.json (shortcode Slack → unicode) từ emoji.json của
// emoji-datasource (iamcal/emoji-data, MIT) — đúng bộ shortcode Slack dùng.
// Chạy tay khi cần nâng bản dữ liệu, KHÔNG phải dependency:
//   npm pack emoji-datasource@15.1.2 && tar -xzf emoji-datasource-15.1.2.tgz package/emoji.json
//   node scripts/gen-slack-emoji.mjs package/emoji.json assets/slack-emoji.json
import { readFileSync, writeFileSync } from 'node:fs'

const [src, dst] = process.argv.slice(2)
if (!src || !dst) throw new Error('usage: gen-slack-emoji.mjs <emoji.json> <out.json>')

// Category của emoji-data → tab picker. Cờ gộp vào "symbols" (không có tab riêng).
const CAT = {
  'Smileys & Emotion': 'smileys',
  'People & Body': 'people',
  'Animals & Nature': 'nature',
  'Food & Drink': 'food',
  Activities: 'activity',
  'Travel & Places': 'travel',
  Objects: 'objects',
  Symbols: 'symbols',
  Flags: 'symbols',
}
const ORDER = ['smileys', 'people', 'nature', 'food', 'activity', 'travel', 'objects', 'symbols']

const data = JSON.parse(readFileSync(src, 'utf8'))
const groups = Object.fromEntries(ORDER.map((k) => [k, []]))
const aliases = {}
const skin = []
const seen = new Set()
const toChar = (unified) =>
  String.fromCodePoint(...unified.split('-').map((h) => Number.parseInt(h, 16)))

for (const e of [...data].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
  // Giữ cả mục obsoleted (vd ok_woman): Slack vẫn render các tên cũ này.
  const tab = CAT[e.category]
  if (!tab || seen.has(e.short_name)) continue
  seen.add(e.short_name)
  groups[tab].push([e.short_name, toChar(e.unified)])
  for (const alt of e.short_names ?? []) {
    if (alt !== e.short_name && !seen.has(alt)) aliases[alt] = e.short_name
  }
  if (e.skin_variations) skin.push(e.short_name)
}

const out = {
  _source:
    'emoji-datasource@15.1.2 (iamcal/emoji-data, MIT) — sinh bằng scripts/gen-slack-emoji.mjs, đừng sửa tay',
  groups: ORDER.map((id) => ({ id, items: groups[id] })),
  aliases,
  skin,
}
writeFileSync(dst, JSON.stringify(out))
// Script chạy tay: in số lượng ra stderr để người chạy đối chiếu.
console.warn(
  Object.fromEntries(ORDER.map((k) => [k, groups[k].length])),
  'aliases',
  Object.keys(aliases).length,
)
