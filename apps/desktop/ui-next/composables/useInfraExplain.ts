// "Lệnh này làm gì" cho hộp duyệt hạ tầng — hỏi mô hình, không tự bịa.
//
// Thẻ duyệt suy được lớp lệnh, tài khoản, vùng từ payload. Cái nó không suy được
// là NGHĨA của dòng lệnh, nên trước đây phần "Sẽ làm gì" chỉ ghép `<binary> <op>`
// — và với một chuỗi shell nhiều tầng thì token đầu có khi là một phép gán biến,
// nên thẻ đi khoe `POD=api-8d64…` như thể đó là chương trình sắp chạy.
//
// CACHE THEO (ngôn ngữ, dòng lệnh), cấp module. Ba lý do, không phải một:
//   · thẻ duyệt sống trong transcript và bị mount lại mỗi lần cuộn qua;
//   · một lượt bị chặn rồi chạy lại hỏi đúng dòng lệnh đó lần nữa;
//   · đổi ngôn ngữ app không được trả lời bằng bản dịch của ngôn ngữ cũ.
// Không có cache thì mỗi lần cuộn là một lời gọi mô hình nữa.
//
// CHỈ HỎI CHO THẺ ĐANG CHỜ. Một thẻ đã duyệt xong là lịch sử: bỏ tiền diễn giải
// một quyết định đã xong thì không ai được lợi.
import { reactive } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import type { InfraPrompt } from '~/composables/useSessionsData'
import type { ProviderName } from '~/types'

export interface CommandExplanation {
  what: string
  expect: string
  risk: string
}

export interface ExplainState {
  loading: boolean
  /** `true` khi lượt gọi hỏng HOẶC mô hình trả về thứ không đọc được. */
  failed: boolean
  result: CommandExplanation | null
}

/** Tên ngôn ngữ đầy đủ — RPC nhận tên, không nhận mã. */
const LANG_NAME: Record<string, string> = { vi: 'Vietnamese', en: 'English' }

// Trần cache: một phiên dài có thể đi qua hàng trăm hộp duyệt, và mỗi mục giữ cả
// dòng lệnh lẫn ba đoạn văn. Quá trần thì bỏ mục cũ nhất (Map giữ thứ tự chèn).
const MAX_ENTRIES = 60

const cache = new Map<string, ExplainState>()

function remember(key: string, state: ExplainState): ExplainState {
  cache.set(key, state)
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return state
}

export function useInfraExplain() {
  const sc = useSidecar()
  const settings = useSettingsStore()
  const projects = useProjectsStore()
  const { locale } = useI18n()

  // Cùng thứ tự giải như một lượt chat: mặc định của project (nếu phiên thuộc
  // project) rồi tới mặc định của app. KHÔNG dùng model của chính phiên: phiên có
  // thể đang chạy một model đắt cho việc khác, còn đây là một lượt đọc-hiểu ngắn.
  function resolveLlm(projectId?: string): {
    provider: ProviderName
    modelId: string
    accountId?: string
  } {
    const ld = projectId ? projects.projectById(projectId)?.llmDefaults : undefined
    if (ld) {
      return {
        provider: ld.provider,
        modelId: ld.modelId,
        ...(ld.accountId ? { accountId: ld.accountId } : {}),
      }
    }
    return { provider: settings.defaults.provider, modelId: settings.defaults.modelId }
  }

  /**
   * Trả về state cho một lời gọi, và bắn RPC ở lần hỏi đầu tiên. Gọi lại với cùng
   * dòng lệnh thì nhận lại đúng object đó — bên gọi bind thẳng vào template được.
   *
   * KHÔNG ném. Hộp duyệt phải hiện ra và bấm được kể cả khi engine chết hay
   * người dùng chưa cấu hình tài khoản model nào; ba dòng này là phần thêm.
   */
  function explain(prompt: InfraPrompt, projectId?: string): ExplainState {
    const lang = LANG_NAME[locale.value] ?? 'English'
    const key = `${lang}::${prompt.command}`
    const hit = cache.get(key)
    if (hit) return hit

    const state = remember(
      key,
      reactive<ExplainState>({ loading: true, failed: false, result: null }),
    )

    if (!sc.available) {
      state.loading = false
      state.failed = true
      return state
    }

    const llm = resolveLlm(projectId)
    void sc
      .request<CommandExplanation>('infra.explain', {
        command: prompt.command,
        tool: prompt.tool,
        commandClass: prompt.commandClass,
        ...(prompt.profile ? { profile: prompt.profile } : {}),
        ...(prompt.region ? { region: prompt.region } : {}),
        ...(prompt.context ? { context: prompt.context } : {}),
        ...(prompt.namespace ? { namespace: prompt.namespace } : {}),
        ...(prompt.shell ? { shell: true } : {}),
        lang,
        provider: llm.provider,
        modelId: llm.modelId,
        ...(llm.accountId ? { accountId: llm.accountId } : {}),
      })
      .then((res) => {
        state.result = res
        state.loading = false
      })
      .catch((err: unknown) => {
        console.warn('[infra] explain failed', err)
        state.loading = false
        state.failed = true
      })

    return state
  }

  /** Bấm thử lại: bỏ mục cache rồi hỏi lại. */
  function retry(prompt: InfraPrompt, projectId?: string): ExplainState {
    const lang = LANG_NAME[locale.value] ?? 'English'
    cache.delete(`${lang}::${prompt.command}`)
    return explain(prompt, projectId)
  }

  return { explain, retry }
}
