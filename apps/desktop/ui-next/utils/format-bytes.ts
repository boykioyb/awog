// One byte-size label for the whole app. Previously copy-pasted in the attachments
// modal, the shared-files cards and the Info panel (each with the same three
// branches); the fourth caller (the Info tab's media/docs lists) made it worth
// lifting. Callers decide what an absent/zero size means for them — this formats a
// number, nothing else.
//
// LADDER GOES ALL THE WAY UP (2026-09-17). It used to stop at MB, so a 3 GB file
// read as "3072.0 MB" and an RDS free-storage axis would have run to six figures.
// Stopping early is not a smaller function, it is a wrong label.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatBytes(n: number): string {
  const abs = Math.abs(n)
  if (abs < 1024) return `${Math.round(n)} B`
  let value = n
  let step = 0
  while (Math.abs(value) >= 1024 && step < UNITS.length - 1) {
    value /= 1024
    step += 1
  }
  // Three significant-ish digits: "1.5 GB" reads, "1.5234 GB" does not, and at
  // three digits the decimal stops carrying information anyone acts on.
  return `${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)} ${UNITS[step]}`
}
