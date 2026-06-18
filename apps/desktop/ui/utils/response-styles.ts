// Response style catalog (ADR 0046) — DISPLAY metadata only. The actual
// system-prompt directives live in the sidecar (src/style/styles.ts); the UI
// only ever sends a style `id` + the no-markdown flag. The id set here is the
// contract with that file — keep them in sync (a UI id the sidecar doesn't know
// degrades to "no style", never an error).
//
// Labels/hints are English constants, mirroring MODE_OPTIONS / SESSION_COMMANDS
// (the composer chip surface is not i18n'd) — see ADR 0046 Hệ quả.

export interface ResponseStyleDef {
  // Stable id sent to the sidecar (matches STYLE_DIRECTIVES keys).
  id: string
  name: string
  emoji: string
  // One-line "when to use this" hint shown under the name in the picker.
  hint: string
}

export interface ResponseStyleGroup {
  key: 'fast' | 'fun' | 'understand'
  label: string
  emoji: string
  styles: ResponseStyleDef[]
}

export const RESPONSE_STYLE_GROUPS: ResponseStyleGroup[] = [
  {
    key: 'fast',
    label: 'Quick & concise',
    emoji: '⚡',
    styles: [
      {
        id: 'military',
        name: 'Military',
        emoji: '🪖',
        hint: 'Debugging — fix now, no explanation',
      },
      { id: 'caveman', name: 'Caveman', emoji: '🪨', hint: 'Fast code, constant back-and-forth' },
      {
        id: 'reality-check',
        name: 'Reality Check',
        emoji: '🔍',
        hint: 'Is this idea/project worth doing?',
      },
      { id: 'git-log', name: 'git log', emoji: '📋', hint: 'Step-by-step to paste into a ticket' },
      { id: 'socratic', name: 'Socratic', emoji: '❓', hint: 'Understand deeply, not just copy' },
      { id: 'bluf', name: 'BLUF', emoji: '📌', hint: 'Comparing options — verdict first' },
    ],
  },
  {
    key: 'fun',
    label: 'For fun',
    emoji: '😄',
    styles: [
      { id: 'yoda', name: 'Yoda', emoji: '🧙', hint: 'A little energy while debugging' },
      { id: 'pirate', name: 'Pirate', emoji: '🏴‍☠️', hint: 'Demo for the team, need memes' },
      { id: 'hacker-80s', name: '80s Hacker', emoji: '💾', hint: 'Screencast, dramatic vibe' },
      { id: 'dad-joke', name: 'Dad Joke', emoji: '👨', hint: 'Teaching juniors — make it stick' },
    ],
  },
  {
    key: 'understand',
    label: 'Understand deeply',
    emoji: '🧠',
    styles: [
      {
        id: 'rubber-duck',
        name: 'Rubber Duck',
        emoji: '🦆',
        hint: 'Brand-new concept, start from zero',
      },
      { id: 'feynman', name: 'Feynman', emoji: '🔬', hint: 'Onboard a junior or self-learn' },
      {
        id: 'first-principles',
        name: 'First Principles',
        emoji: '🧱',
        hint: 'Choosing a stack / architecture',
      },
    ],
  },
]

// Flat lookup across all groups.
export const RESPONSE_STYLES: ResponseStyleDef[] = RESPONSE_STYLE_GROUPS.flatMap((g) => g.styles)

export const findResponseStyle = (id: string | undefined): ResponseStyleDef | undefined =>
  id ? RESPONSE_STYLES.find((s) => s.id === id) : undefined
