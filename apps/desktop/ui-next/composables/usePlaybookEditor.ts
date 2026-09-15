// Trình soạn playbook — trạng thái của hộp soạn trên trang `/playbooks`.
//
// TRẠNG THÁI Ở MỨC MODULE. Hai bề mặt mở cùng một hộp: nút "Kế hoạch mới" ở thanh công
// cụ, và nút Sửa/Nhân bản ở đầu màn chi tiết. Để state trong `ref` của component nào thì
// bề mặt kia không mở được nó. Cùng khuôn `useInfraDashboardPin`/`useInfraTabOpen`.
// Nhưng `useI18n()`/`useToast()` phải gọi TRONG thân hàm — chúng cần app instance.
//
// TÁCH KHỎI `usePlaybooksManager`. Bên kia là page-controller của cả trang: danh sách,
// bản đang mở, vòng đời một lượt chạy, graph. Đây chỉ là "một bản nháp đang được gõ".
// Gộp vào là để một hộp thoại kéo theo cả trạng thái chạy playbook.
//
// `args` LÀ MẢNG, MỘT DÒNG MỘT ĐỐI SỐ. Lược đồ sidecar nói rõ: `args` không bao giờ là
// chuỗi shell (`schema.ts` §"DỮ LIỆU L1"). Nếu ô nhập nhận một dòng rồi tự tách theo
// khoảng trắng thì AWOG vừa tự viết một bộ phân tích shell — và `--query
// 'Reservations[].Instances[]'` sẽ vỡ làm đôi. Nên ô nhập là textarea, mỗi dòng đúng một
// đối số, không luật trích dẫn nào cả.
//
// LƯU KHÔNG CHẶN LUẬT ROLLBACK. Sidecar cố ý cho lưu một bản nháp còn thiếu bước quay
// lui (`methods/infra.playbook.ts` — luật đó chỉ chặn ở `submit`), để còn sửa tiếp. Hộp
// này vì thế CẢNH BÁO mà không khoá nút Lưu.
import { computed, reactive, ref } from 'vue'
import { usePlaybooksApi } from '~/composables/usePlaybooksApi'
import { useToast } from '~/composables/useToast'
import type {
  Playbook,
  PlaybookIssue,
  PlaybookKind,
  PlaybookSummary,
  PlaybookTier,
  PlaybookVerb,
} from '~/composables/usePlaybooksApi'
import type { InfraTool } from '~/types'

/** Trần của `schema.ts` — hộp này chặn TRƯỚC để lỗi không phải đi một vòng qua sidecar. */
export const MAX_STEPS = 64
export const MAX_VARIABLES = 32
export const MAX_ARGS_PER_STEP = 32

export const EDITOR_TOOLS: readonly InfraTool[] = ['aws', 'terraform', 'kubectl']
export const EDITOR_VERBS: readonly PlaybookVerb[] = ['check', 'do', 'verify', 'rollback']
export const EDITOR_KINDS: readonly PlaybookKind[] = ['instruction', 'deployment']

/**
 * Một bước trong lúc đang gõ. Khác `PlaybookStep` ở đúng một chỗ: `argsText` là văn bản
 * nhiều dòng của ô nhập, còn `args` chỉ tồn tại lúc gửi đi. Giữ cả hai song song là để
 * dòng trống giữa chừng của người đang gõ biến mất sau mỗi phím.
 */
export type EditorStep = {
  id: string
  title: string
  verb: PlaybookVerb
  tool: InfraTool
  argsText: string
  note: string
}

export type EditorVariable = {
  name: string
  label: string
  required: boolean
  default: string
}

export type EditorMode = 'create' | 'edit'

/** Đích ghi. `id` khoá khi sửa: đổi id là DI CHUYỂN file, không phải sửa nội dung. */
export type EditorTarget = { source: PlaybookTier; projectId: string; id: string }

