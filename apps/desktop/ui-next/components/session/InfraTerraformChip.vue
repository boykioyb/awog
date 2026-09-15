<template>
  <!-- Chip ngữ cảnh Terraform của phiên (ADR 0088 §7, việc 12/13 — P1).
       Cùng khuôn InfraChip.vue / InfraKubectlChip.vue: popover riêng, ghim vào
       TẦNG PHIÊN. Giá trị ghim (`workspace`) là ĐƯỜNG DẪN TUYỆT ĐỐI trên đĩa —
       `infra.run.ts` chèn nó thành `-chdir=<đường dẫn>`, nên lệnh chạy đúng thư
       mục bất kể cwd của sidecar.

       Chip chỉ hiện khi quét thấy ít nhất một thư mục có `*.tf` trong project
       (hoặc khi phiên đã ghim sẵn) — repo không có Terraform không thấy gì. -->
  <span v-if="visible" class="iwrap">
    <button
      type="button"
      class="ctxchip"
      :class="{ on: open, acc: !pinned }"
      :title="t('infra.tf.chip.title')"
      @click.stop="open = !open"
    >
      <Icon name="terraform" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <span class="ctxchip-lbl">{{ dirLabel }}</span>
      <span v-if="chipSub" class="ctxchip-sub">{{ chipSub }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>

    <template v-if="open">
      <div class="ibackdrop" @click="open = false" />
      <div class="pop ipop" @click.stop>
        <div class="pl">{{ t('infra.tf.pop.title') }}</div>

        <!-- Công tắc on/off của tool Terraform cho phiên (2026-09-15). Tắt = xoá
             thư mục làm việc của phiên; bật = chọn sẵn thư mục đầu tiên. -->
        <div class="itoggle">
          <span class="itoggle-lbl">{{ t('infra.toggle.tf') }}</span>
          <SettingsTog :model-value="pinned" @update:model-value="setEnabled" />
        </div>
        <p v-if="!pinned" class="ihint">{{ t('infra.toggle.tfHint') }}</p>

        <template v-if="pinned">
          <!-- 1 · Thư mục. Đây là giá trị duy nhất `tf_cli` dùng để định vị stack. -->
          <div class="ifield">
            <div class="ilbl">{{ t('infra.tf.dir.label') }}</div>
            <AppSelect
              :model-value="effective.workspace ?? ''"
              :options="dirOptions"
              :placeholder="t('infra.tf.dir.placeholder')"
              width="100%"
              @update:model-value="onDir"
            />
            <p v-if="loading" class="ihint">{{ t('infra.tf.dir.loading') }}</p>
            <p v-else-if="loadError" class="ierr">{{ loadError }}</p>
            <p v-else-if="!dirs.length" class="ihint">{{ t('infra.tf.dir.empty') }}</p>
          </div>

          <!-- 2 · State nằm ở đâu — câu phải trả lời được TRƯỚC khi động vào. Chỉ
             metadata: loại backend + khoá địa chỉ (`bucket`, `key`, `region`…);
             khoá credential không bao giờ được đọc ra khỏi file `.tf`. -->
          <template v-if="selectedDir">
            <div class="iout">
              <div class="iout-row">
                <span class="iout-k">{{ t('infra.tf.backend') }}</span>
                <span class="iout-v">
                  {{ selectedDir.backendSummary || t('infra.tf.backend.local') }}
                </span>
              </div>
              <div v-if="selectedDir.requiredVersion" class="iout-row">
                <span class="iout-k">{{ t('infra.tf.requiredVersion') }}</span>
                <span class="iout-v">{{ selectedDir.requiredVersion }}</span>
              </div>
              <div class="iout-row">
                <span class="iout-k">{{ t('infra.tf.files') }}</span>
                <span class="iout-v">{{ selectedDir.fileCount }}</span>
              </div>
            </div>
            <p class="ihint">
              {{
                selectedDir.initialized ? t('infra.tf.initialized') : t('infra.tf.notInitialized')
              }}
            </p>

            <!-- 3 · Workspace. `terraform workspace` là trạng thái NẰM TRONG thư mục
               (không phải một trường của ngữ cảnh), nên chip chỉ ĐỌC và nói ra
               điều đó — lệnh `tf_cli` của agent chạy đúng workspace mà thư mục
               đang chọn. Nạp là một cú bấm, vì lệnh này chạm state thật. -->
            <button type="button" class="iact" :disabled="wsLoading" @click="loadWorkspaces()">
              <Icon name="layers" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ wsLoading ? t('infra.tf.ws.loading') : t('infra.tf.ws.load') }}
            </button>
            <p v-if="wsError" class="ierr">{{ wsError }}</p>
            <p v-else-if="wsLoaded" class="ihint">
              {{
                workspaces.length
                  ? t('infra.tf.ws.list', {
                      current: currentWorkspace || t('infra.tf.ws.unknown'),
                      all: workspaces.join(', '),
                    })
                  : t('infra.tf.ws.empty')
              }}
            </p>
            <p class="ihint">{{ t('infra.tf.ws.note') }}</p>
          </template>

          <!-- terraform cài ngoài allowlist (asdf, tfenv…) ⇒ cùng đường sửa. -->
          <InfraToolBinaryHint tool="terraform" />

          <p v-if="saveError" class="ierr">{{ saveError }}</p>
        </template>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// Bề mặt trong phiên của ngữ cảnh Terraform. `infra.contexts` (nhánh terraform)
