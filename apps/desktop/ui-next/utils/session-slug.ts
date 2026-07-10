// Deterministic, human-readable session-id (engineId) generator — a trimmed adaptation
// of craft's word-list slug (packages/shared/src/sessions/word-lists.ts). Format:
// `YYMMDD-adjective-noun-<tail>`, e.g. `260710-swift-river-4z9`.
//
// UNLIKE craft's crypto-random generator this is fully DETERMINISTIC (same clientId →
// same slug on every call) and SYNCHRONOUS. The sessions store derives the engineId
// from the numeric clientId (which embeds the creation ms epoch — `Date.now() + seq`)
// and relies on recomputing the SAME id later: the `if (!s.engineId) s.engineId =
// engineIdFor(s.id)` fallback depends on it. The YYMMDD prefix is the creation date, so
// ids stay roughly time-sortable.

// ~48 short, lowercase, url-safe words each (48 × 48 = 2304 adjective-noun pairs); the
// base36 `tail` disambiguates within a day.
const ADJECTIVES = [
  'bright',
  'calm',
  'clear',
  'cool',
  'crisp',
  'fresh',
  'gentle',
  'golden',
  'misty',
  'sunny',
  'warm',
  'wild',
  'windy',
  'frosty',
  'mild',
  'soft',
  'swift',
  'quiet',
  'silent',
  'still',
  'azure',
  'coral',
  'amber',
  'jade',
  'ruby',
  'ivory',
  'onyx',
  'pearl',
  'silver',
  'copper',
  'bold',
  'brave',
  'clever',
  'eager',
  'fair',
  'fleet',
  'grand',
  'keen',
  'noble',
  'proud',
  'quick',
  'sharp',
  'smart',
  'steady',
  'strong',
  'true',
  'vivid',
  'wise',
] as const

const NOUNS = [
  'canyon',
  'cliff',
  'coast',
  'cove',
  'creek',
  'delta',
  'dune',
  'field',
  'forest',
  'glade',
  'glen',
  'grove',
  'harbor',
  'hill',
  'island',
  'lagoon',
  'lake',
  'meadow',
  'mesa',
  'moor',
  'oasis',
  'ocean',
  'peak',
  'plain',
  'pond',
  'ravine',
  'reef',
  'ridge',
  'river',
  'shore',
  'spring',
  'stream',
  'summit',
  'trail',
  'valley',
  'vista',
  'bay',
  'beach',
  'dawn',
  'dusk',
  'comet',
  'galaxy',
  'meteor',
  'nebula',
  'orbit',
  'aurora',
  'cloud',
  'horizon',
] as const

// 36^3 = 46656 → a 3-char base36 tail.
const BASE36_TAIL_MOD = 36 ** 3

function datePrefix(ms: number): string {
  const d = new Date(ms)
  const yy = d.getFullYear().toString().slice(-2)
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  return `${yy}${mm}${dd}`
}

// Deterministic slug for a numeric client id (same input → same output). The `?? [0]`
// fallbacks only satisfy noUncheckedIndexedAccess — the modulo keeps the index in range.
export function slugSessionId(clientId: number): string {
  const yymmdd = datePrefix(clientId)
  const adj = ADJECTIVES[clientId % ADJECTIVES.length] ?? ADJECTIVES[0]
  const noun = NOUNS[Math.floor(clientId / ADJECTIVES.length) % NOUNS.length] ?? NOUNS[0]
  const tail = (clientId % BASE36_TAIL_MOD).toString(36).padStart(3, '0')
  return `${yymmdd}-${adj}-${noun}-${tail}`
}
