// Hue avatar ổn định theo id — hash string → một trong các hue của theme.
// Dùng chung cho WorkspaceBoardThread (avatar người gửi), WorkspaceAgentPeek
// và roster dropdown của board item editor: cùng session ⇒ cùng màu mọi nơi.
const AVATAR_HUES = [
  'var(--accent)',
  'var(--blue)',
  'var(--violet)',
  'var(--amber)',
  'var(--green)',
]

export function avatarHue(id: string | null | undefined): string {
  let h = 0
  for (const ch of id ?? '') h = (h * 31 + ch.charCodeAt(0)) | 0
  return AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length]!
}

export function nameInitial(name: string | null | undefined): string {
  return (name?.trim()[0] ?? '?').toUpperCase()
}
