import { computed, ref } from 'vue'
import {
  useConnectionsStore,
  type McpSource,
  type RegistryEntry,
  type Source,
  type SourcePresetMeta,
  type SourceTestOutcome,
} from '~/stores/connections'

// "Kết nối nhanh" — the guided add-source flow behind the Connect button (mục
// tiêu: giảm bước tay theo mô hình Connectors của Claude, vẫn giữ mọi chốt chặn
// bảo mật của gói #38/ADR 0060).
//
// Trước đây sau khi chọn entry/preset người dùng phải: mở editor → Save → toggle
// Enabled → Test → (401) bấm OAuth. Flow này gộp thành một chuỗi: upsert → hỏi
// đúng các khoá bí mật (ghi keychain qua source.setSecret, config chỉ giữ
// `secret:KEY`) → source.test (auto-enable khi sạch) → cần thì tự mở OAuth.
// Editor vẫn là đường thoát "Tuỳ chỉnh nâng cao" cho ai muốn sửa command/args.
//
// Chỉ xử lý `type === 'mcp'` (runtime hiện có); api/local presets vẫn mở editor.

export type QuickPhase = 'review' | 'secrets' | 'working' | 'oauth' | 'done' | 'error'

// Một ô bí mật cần người dùng điền trước khi connect. `key` vừa là tên
// env-var/header vừa là keychain key (giống LibraryKvEditor dùng entry.key làm
// key). `required` = registry khai `isSecret` hoặc tên trông-bí-mật — chỉ chặn
// nút submit, không phải khẳng định server bắt buộc. `masked` = input password.
// Target 'clientId'/'clientSecret' phục vụ nhánh BYO OAuth app (xem toByoOauth):
// clientId ghi plaintext vào mcp.clientId (không bí mật), clientSecret đi qua
// keychain và config chỉ giữ `secret:OAUTH_CLIENT_SECRET`.
export type QuickSecretField = {
  key: string
  target: 'env' | 'headers' | 'clientId' | 'clientSecret'
  required: boolean
  masked: boolean
}

// Giống SECRET_KEY_RE của sidecar (mcp/secrets.ts) — chỉ dùng để ĐÁNH DẤU ô nên
// được điền, quyết định ghi keychain vẫn nằm ở setSecret phía sidecar.
const SECRET_NAME_RE = /token|key|credential|authorization|secret|password/i

// Sentinel của oauth.ts (sources/oauth.ts runOAuthFlow): AS chỉ nhận
// confidential client + không có registration_endpoint (Slack) → client_id giả
// chắc chắn bị từ chối ở trang authorize nên sidecar fail sớm với lỗi này.
const BYO_OAUTH_RE = /oauth-client-required/