// quét `*.tf` + đọc block `backend`; `infra.tf-workspaces` chạy
// `terraform workspace list` nhưng CHỈ khi người dùng bấm (luật cứng #4 — không
// tự gọi mạng: backend S3 nghĩa là lệnh đó đọc state thật).
import type { Session } from '~/composables/useSessionsData'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { InfraContext } from '~/types'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const projectsStore = useProjectsStore()
const { effective, sessionValue, setForSession } = useInfraContext(() => ({
  sessionId: props.session.id,
}))

type TerraformDirEntry = {
  path: string
  label: string
  fileCount: number
  requiredVersion: string
  backendType: string
  backendSummary: string
  initialized: boolean
}

const open = ref(false)
const loading = ref(false)
const loadError = ref('')
const saveError = ref('')
const dirs = ref<TerraformDirEntry[]>([])
// Gốc đã quét xong — cửa sổ chống quét lại khi chip mount/watch lặp, nhưng KHÔNG
// khoá vĩnh viễn: đổi project thì `root` đổi và lần quét mới là đúng.
const loadedRoot = ref('')
const wsLoading = ref(false)
const wsError = ref('')
const wsLoaded = ref(false)
const workspaces = ref<string[]>([])
const currentWorkspace = ref('')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
function message(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message.trim() : ''
  return m || fallback
}

const projectPath = computed(() => projectsStore.projectById(props.session.project)?.path ?? '')
const pinned = computed(() => !!effective.value.workspace)
const visible = computed(() => pinned.value || dirs.value.length > 0)
const selectedDir = computed(() => dirs.value.find((d) => d.path === effective.value.workspace))

const dirLabel = computed(() => {
  // Tắt → chỉ chữ "Terraform", đọc ra ngay là tool đang tắt cho phiên.
  if (!pinned.value) return t('infra.tf.chip.name')
  const dir = selectedDir.value
  // Đã ghim nhưng thư mục không còn trong danh sách quét → hiện đường dẫn thô.
  if (!dir) return effective.value.workspace ?? t('infra.tf.chip.noDir')
  // `.` là gốc project — in ra đúng ba ký tự đó thì người dùng không biết nó là
  // thư mục nào.
  return dir.label === '.' ? t('infra.tf.dir.root') : dir.label
})
// Nhãn phụ: workspace đang chọn của thư mục chưa nạp thì không đoán — chỉ hiện
// dấu hiệu đã `init` hay chưa, thứ đọc được ngay từ đĩa.
const chipSub = computed(() => {
  if (!pinned.value) return `· ${t('infra.chip.off')}`
  const dir = selectedDir.value
  if (!dir) return ''
  return dir.backendType ? `· ${dir.backendType}` : `· ${dir.fileCount} .tf`
})

