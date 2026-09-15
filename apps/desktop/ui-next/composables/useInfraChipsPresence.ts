// Ba chip hạ tầng (AWS · Kubernetes · Terraform) có hiện trong hàng ngữ cảnh của
// một phiên hay không (2026-09-15).
//
// VÌ SAO CẦN Ở CẤP CHA. Từ 2026-09-15 phiên mới KHÔNG đóng băng ngữ cảnh nào và
// KHÔNG kế thừa project/app (mỗi tool là một công tắc độc lập, mặc định TẮT — xem
// `useInfraContext`). Trước đó `SessionContextStrip` chỉ vẽ hàng khi có AWS ghim
// (`hasInfra`), nên một phiên mới sẽ không có hàng nào ⇒ không mount được chip
// nào ⇒ không còn đường BẬT một tool. Cha phải biết TRƯỚC "có tool nào để bật/tắt
// không" mới quyết được có vẽ hàng 30px hay không — con không nói ngược lên cha.
//
// Một chip "đáng hiện" khi: phiên đã ghim tool đó (để xem/tắt), HOẶC máy/project
// có sẵn tool đó để bật (profile AWS trong `~/.aws`, context trong kubeconfig, thư
// mục `*.tf` trong project). Đây đúng là luật `visible` mà từng chip tự tính; ở
// đây tính lại ở mức "có/không" để gate cả hàng. Payload `infra.contexts` là L1
// (IPC) nên chỉ đếm phần tử, không tin cấu trúc bên trong.
import { computed, ref, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useProjectsStore } from '~/stores/projects'
import { useInfraContext } from '~/composables/useInfraContext'
import type { Session } from '~/composables/useSessionsData'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function countContexts(raw: unknown): number {
  return isRecord(raw) && Array.isArray(raw.contexts) ? raw.contexts.length : 0
}

export function useInfraChipsPresence(session: MaybeRefOrGetter<Session>) {
  const sc = useSidecar()
  const projectsStore = useProjectsStore()
  const sessionId = computed(() => toValue(session).id)
  const { effective } = useInfraContext(() => ({ sessionId: sessionId.value }))

  const awsCount = ref(0)
  const kubeCount = ref(0)
  const tfCount = ref(0)
  const machineLoaded = ref(false)
  const tfRoot = ref('')

  const projectPath = computed(
    () => projectsStore.projectById(toValue(session).project)?.path ?? '',
  )

  async function probe(tool: 'aws' | 'kubectl' | 'terraform', root?: string): Promise<number> {
    if (!sc.available) return 0
    try {
      const params = root ? { tool, root } : { tool }
      return countContexts(await sc.request<unknown>('infra.contexts', params))
    } catch {
      // Không đọc được thì coi như không có: hàng chỉ mở ra khi CHẮC có gì để bật.
      return 0
    }
  }

  // Máy-scoped (AWS · kube): đọc một lần cho suốt vòng đời chip.
  async function load(): Promise<void> {
    if (machineLoaded.value) return
    machineLoaded.value = true
    awsCount.value = await probe('aws')
    kubeCount.value = await probe('kubectl')
  }

  // Terraform quét theo root project (nhánh riêng vì cần `root` + đổi theo project).
  async function loadTf(): Promise<void> {
    const root = projectPath.value
    if (!root || tfRoot.value === root) return
    tfRoot.value = root
    tfCount.value = await probe('terraform', root)
  }

  watch(projectPath, () => void loadTf(), { immediate: true })

  const awsVisible = computed(() => !!effective.value.profile || awsCount.value > 0)
  const kubeVisible = computed(() => !!effective.value.cluster || kubeCount.value > 0)
  const tfVisible = computed(() => !!effective.value.workspace || tfCount.value > 0)
  const anyVisible = computed(() => awsVisible.value || kubeVisible.value || tfVisible.value)

  return { load, anyVisible, awsVisible, kubeVisible, tfVisible }
}
