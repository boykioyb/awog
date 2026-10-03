// Per-code-block controls for every rendered-markdown surface (transcript, preview modal,
// library body, wiki reader, artifact editor, GitHub drawer): a language chip, a soft-wrap
// toggle, an expand-to-preview button, a copy button, and a height drag-handle under tall
// blocks. Kept here — not in one component — so a code block looks and behaves identically
// wherever markdown is rendered; the button markup is a trusted constant (icon-sprite
// <use>), never content-derived.

const COPY_RESET_MS = 1200
const COPY_SVG = '<svg class="icn"><use href="#i-copy"></use></svg>'
const CHECK_SVG = '<svg class="icn"><use href="#i-check"></use></svg>'
const WRAP_SVG = '<svg class="icn"><use href="#i-wrap"></use></svg>'
const RUN_SVG = '<svg class="icn"><use href="#i-play"></use></svg>'
const EXPAND_SVG = '<svg class="icn"><use href="#i-maximize"></use></svg>'

// Thanh kéo chiều cao chỉ mọc khi block đủ cao để việc thu nhỏ có nghĩa — một
// fence ba dòng không có gì để kéo.
const RESIZE_SHOW_H = 220
// Sàn khi kéo: thấp hơn nữa thì khung nhìn chỉ còn vài dòng, không đọc được gì.
const RESIZE_MIN_H = 96

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

export type CodeBlockLabels = {
  copy: string
  copied: string
  wrap: string
  expand: string
  resize: string
}

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
  // Mở full nội dung block trong preview modal chung — lối thoát cho block dài mà
  // thanh kéo/scroll trong khung nhỏ không đủ. Vắng ⇒ nút Expand không mọc.
  onExpand?: (code: string, lang: string | null) => void
}

// Wrap every `<pre><code>` under `el` in a `.codeblock` and pin a `.codetools` row to its
// top-right corner: the `.codelang` chip (when the block carries a `data-lang`, set by
// useMarkdown's highlightCode — see composables/useMarkdown.ts), the `.codewrap` toggle,
// the `.codeexpand` button and the `.codecopy` button; a `.codehres` height handle goes
// under blocks tall enough to be worth resizing. Styles are global — assets/css/app-shell.css.
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
  const { labels, onToggleWrap, onRun, runLabel, onExpand } = opts
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

    // Expand — đứng cạnh wrap: cả hai đều là control "đọc" (không sửa, không chạy).
    if (onExpand) {
      const exBtn = document.createElement('button')
      exBtn.type = 'button'
      exBtn.className = 'codeexpand'
      exBtn.title = labels.expand
      exBtn.innerHTML = EXPAND_SVG
      exBtn.addEventListener('click', () => onExpand(code.textContent ?? '', lang))
      tools.appendChild(exBtn)
    }

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

    // Thanh kéo chiều cao ở đáy block. Kéo = ghim một height tuyệt đối lên <pre>
    // (overflow-y:auto sẵn), phần dư cuộn trong khối thay vì chiếm transcript; không
    // kéo thì block giữ chiều cao tự nhiên như cũ. Inline height mất khi subtree
    // rebuild — đúng như trạng thái các nút bên trên.
    if (pre.scrollHeight > RESIZE_SHOW_H) {
      const hres = document.createElement('div')
      hres.className = 'codehres'
      hres.title = labels.resize
      hres.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        const startY = e.clientY
        const startH = pre.offsetHeight
        // offsetHeight - clientHeight = viền + thanh cuộn ngang — phần chrome không
        // đổi theo height đặt tay, nên trần "vừa nội dung" = scrollHeight + chrome.
        const natural = pre.scrollHeight + (pre.offsetHeight - pre.clientHeight)
        const maxH = Math.min(natural, Math.round(window.innerHeight * 0.8))
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
        wrap.classList.add('coderesizing')
        const move = (ev: PointerEvent) => {
          // Bỏ trần do theme đặt (cute cap 420px) — khi người dùng đã kéo, chiều cao
          // là của họ; và bảo đảm trục dọc cuộn được khi block thấp hơn nội dung.
          pre.style.maxHeight = 'none'
          pre.style.overflowY = 'auto'
          pre.style.height = `${Math.min(Math.max(startH + (ev.clientY - startY), RESIZE_MIN_H), maxH)}px`
        }
        const up = () => {
          wrap.classList.remove('coderesizing')
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      })
      wrap.appendChild(hres)
    }
  }
}