const dirOptions = computed<AppSelectOption[]>(() => {
  const opts = dirs.value.map((d) => ({
    label: d.label === '.' ? t('infra.tf.dir.root') : d.label,
    value: d.path,
  }))
  const current = effective.value.workspace
  if (current && !opts.some((o) => o.value === current)) {
    opts.unshift({ label: current, value: current })
  }
  return opts
})

async function loadDirs(): Promise<void> {
  const root = projectPath.value
  if (!sc.available || loading.value || !root || loadedRoot.value === root) return
  loading.value = true
  loadError.value = ''
  try {
    const raw = await sc.request<unknown>('infra.contexts', { tool: 'terraform', root })
    const list = isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts : []
    const out: TerraformDirEntry[] = []
    for (const item of list) {
      if (!isRecord(item)) continue
      const path = text(item.path)
      if (!path) continue
      out.push({
        path,
        label: text(item.label),
        fileCount: num(item.fileCount),
        requiredVersion: text(item.requiredVersion),
        backendType: text(item.backendType),
        backendSummary: text(item.backendSummary),
        initialized: item.initialized === true,
      })
    }
    dirs.value = out
  } catch (err) {
    loadError.value = message(err, t('infra.tf.dir.failed'))
  } finally {
    loading.value = false
    loadedRoot.value = root
  }
}

async function loadWorkspaces(): Promise<void> {
  const dir = selectedDir.value
  if (!sc.available || !dir || wsLoading.value) return
  wsLoading.value = true
  wsError.value = ''
  try {
    const raw = await sc.request<unknown>('infra.tf-workspaces', { dir: dir.path })
    if (!isRecord(raw) || raw.ok !== true) {
      wsError.value = text(isRecord(raw) ? raw.error : '') || t('infra.tf.ws.failed')
      return
    }
    workspaces.value = Array.isArray(raw.workspaces) ? raw.workspaces.map(text).filter(Boolean) : []
    currentWorkspace.value = text(raw.current)
    wsLoaded.value = true
  } catch (err) {
    wsError.value = message(err, t('infra.tf.ws.failed'))
  } finally {
    wsLoading.value = false
  }
}

onMounted(() => {
  // Danh sách project có thể chưa nạp khi chip mount (cùng ca `useAwsProfileUsage`):
  // không hydrate thì `projectPath` rỗng và chip im lặng biến mất trên project có
  // Terraform thật.
  if (projectsStore.available && !projectsStore.loaded) void projectsStore.hydrate()
  void loadDirs()
})
watch(projectPath, (root) => {
  if (root) void loadDirs()
})
watch(open, (now) => {
  if (now) void loadDirs()
})
watch(
  () => effective.value.workspace,
  () => {
    // Danh sách workspace thuộc về MỘT thư mục; đổi thư mục thì kết quả cũ không
    // còn nghĩa, và để lại sẽ là một danh sách nói về stack khác.
    wsLoaded.value = false
    workspaces.value = []
    currentWorkspace.value = ''
    wsError.value = ''
  },
)

async function pin(patch: InfraContext): Promise<void> {
  saveError.value = ''
  const ok = await setForSession({ ...(sessionValue.value ?? {}), ...patch })
  if (!ok) saveError.value = t('infra.error.save')
}

function onDir(next: string): void {
  if (next === effective.value.workspace) return
  void pin({ workspace: next })
}

// Công tắc on/off của tool Terraform cho phiên (2026-09-15). Tắt = xoá thư mục làm
// việc (lệnh không nhận `-chdir=`). Bật = chọn sẵn thư mục đầu tiên quét được —
// chip không hiện khi project không có `*.tf`, nên luôn có cái để chọn.
function setEnabled(on: boolean): void {
  if (on === pinned.value) return
  if (!on) {
    void pin({ workspace: '' })
    return
  }
  const pick = dirs.value[0]?.path || ''
  if (pick) onDir(pick)
}
</script>
