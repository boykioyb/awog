// Per-code-block controls for every rendered-markdown surface (transcript, preview modal,
// library body, wiki reader, artifact editor, GitHub drawer): a language chip, a soft-wrap
// toggle and a copy button. Kept here — not in one component — so a code block looks and
// behaves identically wherever markdown is rendered; the button markup is a trusted
// constant (icon-sprite <use>), never content-derived.

const COPY_RESET_MS = 1200
const COPY_SVG = '<svg class="icn"><use href="#i-copy"></use></svg>'
const CHECK_SVG = '<svg class="icn"><use href="#i-check"></use></svg>'
const WRAP_SVG = '<svg class="icn"><use href="#i-wrap"></use></svg>'
const RUN_SVG = '<svg class="icn"><use href="#i-play"></use></svg>'

// Ngôn ngữ được coi là "lệnh chạy được". Danh sách này ĂN KHỚP với những gì
// useMarkdown thực sự phát ra ở `data-lang`, và nó chỉ có mặt khi fence GHI RÕ
// ngôn ngữ — fence trống tuy được tô màu như shell nhưng cố ý KHÔNG mang thuộc
// tính này (xem highlightCode). Nhờ vậy nút Run không mọc trên mọi khối ``` trần,
// vốn phần lớn là output hoặc nội dung file chứ không phải lệnh.
const RUNNABLE_LANGS = new Set([
  'bash',
  'sh',
  'shell',
  'shellscript',
  'zsh',
  'console',
  'shellsession',
])

export type CodeBlockLabels = { copy: string; copied: string; wrap: string }

export type CodeBlockControlsOptions = {
  labels: CodeBlockLabels
  // Flips the app-wide soft-wrap preference (Settings → Appearance → code wrap). The
  // preference is global rather than per block: it is a reading habit, and the transcript
  // rebuilds these subtrees on every streaming frame, so per-block state would not survive
  // the next render anyway. The rendered effect is pure CSS (`body[data-code-wrap='on']`),
  // so one toggle repaints every block on screen without re-attaching anything.
  onToggleWrap: () => void
  // Chạy nội dung block trong terminal của phiên. Chỉ truyền ở bề mặt CÓ terminal
  // (transcript của session); những bề mặt khác bỏ trống và nút không xuất hiện.
  // `alt` = người dùng giữ ⌥ khi bấm → chỉ dán, không tự Enter.
  onRun?: (command: string, alt: boolean) => void
  runLabel?: string
}

// Wrap every `<pre><code>` under `el` in a `.codeblock` and pin a `.codetools` row to its
// top-right corner: the `.codelang` chip (when the block carries a `data-lang`, set by
// useMarkdown's highlightCode — see composables/useMarkdown.ts), the `.codewrap` toggle and
// the `.codecopy` button. Styles are global — assets/css/app-shell.css.
//
// The wrapper exists because <pre> is the horizontal scroll container: an absolutely-
// positioned child of it is placed against the FULL scrolled width, so on a wide block the
// controls drift out of view as the user scrolls right. The wrapper doesn't scroll, so they
// stay pinned to the visible corner.
//
// Idempotent — an already-wrapped block is skipped, so surfaces that re-run this after every
// content change (v-html re-sets innerHTML wholesale and throws the controls away) pay only a
// querySelectorAll when nothing changed. Listeners and their reset timers die with the
// subtree when the markdown is rebuilt.
export function attachCodeBlockControls(el: HTMLElement, opts: CodeBlockControlsOptions): void {
  const { labels, onToggleWrap, onRun, runLabel } = opts
  for (const pre of Array.from(el.querySelectorAll('pre'))) {
    const code = pre.querySelector('code')
    if (!code) continue
    if (pre.parentElement?.classList.contains('codeblock')) continue // already has controls
    const wrap = document.createElement('div')
    wrap.className = 'codeblock'
    pre.replaceWith(wrap)
    wrap.appendChild(pre)
    const tools = document.createElement('div')
    tools.className = 'codetools'
    wrap.appendChild(tools)

    const lang = pre.getAttribute('data-lang')
    if (lang) {
      // `lang` comes off `data-lang`, which useMarkdown only ever sets from an allowlisted
      // language id (see composables/useMarkdown.ts). textContent regardless — never
      // innerHTML — so nothing can be injected even if that constraint ever loosened.
      const chip = document.createElement('span')
      chip.className = 'codelang'
      chip.textContent = lang
      tools.appendChild(chip)
    }

    // Soft-wrap toggle. The title names the ACTION, not the state, because the preference is
    // global: flipping it elsewhere would leave every other block's title stale. The lit
    // (accent) state is painted from `body[data-code-wrap='on']` instead, so it can never
    // drift from the truth.
    const wrapBtn = document.createElement('button')
    wrapBtn.type = 'button'
    wrapBtn.className = 'codewrap'
    wrapBtn.title = labels.wrap
    wrapBtn.innerHTML = WRAP_SVG
    wrapBtn.addEventListener('click', onToggleWrap)
    tools.appendChild(wrapBtn)

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
    tools.appendChild(btn)

    // Run — chỉ cho block shell có nhãn ngôn ngữ rõ ràng, và chỉ khi bề mặt này
    // cấp được chỗ chạy. Đặt SAU copy nên nó là nút ngoài cùng phải: hành động
    // nặng đô nhất nằm xa nhất khỏi hai nút vô hại.
    if (onRun && lang && RUNNABLE_LANGS.has(lang)) {
      const runBtn = document.createElement('button')
      runBtn.type = 'button'
      runBtn.className = 'coderun'
      runBtn.title = runLabel ?? 'Run'
      runBtn.innerHTML = RUN_SVG
      runBtn.addEventListener('click', (ev) => {
        onRun(code.textContent ?? '', ev.altKey)
      })
      tools.appendChild(runBtn)
    }
  }
}