const open = ref(false)
const mode = ref<EditorMode>('create')
const saving = ref(false)
const issues = ref<readonly PlaybookIssue[]>([])
/** Id của bản đang sửa — `null` khi đang tạo mới (id lúc đó suy từ tên). */
const lockedId = ref<string | null>(null)

const form = reactive({
  id: '',
  name: '',
  description: '',
  kind: 'instruction' as PlaybookKind,
  tier: 'global' as PlaybookTier,
  projectId: '',
  variables: [] as EditorVariable[],
  steps: [] as EditorStep[],
})

/** `PLAYBOOK_ID_RE` của sidecar, chép sang để hộp này nói "sai chỗ nào" trước khi gửi. */
const ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const STEP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

/** Tên → id file. Bỏ dấu tiếng Việt vì `PLAYBOOK_ID_RE` chỉ nhận ASCII. */
export function slugifyPlaybookId(name: string): string {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'ke-hoach').slice(0, 64).replace(/-+$/, '')
}

function blankStep(verb: PlaybookVerb, index: number): EditorStep {
  return { id: `s${String(index + 1)}`, title: '', verb, tool: 'aws', argsText: '', note: '' }
}

function stepsFrom(playbook: Playbook): EditorStep[] {
  return playbook.steps.map((s) => ({
    id: s.id,
    title: s.title,
    verb: s.verb,
    tool: s.tool,
    argsText: s.args.join('\n'),
    note: s.note,
  }))
}

function variablesFrom(playbook: Playbook): EditorVariable[] {
  return playbook.variables.map((v) => ({
    name: v.name,
    label: v.label,
    required: v.required,
    default: v.default ?? '',
  }))
}

function reset(): void {
  issues.value = []
  form.id = ''
  form.name = ''
  form.description = ''
  form.kind = 'instruction'
  form.tier = 'global'
  form.projectId = ''
  form.variables = []
  form.steps = []
}

