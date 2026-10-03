import { watch, type Ref } from 'vue'
import { attachCodeBlockControls } from '~/utils/code-block-controls'
import { useI18n } from '~/composables/useI18n'
import { useAppearanceDom } from '~/composables/useAppearanceDom'
import { useSettingsStore } from '~/stores/settings'
import { usePreview, type PreviewRef } from '~/composables/usePreview'
import { useFilePreview } from '~/composables/useFilePreview'

// Fence lang (Shiki id ở `data-lang`) → Monaco language id cho viewer của modal.
// Ngoài map truyền nguyên id — tên phổ biến trùng nhau (typescript, json, python…);
// id Monaco không biết nó render plaintext, vẫn đọc được.
const MONACO_LANG_ALIAS: Record<string, string> = {
  shellscript: 'shell',
  shellsession: 'shell',
  console: 'shell',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
  md: 'markdown',
  mdx: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  jsx: 'javascript',
  tsx: 'typescript',
  vue: 'html',
  svelte: 'html',
  yml: 'yaml',
}
// Block đánh dấu là tài liệu markdown → mở modal ở kind 'markdown' (Render/Raw)
// thay vì viewer code — nội dung nó VIẾT là markdown, người đọc cần bản render.
const MD_KIND = new Set(['markdown', 'md', 'mdx'])

// Binds the shared code-block controls (language chip · soft-wrap toggle · copy) to this
// app's i18n + settings: the wrap button flips `appearance.codeWrap`, which persists with
// the rest of the appearance slice and repaints every block on screen through the
// `body[data-code-wrap]` attribute. For surfaces that render markdown imperatively and
// re-attach after each innerHTML rebuild.
export function useCodeBlockAttacher(opts?: {
  // Chỉ bề mặt có chỗ chạy lệnh mới truyền (transcript của session). Bỏ trống ⇒
  // block shell không mọc nút Run — ví dụ markdown trong drawer GitHub, nơi không
  // có terminal nào để chạy vào.
  onRun?: (command: string, alt: boolean) => void
  runLabel?: string
}): (el: HTMLElement) => void {
  const { t } = useI18n()
  const store = useSettingsStore()
  const { applyCodeWrap } = useAppearanceDom()
  const preview = usePreview()
  const filePreview = useFilePreview()
  const onToggleWrap = () => {
    const next = !store.appearance.codeWrap
    store.updateAppearance({ codeWrap: next })
    applyCodeWrap(next)
  }
  // Expand → đẩy nội dung block sang PreviewModal chung (mount ở AppGlobalHosts).
  // ```markdown mở dạng render + raw; mọi lang khác vào viewer Monaco read-only.
  // Khi bề mặt nằm trong một session, workspaceRoot của phiên đi kèm để ảnh/đường
  // dẫn tương đối trong markdown resolve đúng như transcript (NOOP → mở ngay).
  const onExpand = (code: string, lang: string | null) => {
    const l = (lang ?? '').toLowerCase()
    const item: PreviewRef = {
      name: MD_KIND.has(l) ? 'code.md' : `code.${l || 'txt'}`,
      kind: MD_KIND.has(l) ? 'markdown' : 'text',
      text: code,
    }
    const monaco = MONACO_LANG_ALIAS[l] ?? l
    if (monaco) item.language = monaco
    void filePreview.root().then((root) => {
      if (root) item.workspaceRoot = root
      // push thay vì open: bấm Expand NGAY TRONG một preview đang mở (block code
      // trong doc) giữ file cha trong history — Back quay lại đúng chỗ đang đọc.
      // Ngoài transcript current=null → push hành xử y hệt open.
      preview.push(item)
    })
  }
  return (el: HTMLElement) =>
    attachCodeBlockControls(el, {
      labels: {
        copy: t('common.copy'),
        copied: t('common.copied'),
        wrap: t('common.wrapLines'),
        expand: t('common.fullscreen'),
        resize: t('common.resize'),
      },
      onToggleWrap,
      onRun: opts?.onRun,
      runLabel: opts?.runLabel,
      onExpand,
    })
}

// Keep the controls on every code block inside a `v-html` markdown container.
//
// Those surfaces let Vue own the rendered nodes, so the controls must be (re)attached from
// the outside: whenever the markdown changes, v-html re-sets innerHTML wholesale and the
// previous ones are gone. Watching the container ref as well covers a remount (the preview
// modal's render/raw toggle, a detail panel switching entities).
//
// `content` is any getter whose value changes when the rendered markdown does — typically
// the segment list. Attaching is idempotent, so a spurious run is cheap.
export function useCodeBlockControls(
  container: Ref<HTMLElement | null>,
  content: () => unknown,
): void {
  const attach = useCodeBlockAttacher()
  watch(
    [container, content],
    () => {
      const el = container.value
      if (!el) return
      attach(el)
    },
    { immediate: true, flush: 'post' },
  )
}
