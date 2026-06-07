import type { SessionFollowUp } from '~/types'

// Visual cap for chips in the composer / history. Payload sent to the agent
// keeps the full selectedText (see formatFollowUp). Mirrors lukilabs#580 — the
// asymmetry is intentional: short chip, full quote.
export const FOLLOW_UP_CHIP_MAX = 140

export const truncateForChip = (text: string, max = FOLLOW_UP_CHIP_MAX): string => {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

// Render a single follow-up as a quote block. The agent sees the full quote +
// the user's instruction; no truncation here.
export const formatFollowUp = (fu: SessionFollowUp): string => {
  const quoted = fu.selectedText
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const note = fu.note.trim()
  return note ? `${quoted}\n\n${note}` : quoted
}

export const formatFollowUpSection = (followUps: SessionFollowUp[]): string => {
  if (followUps.length === 0) return ''
  return followUps.map(formatFollowUp).join('\n\n---\n\n')
}

// Prepend follow-up sections to the user's free-text message. Empty input → no
// leading separator; empty follow-ups → return text unchanged.
export const composeOutgoingMessage = (text: string, followUps: SessionFollowUp[]): string => {
  const section = formatFollowUpSection(followUps)
  if (!section) return text
  const body = text.trim()
  return body ? `${section}\n\n${body}` : section
}

// Inverse of composeOutgoingMessage for DISPLAY: recover just the user's own
// free-text from a sent message, dropping the serialized quote section (which we
// render as styled numbered cards from `followUps` instead of raw markdown). The
// full `message.text` is kept intact for the model + history — this only affects
// what the bubble shows. Falls back to the full text if the prefix doesn't match.
export const stripFollowUpSection = (text: string, followUps: SessionFollowUp[]): string => {
  const section = formatFollowUpSection(followUps)
  if (!section) return text
  if (text === section) return ''
  const prefix = `${section}\n\n`
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}
