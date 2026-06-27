// Copy text to the OS clipboard (best-effort; resolves even if denied/unavailable).
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // Clipboard API blocked (no focus / permission) — non-fatal.
  }
}
