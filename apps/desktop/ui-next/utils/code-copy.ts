// Per-code-block copy button for every rendered-markdown surface (transcript, preview
// modal, library body, artifact editor, GitHub drawer). Kept here — not in one component —
// so a code block looks and behaves identically wherever markdown is rendered; the button
// markup is a trusted constant (icon-sprite <use>), never content-derived.

const COPY_RESET_MS = 1200
const COPY_SVG = '<svg class="icn"><use href="#i-copy"></use></svg>'
const CHECK_SVG = '<svg class="icn"><use href="#i-check"></use></svg>'

export type CodeCopyLabels = { copy: string; copied: string }

// Wrap every `<pre><code>` under `el` in a `.codeblock` and pin a `.codecopy` button to its
// top-right corner (styles are global — assets/css/app-shell.css).
//
// The wrapper exists because <pre> is the horizontal scroll container: an absolutely-
// positioned child of it is placed against the FULL scrolled width, so on a wide block the
// button drifts out of view as the user scrolls right. The wrapper doesn't scroll, so the
// button stays pinned to the visible corner.
//
// Idempotent — an already-wrapped block is skipped, so surfaces that re-run this after every
// content change (v-html re-sets innerHTML wholesale and throws the buttons away) pay only a
// querySelectorAll when nothing changed. Listeners and their reset timers die with the
// subtree when the markdown is rebuilt.
export function attachCodeCopyButtons(el: HTMLElement, labels: CodeCopyLabels): void {
  for (const pre of Array.from(el.querySelectorAll('pre'))) {
    const code = pre.querySelector('code')
    if (!code) continue
    if (pre.parentElement?.classList.contains('codeblock')) continue // already has a button
    const wrap = document.createElement('div')
    wrap.className = 'codeblock'
    pre.replaceWith(wrap)
    wrap.appendChild(pre)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'codecopy'
    btn.title = labels.copy
    btn.innerHTML = COPY_SVG
    let reset: ReturnType<typeof setTimeout> | null = null
    btn.addEventListener('click', () => {
      void navigator.clipboard.writeText(code.textContent ?? '')
      btn.classList.add('ok')
      btn.title = labels.copied
      btn.innerHTML = CHECK_SVG
      if (reset) clearTimeout(reset)
      reset = setTimeout(() => {
        btn.classList.remove('ok')
        btn.title = labels.copy
        btn.innerHTML = COPY_SVG
      }, COPY_RESET_MS)
    })
    wrap.appendChild(btn)
  }
}