/** Mỗi dòng một đối số; dòng trắng bị bỏ. Không tách theo khoảng trắng — xem đầu file. */
function argsOf(step: EditorStep): string[] {
  return step.argsText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

export function usePlaybookEditor() {
  const api = usePlaybooksApi()
  const toast = useToast()
  const { t } = useI18n()

  // ── Mở hộp ────────────────────────────────────────────────────────────────

  /** Bản trắng: một bước `check` sẵn, vì lược đồ đòi `steps.min(1)`. */
  function openBlank(): void {
    reset()
    mode.value = 'create'
    lockedId.value = null
    form.steps = [blankStep('check', 0)]
    open.value = true
  }

  /**
   * Nhân bản. Đây là đường DUY NHẤT để có bản của riêng mình từ một bản dựng sẵn — bản
   * dựng sẵn nằm trong mã và `-save` từ chối ghi vào đó.
   */
  function openDuplicate(playbook: Playbook): void {
    reset()
    mode.value = 'create'
    lockedId.value = null
    form.name = t('playbooks.editor.copyName', { name: playbook.name })
    form.description = playbook.description
    form.kind = playbook.kind
    form.variables = variablesFrom(playbook)
    form.steps = stepsFrom(playbook)
    open.value = true
  }

  /**
   * Mở một bản nháp do MÁY dựng (mốc 7.3 — playbook dọn dẹp sinh từ phát hiện lãng phí).
   *
   * Vẫn là `mode: 'create'` và vẫn dừng ở trình soạn: bản nháp này chứa lệnh GHI trên
   * tài khoản AWS, nên không có đường nào để nó xuống đĩa mà người dùng chưa nhìn thấy
   * nội dung. Đây chính là chỗ họ nhìn.
   */
  function openGenerated(draft: {
    name: string
    description: string
    kind: PlaybookKind
    steps: readonly {
      id: string
      title: string
      verb: string
      tool: string
      args: readonly string[]
      note: string
    }[]
  }): void {
    reset()
    mode.value = 'create'
    lockedId.value = null
    form.name = draft.name
    form.description = draft.description
    form.kind = draft.kind
    form.steps = draft.steps.map((s) => ({
      id: s.id,
      title: s.title,
      // Giá trị đến từ sidecar nhưng vẫn thu hẹp ở biên: một `verb`/`tool` lạ lọt vào
      // form sẽ đi thẳng tới lược đồ zod rồi hỏng ở lượt Lưu, xa chỗ gây ra nó.
      verb: (EDITOR_VERBS as readonly string[]).includes(s.verb)
        ? (s.verb as PlaybookVerb)
        : 'check',
      tool: (EDITOR_TOOLS as readonly string[]).includes(s.tool) ? (s.tool as InfraTool) : 'aws',
      argsText: s.args.join('\n'),
      note: s.note,
    }))
    open.value = true
  }

  /**
   * Sửa tại chỗ. Chỉ bản ghi được — `summary.source === 'builtin'` không tới được đây
   * (nút Sửa không hiện), và sidecar cũng chặn lần nữa.
   */
  function openEdit(playbook: Playbook, summary: PlaybookSummary): boolean {
    if (summary.source === 'builtin') return false
    reset()
    mode.value = 'edit'
    lockedId.value = summary.id
    form.id = summary.id
    form.name = playbook.name
    form.description = playbook.description
    form.kind = playbook.kind
    form.tier = summary.source
    form.projectId = summary.projectId ?? ''
    form.variables = variablesFrom(playbook)
    form.steps = stepsFrom(playbook)
    open.value = true
    return true
  }

  function close(): void {
    open.value = false
    reset()
  }

  // ── Sửa bước / biến ───────────────────────────────────────────────────────

  function addStep(verb: PlaybookVerb): void {
    if (form.steps.length >= MAX_STEPS) return
    form.steps.push(blankStep(verb, form.steps.length))
  }

  function removeStep(index: number): void {
    form.steps.splice(index, 1)
  }

  /**
   * Đổi chỗ hai bước. Đây KHÔNG phải tiện ích sắp xếp: `do` thứ N ghép với `rollback`
   * thứ N **theo thứ tự khai báo**, nên di chuyển một bước là đổi cặp quay lui.
   */
  function moveStep(index: number, delta: -1 | 1): void {
    const next = index + delta
    const a = form.steps[index]
    const b = form.steps[next]
    if (!a || !b) return
    form.steps[index] = b
    form.steps[next] = a
  }

  function addVariable(): void {
    if (form.variables.length >= MAX_VARIABLES) return
    form.variables.push({ name: '', label: '', required: false, default: '' })
  }

  function removeVariable(index: number): void {
    form.variables.splice(index, 1)
  }

  // ── Dẫn xuất ──────────────────────────────────────────────────────────────

  /** Id sẽ dùng: khoá khi sửa, suy từ tên khi tạo mới (người dùng sửa đè được). */
  const effectiveId = computed(() =>
    lockedId.value !== null ? lockedId.value : form.id.trim() || slugifyPlaybookId(form.name),
  )

  const doCount = computed(() => form.steps.filter((s) => s.verb === 'do').length)
  const rollbackCount = computed(() => form.steps.filter((s) => s.verb === 'rollback').length)

  /**
   * Bao nhiêu bước `do` chưa có bước quay lui. Đếm THEO SỐ LƯỢNG, đúng như
   * `missingRollbackSteps` của sidecar (`rollbacks.length >= dos.length ? [] : …`) — bước
   * `do` thứ N ghép với bước `rollback` thứ N theo thứ tự khai báo, không theo id. Nói
   * khác đi ở đây là dạy người dùng một luật không tồn tại.
   */
  const missingRollback = computed(() => Math.max(0, doCount.value - rollbackCount.value))

  /**
   * Lỗi chặn nút Lưu. CỐ Ý không có luật rollback: bản nháp thiếu bước quay lui phải lưu
   * được để còn sửa tiếp (sidecar cũng chỉ chặn nó ở `submit`).
   */
  const blockingErrors = computed<string[]>(() => {
    const errs: string[] = []
    if (form.name.trim() === '') errs.push(t('playbooks.editor.err.name'))
    if (!ID_RE.test(effectiveId.value)) errs.push(t('playbooks.editor.err.id'))
    if (form.tier === 'project' && form.projectId === '')
      errs.push(t('playbooks.editor.err.project'))
    if (form.steps.length === 0) errs.push(t('playbooks.editor.err.noStep'))

    const seenStep = new Set<string>()
    for (const s of form.steps) {
      if (!STEP_ID_RE.test(s.id)) errs.push(t('playbooks.editor.err.stepId', { id: s.id }))
      else if (seenStep.has(s.id)) errs.push(t('playbooks.editor.err.stepDup', { id: s.id }))
      seenStep.add(s.id)
      if (s.title.trim() === '') errs.push(t('playbooks.editor.err.stepTitle', { id: s.id }))
      const args = argsOf(s)
      if (args.length === 0) errs.push(t('playbooks.editor.err.stepArgs', { id: s.id }))
      if (args.length > MAX_ARGS_PER_STEP)
        errs.push(t('playbooks.editor.err.stepArgsMax', { id: s.id, n: MAX_ARGS_PER_STEP }))
    }

    const seenVar = new Set<string>()
    for (const v of form.variables) {
      if (!VAR_NAME_RE.test(v.name)) errs.push(t('playbooks.editor.err.varName', { name: v.name }))
      else if (seenVar.has(v.name)) errs.push(t('playbooks.editor.err.varDup', { name: v.name }))
      seenVar.add(v.name)
      if (v.label.trim() === '') errs.push(t('playbooks.editor.err.varLabel', { name: v.name }))
    }

    // Trùng nhau thì chỉ nói một lần: cùng một lỗi lặp 6 dòng là một bức tường chữ.
    return [...new Set(errs)]
  })

  const canSave = computed(() => !saving.value && blockingErrors.value.length === 0)

  // ── Lưu ───────────────────────────────────────────────────────────────────

  /**
   * Ghi xuống đĩa. Trả về đích đã ghi để trang nạp lại danh sách rồi mở đúng bản vừa
   * lưu; `null` khi hỏng (thông báo đã hiện qua toast hoặc `issues`).
   */
  async function save(): Promise<EditorTarget | null> {
    if (!canSave.value) return null
    saving.value = true
    issues.value = []
    const target: EditorTarget = {
      source: form.tier,
      projectId: form.tier === 'project' ? form.projectId : '',
      id: effectiveId.value,
    }
    try {
      const res = await api.save({
        source: target.source,
        ...(target.projectId ? { projectId: target.projectId } : {}),
        id: target.id,
        draft: {
          name: form.name.trim(),
          description: form.description.trim(),
          kind: form.kind,
          variables: form.variables.map((v) => ({
            name: v.name,
            label: v.label.trim(),
            required: v.required,
            ...(v.default ? { default: v.default } : {}),
          })),
          steps: form.steps.map((s) => ({
            id: s.id,
            title: s.title.trim(),
            verb: s.verb,
            tool: s.tool,
            args: argsOf(s),
            note: s.note.trim(),
          })),
        },
      })
      if (!res.ok) {
        issues.value = res.issues ?? []
        toast.add({ title: t(res.error), color: 'error' })
        return null
      }
      toast.add({
        title: t('playbooks.editor.saved', { name: res.playbook.name }),
        color: 'success',
      })
      open.value = false
      reset()
      return target
    } catch (err) {
      toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
      return null
    } finally {
      saving.value = false
    }
  }

  return {
    open,
    mode,
    form,
    saving,
    issues,
    lockedId,
    openBlank,
    openDuplicate,
    openEdit,
    openGenerated,
    close,
    addStep,
    removeStep,
    moveStep,
    addVariable,
    removeVariable,
    effectiveId,
    doCount,
    rollbackCount,
    missingRollback,
    blockingErrors,
    canSave,
    save,
  }
}
