// One byte-size label for the whole app. Previously copy-pasted in the attachments
// modal, the shared-files cards and the Info panel (each with the same three
// branches); the fourth caller (the Info tab's media/docs lists) made it worth
// lifting. Callers decide what an absent/zero size means for them — this formats a
// number, nothing else.
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
