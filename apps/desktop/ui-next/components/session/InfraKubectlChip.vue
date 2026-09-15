<template>
  <!-- Chip ngữ cảnh Kubernetes của phiên (ADR 0088 §7, việc 19/20 — P2).
       Cùng khuôn với InfraChip.vue (AWS): một chip mở popover của CHÍNH nó, ghim
       vào TẦNG PHIÊN (không ghim vào bản `effective` đã giải, để giá trị đang
       kế thừa không bị đóng băng thành ghim).

       KHÁC một điểm có chủ đích: chip này hiện cả khi CHƯA ghim gì, miễn là máy
       có kubeconfig để chọn. Nhánh AWS ẩn đi khi chưa ghim vì việc ghim đầu tiên
       nằm ở trang `/infra`; kubectl không có chỗ nào khác để ghim, nên ẩn tiếp ở
       đây là tự khoá đường vào. Máy KHÔNG có `~/.kube/config` thì vẫn không thấy
       chip nào — luật "không chiếm pixel cho tính năng người dùng không dùng"
       vẫn đúng ở đó. -->
  <span v-if="visible" class="iwrap">
    <button
      type="button"
      class="ctxchip"
      :class="{ on: open, acc: !pinned }"
      :title="t('infra.k8s.chip.title')"
      @click.stop="open = !open"
    >
      <Icon name="k8s" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="ctxchip-lbl">{{ clusterLabel }}</span>
      <span v-if="chipSub" class="ctxchip-sub">{{ chipSub }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>

    <template v-if="open">
      <div class="ibackdrop" @click="open = false" />
      <div class="pop ipop" @click.stop>
        <div class="pl">{{ t('infra.k8s.pop.title') }}</div>

        <!-- Công tắc on/off của tool kubectl cho phiên (2026-09-15). Tắt = xoá
             context/namespace của phiên; bật = chọn sẵn context hiện hành. -->
        <div class="itoggle">
          <span class="itoggle-lbl">{{ t('infra.toggle.k8s') }}</span>
          <SettingsTog :model-value="pinned" @update:model-value="setEnabled" />
        </div>
        <p v-if="!pinned" class="ihint">{{ t('infra.toggle.k8sHint') }}</p>

        <template v-if="pinned">
          <!-- 1 · Context. Đây là giá trị DUY NHẤT đi vào `--context`. -->
          <div class="ifield">
            <div class="ilbl">{{ t('infra.k8s.context.label') }}</div>
            <AppSelect
              :model-value="effective.cluster ?? ''"
              :options="contextOptions"
              :placeholder="t('infra.k8s.context.placeholder')"
              width="100%"
              @update:model-value="onCluster"
            />
            <p v-if="loading" class="ihint">{{ t('infra.k8s.context.loading') }}</p>
            <p v-else-if="loadError" class="ierr">{{ loadError }}</p>
            <p v-else-if="!contexts.length" class="ihint">{{ t('infra.k8s.context.empty') }}</p>
            <p v-else-if="pathsLabel" class="ihint">
              {{ t('infra.k8s.context.from', { path: pathsLabel }) }}
            </p>
          </div>

          <!-- 2 · Namespace. Ô GÕ TỰ do: namespace là dữ liệu của cluster, không
             suy được từ kubeconfig, và AppSelect không nhận giá trị ngoài danh
             sách. Rỗng = "để kubectl quyết" (namespace khai trong context). -->
          <div class="ifield">
            <div class="ilbl">{{ t('infra.k8s.namespace.label') }}</div>
            <input
              :value="namespaceDraft"
              class="iin"
              spellcheck="false"
              :placeholder="t('infra.k8s.namespace.placeholder')"
              @input="namespaceDraft = ($event.target as HTMLInputElement).value"
              @keydown.enter="commitNamespace"
              @blur="commitNamespace"
            />
            <p class="ihint">{{ t('infra.k8s.namespace.note') }}</p>
          </div>

          <!-- 3 · Đích thật sự: tên cluster + API server + user. Chỉ ĐỌC, và chỉ
             metadata — token/cert của user không bao giờ rời kubeconfig. -->
          <div v-if="selected" class="iout">
            <div v-if="selected.cluster" class="iout-row">
              <span class="iout-k">{{ t('infra.k8s.cluster') }}</span>
              <span class="iout-v">{{ selected.cluster }}</span>
            </div>
            <div v-if="selected.server" class="iout-row">
              <span class="iout-k">{{ t('infra.k8s.server') }}</span>
              <span class="iout-v">{{ selected.server }}</span>
            </div>
            <div v-if="selected.user" class="iout-row">
              <span class="iout-k">{{ t('infra.k8s.user') }}</span>
              <span class="iout-v">{{ selected.user }}</span>
            </div>
          </div>
          <p v-if="!selected && effective.cluster" class="ihint">
            {{ t('infra.k8s.unknownContext') }}
          </p>

          <!-- kubectl có trên máy nhưng nằm ngoài allowlist đường dẫn (OrbStack,
             asdf, nvm…) ⇒ `kubectl_cli` không chạy được dù chip vẫn hiện. Khối
             này là đường sửa bằng một cú bấm. -->
          <InfraToolBinaryHint tool="kubectl" />

          <p v-if="saveError" class="ierr">{{ saveError }}</p>
        </template>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Bề mặt trong phiên của ngữ cảnh Kubernetes. Payload `infra.contexts` là L1
// (IPC), nên mọi trường đi qua một hàm thu hẹp thay vì được ép kiểu thẳng —
// cùng khuôn InfraChip.vue.
import type { Session } from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { InfraContext } from '~/types'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const { effective, sessionValue, setForSession } = useInfraContext(() => ({
  sessionId: props.session.id,
}))

type KubeContextEntry = {
  name: string
  cluster: string
  namespace: string
  user: string
  server: string
  current: boolean
}

const open = ref(false)
const loading = ref(false)
const loadError = ref('')
const saveError = ref('')
const contexts = ref<KubeContextEntry[]>([])
const loaded = ref(false)
const pathsLabel = ref('')
const namespaceDraft = ref('')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function message(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message.trim() : ''
  return m || fallback
}

const pinned = computed(() => !!effective.value.cluster)
// Hiện khi đã ghim (để xem/đổi) HOẶC khi máy có gì đó để chọn.
const visible = computed(() => pinned.value || contexts.value.length > 0)

const selected = computed(() => contexts.value.find((c) => c.name === effective.value.cluster))
// Namespace khai trong chính context đang ghim — giá trị kubectl sẽ dùng khi ta
// không ghim gì thêm.
const contextNamespace = computed(() => selected.value?.namespace ?? '')

// Bật → tên context. Tắt → chỉ chữ "Kubernetes", đọc ra ngay là tool đang tắt.
const clusterLabel = computed(() =>
  pinned.value ? effective.value.cluster : t('infra.k8s.chip.name'),
)
const chipSub = computed(() => {
  if (!pinned.value) return `· ${t('infra.chip.off')}`
  const ns = effective.value.namespace || contextNamespace.value
  // `default` là giá trị kubectl tự dùng khi không khai gì — hiện nó ra vẫn hữu
  // ích vì người dùng mới cần thấy mình đang ở đâu.
  return ns ? `· ${ns}` : ''
})

const contextOptions = computed<AppSelectOption[]>(() => {
  const opts = contexts.value.map((c) => ({
    label: c.current ? `${c.name} · ${t('infra.k8s.current')}` : c.name,
    value: c.name,
  }))
  const current = effective.value.cluster
  // Context đang ghim mà không còn trong kubeconfig (file bị sửa/đổi máy) vẫn
  // phải hiện — nếu không AppSelect vẽ ô rỗng và người dùng tưởng chưa ghim gì.
  if (current && !opts.some((o) => o.value === current))
    opts.unshift({ label: current, value: current })
  return opts
})

async function loadContexts(): Promise<void> {
  if (!sc.available || loading.value || loaded.value) return
  loading.value = true
  loadError.value = ''
  try {
    const raw = await sc.request<unknown>('infra.contexts', { tool: 'kubectl' })
    const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
    const out: KubeContextEntry[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      const name = text(item.name)
      if (!name) continue
      out.push({
        name,
        cluster: text(item.cluster),
        namespace: text(item.namespace),
        user: text(item.user),
        server: text(item.server),
        current: item.current === true,
      })
    }
    contexts.value = out
    if (isRecord(raw) && Array.isArray(raw.paths)) {
      pathsLabel.value = raw.paths.map(text).filter(Boolean).join(', ')
    }
  } catch (err) {
    loadError.value = message(err, t('infra.k8s.context.failed'))
  } finally {
    loading.value = false
    loaded.value = true
  }
}

onMounted(() => {
  void loadContexts()
})
watch(open, (now) => {
  if (now) void loadContexts()
})
// Draft đi theo giá trị hiệu lực khi nó đổi từ bên ngoài (đổi chip khác, đổi
// project…), nhưng KHÔNG ghi ngược vào ngữ cảnh — chỉ là nội dung của ô nhập.
watch(
  () => effective.value.namespace,
  (ns) => {
    namespaceDraft.value = ns ?? ''
  },
  { immediate: true },
)

async function pin(patch: InfraContext): Promise<void> {
  saveError.value = ''
  const ok = await setForSession({ ...(sessionValue.value ?? {}), ...patch })
  if (!ok) saveError.value = t('infra.error.save')
}

// Công tắc on/off của tool kubectl cho phiên (2026-09-15). Tắt = xoá
// context+namespace (dừng kế thừa, lệnh không nhận `--context`/`--namespace`). Bật
// = chọn sẵn context ĐANG HIỆN HÀNH (`current`) nếu có, không thì context đầu tiên
// — chip không hiện khi kubeconfig rỗng, nên luôn có cái để chọn.
function setEnabled(on: boolean): void {
  if (on === pinned.value) return
  if (!on) {
    void pin({ cluster: '', namespace: '' })
    return
  }
  const pick = contexts.value.find((c) => c.current)?.name || contexts.value[0]?.name || ''
  if (pick) onCluster(pick)
}

function onCluster(next: string): void {
  if (next === effective.value.cluster) return
  // Namespace ghim của context CŨ không có nghĩa ở context mới — giữ lại là trỏ
  // lệnh sang một namespace có thể không tồn tại. `''` = dừng kế thừa, kubectl
  // quay về namespace khai trong context mới.
  const known = contexts.value.find((c) => c.name === next)
  void pin({ cluster: next, namespace: known?.namespace ?? '' })
}

function commitNamespace(): void {
  const next = namespaceDraft.value.trim()
  if (next === (effective.value.namespace ?? '')) return
  void pin({ namespace: next })
}
</script>
