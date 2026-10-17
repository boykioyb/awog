import { computed, ref } from 'vue'
import { LANG_LABEL } from '~/composables/useSelectionTranslate'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import { useSlackStore, type SlackLlm, type SlackMessage } from '~/stores/slack'

// Dịch thread Slack (docs/features/slack-threads.md) sang ngôn ngữ đọc (cài đặt Slack
// `readLang`, mặc định = NGÔN NGỮ GIAO DIỆN) — CHỈ KHI
// người dùng yêu cầu: vào thread luôn thấy BẢN GỐC; "Dịch toàn bộ" ở header dịch cả
// thread đang xem, nút 🌐 trên từng tin dịch riêng tin đó.
//
// State ở mức module: thread view, từng tin và composer cùng đọc một nguồn. Bản dịch
// giữ theo khoá `ts:editedTs:lang` — đúng khoá cache của sidecar — nên tin bị sửa
// (editedTs đổi) tự rơi khỏi cache và được dịch lại.
//
// "Dịch toàn bộ" KHÔNG nhớ qua thread khác / lần mở sau (cố ý, không localStorage): bản
// cũ nhớ lựa chọn nên một lần bấm là mọi thread về sau đều tự dịch hết — tốn tiền và
// người dùng muốn đọc bản gốc trước (khách Nhật, bản dịch chỉ để tham khảo). Đổi thread
// ⇒ resetFlips() đưa về bản gốc.
//
// Đổi cài đặt dịch (model / phong cách / thuật ngữ) ⇒ clearTexts() bỏ mọi bản dịch đang
// giữ; `epoch` chặn kết quả của lượt dịch đang bay (theo cài đặt cũ) ghi đè vào sau.

// Số tin dịch song song (mỗi tin một lời gọi `slack.translate`, có cache ở sidecar).
const CONCURRENCY = 4

const showOriginal = ref(true)
const texts = ref<Record<string, string>>({})
const pending = ref(new Set<string>())
// Tin người dùng lật ngược so với trạng thái chung của thread, theo `ts`.
const flipped = ref(new Set<string>())
const lastError = ref('')
let epoch = 0

export function useSlackTranslation() {
  const store = useSlackStore()
  const settings = useSettingsStore()
  const projects = useProjectsStore()
  const { locale } = useI18n()

  const targetLang = computed(() => store.settings.translate.readLang ?? LANG_LABEL[locale.value])

  const keyOf = (m: SlackMessage): string => `${m.ts}:${m.editedTs ?? ''}:${targetLang.value}`

  // Model dịch riêng của Slack (đã ghim) > chuỗi chung `inheritedLlm`.
  function resolveLlm(projectId: string | null): SlackLlm {
    const llm = store.settings.translate.llm
    if (llm.mode === 'pinned') {
      return {
        provider: llm.provider,
        modelId: llm.modelId,
        ...(llm.accountId ? { accountId: llm.accountId } : {}),
      }
    }
    return inheritedLlm(projectId)
  }

  // Cùng thứ tự với selection-translate: model dịch chung đã ghim > mặc định của project >
  // mặc định của app. (Cài đặt Slack để "Dùng model dịch chung của app".)
  function inheritedLlm(projectId: string | null): SlackLlm {
    const tr = settings.translate
    if (tr && !tr.followAppDefault) {
      return {
        provider: tr.provider,
        modelId: tr.modelId,
        ...(tr.accountId ? { accountId: tr.accountId } : {}),
      }
    }
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

  const translationOf = (m: SlackMessage): string | null => texts.value[keyOf(m)] ?? null
  const isPending = (m: SlackMessage): boolean => pending.value.has(keyOf(m))
  const isOriginal = (m: SlackMessage): boolean => showOriginal.value !== flipped.value.has(m.ts)

  /** Text nên hiện cho một tin: bản dịch nếu đang xem bản dịch và đã có, không thì gốc. */
  const displayText = (m: SlackMessage): string =>
    isOriginal(m) ? m.text : (translationOf(m) ?? m.text)

  async function ensure(
    threadId: string,
    messages: SlackMessage[],
    projectId: string | null,
  ): Promise<void> {
    const todo = messages.filter(
      (m) => m.text.trim() && !texts.value[keyOf(m)] && !pending.value.has(keyOf(m)),
    )
    if (!todo.length || !store.available) return
    const lang = targetLang.value
    const myEpoch = epoch
    const keys = todo.map(keyOf)
    pending.value = new Set([...pending.value, ...keys])
    const llm = resolveLlm(projectId)
    // Dịch TỪNG TIN, CONCURRENCY tin song song, tin nào xong hiện ngay. Trước đây gửi lô
    // 20 tin và đợi cả lô ⇒ mọi tin đứng im rồi hiện cùng lúc (trông như chạy tuần tự).
    // Đi từ DƯỚI lên: mở thread là đang cuộn ở đáy, tin đang nhìn có bản dịch trước.
    const queue = [...todo].reverse()
    let done = 0
    let lastErr: unknown = null
    const finish = (key: string): void => {
      if (myEpoch !== epoch) return
      const rest = new Set(pending.value)
      rest.delete(key)
      pending.value = rest
    }
    async function worker(): Promise<void> {
      for (let m = queue.shift(); m; m = queue.shift()) {
        const key = keyOf(m)
        try {
          const out = await store.translate(
            threadId,
            [{ ts: m.ts, editedTs: m.editedTs, text: m.text }],
            lang,
            llm,
          )
          // Cài đặt đã đổi trong lúc chờ ⇒ bản này dịch theo cài đặt cũ, bỏ.
          if (myEpoch !== epoch) return
          const tr = out[m.ts]
          if (tr) texts.value = { ...texts.value, [`${m.ts}:${m.editedTs ?? ''}:${lang}`]: tr }
          done++
        } catch (err) {
          lastErr = err
        } finally {
          finish(key)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    if (myEpoch !== epoch) return
    // Chỉ báo lỗi khi KHÔNG tin nào dịch được; lỗi lẻ tẻ thì tin đó giữ bản gốc.
    if (done === 0 && lastErr) {
      lastError.value = lastErr instanceof Error ? lastErr.message : String(lastErr)
      throw lastErr
    }
    lastError.value = ''
  }

  function toggleThread(): void {
    showOriginal.value = !showOriginal.value
    flipped.value = new Set()
  }

  /** Lật một tin; trả về true nếu tin vừa chuyển sang bản dịch (caller cần `ensure`). */
  function toggleMessage(m: SlackMessage): boolean {
    const next = new Set(flipped.value)
    if (next.has(m.ts)) next.delete(m.ts)
    else next.add(m.ts)
    flipped.value = next
    return !isOriginal(m) && !translationOf(m)
  }

  // Gọi khi đổi thread: về lại bản gốc, bỏ mọi tin đã lật.
  function resetFlips(): void {
    flipped.value = new Set()
    showOriginal.value = true
  }

  // Bỏ mọi bản dịch đang giữ (cài đặt dịch vừa đổi). Không đổi chế độ xem: thread đang
  // "Dịch toàn bộ" vẫn ở đó, caller dịch lại các tin đang hiện.
  function clearTexts(): void {
    epoch++
    texts.value = {}
    pending.value = new Set()
    lastError.value = ''
  }

  return {
    showOriginal: computed(() => showOriginal.value),
    targetLang,
    lastError: computed(() => lastError.value),
    resolveLlm,
    inheritedLlm,
    translationOf,
    isPending,
    isOriginal,
    displayText,
    ensure,
    toggleThread,
    toggleMessage,
    resetFlips,
    clearTexts,
  }
}
