import type { AwogPetState } from '~/types/awog-bridge'

// Desktop pet speech (docs/features/desktop-pet.md).
//
// The lines are USER DATA: Settings → Pet edits them and they persist in the settings
// store. i18n only supplies the seed, so this module is the one place that knows
// which key holds what — and the only place that has to change when a bucket gains a
// default line.

// One bucket per pet state, plus the time-based reminders (drink water / stretch /
// rest your eyes) which fire regardless of what the pet is doing.
export const PET_QUIP_BUCKETS = [
  'working',
  'awaiting',
  'done',
  'idle',
  'offline',
  'reminder',
] as const
export type PetQuipBucket = (typeof PET_QUIP_BUCKETS)[number]

// How many default lines exist per bucket in i18n/locales/*/pet.json. Keep in sync
// when adding defaults — a missing key would seed the literal key string.
const DEFAULT_COUNT: Record<PetQuipBucket, number> = {
  working: 4,
  awaiting: 4,
  done: 4,
  idle: 4,
  offline: 4,
  reminder: 5,
}

// `done` reuses the idle sprite row but has its own voice; every state maps 1:1 here.
export const bucketOfState = (state: AwogPetState): PetQuipBucket => state

export function defaultQuipLines(t: (key: string) => string, bucket: PetQuipBucket): string[] {
  return Array.from({ length: DEFAULT_COUNT[bucket] }, (_, i) => t(`pet.quip.${bucket}.${i + 1}`))
}

// The lines actually in force: what the user saved, else the localised defaults.
// Blank rows are dropped so a stray newline in the editor doesn't make the pet
// "say" nothing.
export function effectiveQuipLines(
  t: (key: string) => string,
  saved: Partial<Record<PetQuipBucket, string[]>>,
  bucket: PetQuipBucket,
): string[] {
  const lines = (saved[bucket] ?? []).map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines : defaultQuipLines(t, bucket)
}