export function useQuickConnect(opts: {
  // Draft không phải mcp (api/local) hoặc người dùng chọn "Tuỳ chỉnh nâng cao"
  // trước khi lưu: trả quyền cho editor sẵn có, kèm seed.
  onFallbackToEditor: (draft: Source, meta: SourcePresetMeta | null) => void
  // Draft ĐÃ persist (test/OAuth xong mà user muốn sửa tiếp, hoặc lỗi sau khi
  // secrets đã ghi keychain): mở như source tồn tại để giữ `id` — editor sinh
  // id mới cho seed, mà keychain ref giải theo id nên đổi id = mồ côi secrets.
  onOpenExisting: (source: Source) => void
  // Kết nối thành công: trang chọn đúng source vừa tạo.
  onDone: (slug: string) => void
}) {
  const store = useConnectionsStore()
  const toast = useToast()

  const open = ref(false)
  const phase = ref<QuickPhase>('review')
  const draft = ref<McpSource | null>(null)
  const meta = ref<SourcePresetMeta | null>(null)
  // Registry entry đằng sau lượt pick (nếu có) — chỉ giữ secretFields để đánh dấu
  // ô bắt buộc; màn đồng ý ConnectionDiscoverDetail đã hiện đủ command/url.
  const declaredSecrets = ref<string[]>([])
  const secretFields = ref<QuickSecretField[]>([])
  const secretNoteKey = ref('')
  const busyKey = ref('saving')
  const errorText = ref('')
  const errorStderr = ref<string[]>([])
  const doneTools = ref<number | null>(null)
  const oauthPending = ref(false)
  // Slug đã ghi xuống đĩa (set sau saveSource đầu tiên). Phân biệt "draft chưa
  // tồn tại" với "source đã tạo" — quyết định đường ra editor nào ở openInEditor.
  const persistedSlug = ref('')

  const slug = computed(() => draft.value?.slug ?? '')

  function rand8hex(): string {
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  // Slug của draft có thể đụng một source đã cài (registry slug suy ra từ tên
  // entry). Quick path không có ô sửa slug nên tự hậu tố -2/-3… giống điều editor
  // để người dùng tự làm.
  function uniqueSlug(base: string): string {
    const root = base || 'source'
    let candidate = root
    for (let n = 2; store.sourceBySlug(candidate); n += 1) candidate = `${root}-${n}`
    return candidate
  }

  // Id mới phải sinh TRƯỚC save (giống ensureSourceId của editor): setSecret ghi
  // keychain theo id, config giữ cùng id đó nên khoá không bị mồ côi.
  function prepareDraft(p: Source): McpSource {
    const slugName = uniqueSlug(p.slug)
    const d = { ...p, slug: slugName, id: `${slugName}_${rand8hex()}`, enabled: false } as McpSource
    // SSE đã deprecated khỏi spec và source.upsert từ chối hẳn — editor ngầm
    // coerce mọi transport không-stdio thành http (draft.transport map), nên
    // quick path coerce giống hệt để cùng một entry không chết ở đây mà sống ở
    // editor.
    if ((d.mcp.transport ?? 'http') === 'sse') d.mcp = { ...d.mcp, transport: 'http' }
    return d
  }

  // Ô bí mật cần hỏi, suy từ bản nháp:
  //  - stdio: mọi env key được gieo rỗng (bắt buộc nếu registry khai isSecret hoặc
  //    tên trông-bí-mật; còn lại optional — có thể là config không nhạy cảm).
  //  - http bearer: `Authorization` + mọi header registry khai isSecret.
  //  - http oauth/none: không ô nào (none mà test 401 sẽ xử lý sau, xem run()).
  function computeSecretFields(d: McpSource): QuickSecretField[] {
    const declared = new Set(declaredSecrets.value)
    const transport = d.mcp.transport ?? 'http'
    if (transport === 'stdio') {
      return Object.keys(d.mcp.env ?? {})
        .filter((k) => !d.mcp.env?.[k])
        .map((k) => ({
          key: k,
          target: 'env' as const,
          required: declared.has(k) || SECRET_NAME_RE.test(k),
          masked: true,
        }))
    }
    const names = new Set(declared)
    if (d.mcp.authType === 'bearer') names.add('Authorization')
    return [...names].map((k) => ({
      key: k,
      target: 'headers' as const,
      required: true,
      masked: true,
    }))
  }

  function reset(): void {
    phase.value = 'review'
    draft.value = null
    meta.value = null
    declaredSecrets.value = []
    secretFields.value = []
    secretNoteKey.value = ''
    busyKey.value = 'saving'
    errorText.value = ''
    errorStderr.value = []
    doneTools.value = null
    oauthPending.value = false
    persistedSlug.value = ''
  }

  // Điểm vào duy nhất. `entry` có mặt khi user đến từ màn đồng ý của tab Khám
  // phá (đã xem command/url ⇒ bỏ phase review); pick preset tĩnh thì review vẫn
  // hiện để người dùng thấy thứ sắp cấu hình trước khi bấm Kết nối.
  async function start(presetId: string, entry?: RegistryEntry): Promise<void> {
    reset()
    let res: { preset: Source; meta: SourcePresetMeta } | null = null
    try {
      res = await store.discoverPreset(presetId)
    } catch (err) {
      toast.add({
        title: `Could not load preset: ${err instanceof Error ? err.message : 'see console'}`,
        color: 'error',
      })
      return
    }
    if (!res) return
    if (res.preset.type !== 'mcp') {
      opts.onFallbackToEditor(res.preset, res.meta)
      return
    }
    draft.value = prepareDraft(res.preset)
    meta.value = res.meta
    declaredSecrets.value = entry?.secretFields ?? []
    open.value = true
    if (entry) advance()
    else phase.value = 'review'
  }

  // Sau review (hoặc khi bỏ qua review): có ô bí mật → hỏi, không thì chạy luôn.
  function advance(): void {
    if (!draft.value) return
    secretFields.value = computeSecretFields(draft.value)
    secretNoteKey.value = ''
    if (secretFields.value.length) phase.value = 'secrets'
    else void run()
  }

  // Phase secrets → ghi từng giá trị vào keychain (source.setSecret), config chỉ
  // giữ placeholder `secret:<KEY>` — cùng cơ chế ô khoá của LibraryKvEditor nên
  // giá trị bí mật không bao giờ chạm config.json. Riêng clientId là thông tin
  // công khai của app OAuth nên ghi thẳng vào config (không qua keychain).
  async function submitSecrets(values: Record<string, string>): Promise<void> {
    const d = draft.value
    if (!d) return
    try {
      for (const f of secretFields.value) {
        const v = values[f.key]?.trim()
        if (!v) continue
        if (f.target === 'clientId') {
          d.mcp = { ...d.mcp, clientId: v }
          continue
        }
        const placeholder = await store.setSecret(d.id, f.key, v)
        if (f.target === 'clientSecret') {
          d.mcp = { ...d.mcp, clientSecret: placeholder }
          continue
        }
        const record = { ...(f.target === 'env' ? d.mcp.env : d.mcp.headers) }
        record[f.key] = placeholder
        if (f.target === 'env') d.mcp = { ...d.mcp, env: record }
        else d.mcp = { ...d.mcp, headers: record }
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
    await run()
  }

  async function run(): Promise<void> {
    const d = draft.value
    if (!d) return
    phase.value = 'working'
    try {
      busyKey.value = 'saving'
      const saved = await store.saveSource(d)
      persistedSlug.value = saved.slug
      if (d.mcp.authType === 'oauth') return await runOAuth(saved.slug)
      busyKey.value = 'testing'
      const { outcome } = await store.testSource(saved.slug)
      if (outcome.ok) return finishDone(outcome)
      if (outcome.status === 'needs_auth') return await onNeedsAuth(outcome)
      return fail(outcome.error || 'Connection test failed', outcome.stderr)
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  // Test báo 401. Chỉ http mới leo được auth; stdio coi như lỗi thường.
  //  - bearer: token thiếu/sai → quay lại phase secrets hỏi lại Authorization.
  //  - none: server hoá ra cần auth → thử leo OAuth (discovery tự quyết server
  //    có nói OAuth không); discovery/flow hỏng → đường lui là nhập token.
  async function onNeedsAuth(outcome: SourceTestOutcome): Promise<void> {
    const d = draft.value
    if (!d) return
    const transport = d.mcp.transport ?? 'http'
    if (transport === 'stdio') return fail(outcome.error || 'Server requires auth', outcome.stderr)
    if (d.mcp.authType === 'bearer') {
      secretFields.value = declaredHeaderFields()
      secretNoteKey.value = 'tokenRetry'
      phase.value = 'secrets'
      return
    }
    d.mcp = { ...d.mcp, authType: 'oauth' }
    try {
      const saved = await store.saveSource(d)
      await runOAuth(saved.slug, { bearerFallback: true })
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  // Đường lui khi server không nói OAuth (hoặc OAuth lỗi): chuyển sang bearer và
  // hỏi token — vẫn trong cùng modal, không đẩy người dùng ra editor.
  async function toBearerSecrets(noteKey: string): Promise<void> {
    const d = draft.value
    if (!d) return
    d.mcp = { ...d.mcp, authType: 'bearer' }
    secretFields.value = declaredHeaderFields()
    secretNoteKey.value = noteKey
    phase.value = 'secrets'
  }

  // Provider không có Dynamic Client Registration và chỉ nhận confidential
  // client (Slack — "MCP clients must be backed by a registered Slack app"):
  // hỏi client_id/secret của app người dùng tự đăng ký, rồi OAuth bình thường.
  // clientId không phải bí mật (ghi plaintext vào mcp.clientId); clientSecret đi
  // keychain dưới key cố định OAUTH_CLIENT_SECRET — trùng key saveSource dùng
  // khi keychainize plaintext để hai đường ghi chung một slot.
  function toByoOauth(): void {
    secretFields.value = [
      { key: 'clientId', target: 'clientId', required: true, masked: false },
      {
        key: 'OAUTH_CLIENT_SECRET',
        target: 'clientSecret',
        required: true,
        masked: true,
      },
    ]
    secretNoteKey.value = 'byoOauth'
    phase.value = 'secrets'
  }

  function declaredHeaderFields(): QuickSecretField[] {
    const names = new Set(declaredSecrets.value)
    names.add('Authorization')
    return [...names].map((k) => ({
      key: k,
      target: 'headers' as const,
      required: true,
      masked: true,
    }))
  }

  async function runOAuth(slugName: string, ctx: { bearerFallback?: boolean } = {}): Promise<void> {
    phase.value = 'oauth'
    oauthPending.value = true
    let result
    try {
      result = await store.startOAuth(slugName)
    } catch (err) {
      oauthPending.value = false
      return fail(err instanceof Error ? err.message : String(err))
    }
    oauthPending.value = false
    if (result.kind === 'connected') {
      // Test lại một lần: handshake giờ có token → ok → auto-enable + đếm tools.
      busyKey.value = 'testing'
      phase.value = 'working'
      try {
        const { outcome } = await store.testSource(slugName)
        // OAuth xong mà handshake vẫn hỏng (server chết, scope thiếu…) → lỗi
        // thẳng, không được báo "Đã kết nối" sai.
        if (!outcome.ok) return fail(outcome.error || 'Connection test failed', outcome.stderr)
        return finishDone(outcome)
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
    if (result.kind === 'canceled') {
      // Huỷ là hành động có chủ đích — trả về màn review để bấm lại hoặc đóng.
      phase.value = 'review'
      return
    }
    // OAuth thất bại:
    //  - AS chỉ nhận confidential client + không có DCR (Slack) → hỏi creds của
    //    app tự đăng ký. Ưu tiên trên bearerFallback vì cả hai đều đòi user tạo
    //    app, nhưng OAuth còn cho refresh token + consent đúng chuẩn.
    //  - draft gốc 'none' (leo lên) → đường lui token.
    //  - draft vốn 'oauth' (linear/notion…) → lỗi thẳng kèm nút thử lại.
    if (BYO_OAUTH_RE.test(result.error)) return toByoOauth()
    if (ctx.bearerFallback) return toBearerSecrets('oauthUnavailable')
    return fail(result.error)
  }

  function finishDone(outcome: SourceTestOutcome): void {
    doneTools.value = outcome.tools?.length ?? null
    phase.value = 'done'
    const s = slug.value
    if (s) opts.onDone(s)
  }

  function fail(message: string, stderr?: string[]): void {
    errorText.value = message
    errorStderr.value = stderr?.slice(-8) ?? []
    phase.value = 'error'
  }

  function retry(): void {
    void run()
  }

  // Đóng modal. Đang chờ OAuth thì huỷ flow bên sidecar trước — không có việc
  // nào chạy ngầm sau khi đóng (source đã ghi vẫn nằm trong danh sách, đúng như
  // một connection đã lưu; người dùng sửa tiếp bằng editor/detail như thường).
  async function close(): Promise<void> {
    if (oauthPending.value && slug.value) await store.cancelOAuth(slug.value)
    open.value = false
    reset()
  }

  // "Tuỳ chỉnh nâng cao" — đẩy draft hiện tại sang editor. Đã persist ⇒ mở như
  // source tồn tại (giữ id ⇒ keychain ref vẫn giải được); chưa persist ⇒ seed
  // như thường — editor sinh id mới, và đường hiếm "secrets đã ghi nhưng lần lưu
  // đầu hỏng" phục hồi được bằng cách bật-tắt khoá của hàng secret để nhập lại.
  // Tắt modal trước để hai modal không chồng.
  function openInEditor(): void {
    const d = draft.value
    const m = meta.value
    const persisted = persistedSlug.value ? store.sourceBySlug(persistedSlug.value) : null
    open.value = false
    reset()
    if (persisted) opts.onOpenExisting(persisted)
    else if (d) opts.onFallbackToEditor(d, m)
  }

  return {
    open,
    phase,
    draft,
    meta,
    secretFields,
    secretNoteKey,
    busyKey,
    errorText,
    errorStderr,
    doneTools,
    oauthPending,
    start,
    advance,
    submitSecrets,
    retry,
    close,
    openInEditor,
  }
}
