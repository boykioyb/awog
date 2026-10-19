<template>
  <!-- Bề mặt live trong vùng panel của detail — cùng dáng surface terminal của
       SshDetail: khung viền hairline + head sentence-case (icon + tiêu đề + đếm + đóng). -->
  <div class="overflow-hidden rounded-lg border">
    <div class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <Icon name="move" class="size-3.5" />
      <span class="min-w-0 flex-1 font-semibold">{{ t('ssh.section.forwards') }}</span>
      <Badge variant="secondary">{{ forwards.length }}</Badge>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :title="t('ssh.panel.close')"
        :aria-label="t('ssh.panel.close')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </div>
    <Separator />

    <!-- Active tunnels -->
    <div v-if="!forwards.length" class="px-3.5 py-3 text-sm text-muted-foreground">
      {{ t('ssh.fwd.empty') }}
    </div>
    <div v-else class="flex flex-col divide-y">
      <div v-for="f in forwards" :key="f.forwardId" class="flex items-center gap-2.5 px-3.5 py-2">
        <Badge variant="secondary" class="shrink-0">
          {{ t('ssh.forward.' + f.forward.type) }}
        </Badge>
        <span class="min-w-0 flex-1 font-mono text-sm break-all text-foreground">
          {{ forwardLabel(f) }}
        </span>
        <!-- Trạng thái = viền + chấm theo màu chữ (currentColor) trên nền trong suốt. -->
        <Badge
          variant="outline"
          class="shrink-0 border-current tabular-nums"
          :class="f.status === 'error' ? 'text-destructive' : 'text-success'"
          :title="f.error || undefined"
        >
          <span class="size-2 shrink-0 rounded-full bg-current" />
          {{ t('ssh.fwd.status.' + f.status) }}
        </Badge>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('ssh.fwd.stop')"
          :aria-label="t('ssh.fwd.stop')"
          @click="stop(f.forwardId)"
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>

    <!-- Add a tunnel -->
    <Separator />
    <div class="flex flex-col gap-2 px-3.5 py-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <AppSelect v-model="draft.type" :options="typeOptions" class="shrink-0" />
        <Input
          v-model.number="draft.bindPort"
          type="number"
          class="min-w-0 flex-1 basis-22"
          :placeholder="t('ssh.fwd.bindPort')"
          min="0"
          max="65535"
        />
        <template v-if="draft.type !== 'dynamic'">
          <span class="shrink-0 font-mono text-muted-foreground">
            {{ draft.type === 'local' ? '→' : '←' }}
          </span>
          <Input
            v-model="draft.destHost"
            type="text"
            class="min-w-0 flex-1 basis-22"
            :placeholder="t('ssh.fwd.destHost')"
          />
          <Input
            v-model.number="draft.destPort"
            type="number"
            :placeholder="t('ssh.fwd.destPort')"
            min="1"
            max="65535"
            class="w-21 shrink-0"
          />
        </template>
      </div>
      <div class="flex items-center justify-between gap-2.5">
        <span class="text-sm text-muted-foreground">{{ t('ssh.fwd.bindHint') }}</span>
        <Button :disabled="!canAdd || adding" variant="default" size="sm" @click="add">
          <Icon name="plus" />
          {{ t('ssh.fwd.add') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Port-forward panel (ADR 0063 P4) — lists + starts/stops tunnels over an open
// SSH connection (connId). Local/dynamic bind 127.0.0.1 by default (invariant 6,
// enforced sidecar-side). Refreshes on the ssh:forward-changed event.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useSshApi, type SshForwardInfo } from '~/composables/useSshApi'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import type { PortForward } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ connId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const api = useSshApi()
const sc = useSidecar()

const forwards = ref<SshForwardInfo[]>([])
const adding = ref(false)

type ForwardType = PortForward['type']
const draft = reactive<{
  type: ForwardType
  bindPort: number | null
  destHost: string
  destPort: number | null
}>({ type: 'local', bindPort: null, destHost: '', destPort: null })

const typeOptions = computed(() => [
  { label: t('ssh.forward.local'), value: 'local' },
  { label: t('ssh.forward.remote'), value: 'remote' },
  { label: t('ssh.forward.dynamic'), value: 'dynamic' },
])

const canAdd = computed(() => {
  if (draft.bindPort == null || draft.bindPort < 0) return false
  if (draft.type === 'dynamic') return true
  return !!draft.destHost.trim() && draft.destPort != null && draft.destPort > 0
})

const forwardLabel = (f: SshForwardInfo): string => {
  const fwd = f.forward
  const bind = `${fwd.bindHost ?? '127.0.0.1'}:${fwd.bindPort}`
  if (fwd.type === 'dynamic') return `${bind} (SOCKS)`
  const arrow = fwd.type === 'local' ? '→' : '←'
  return `${bind} ${arrow} ${fwd.destHost}:${fwd.destPort}`
}

async function refresh(): Promise<void> {
  if (!sc.available) return
  try {
    const res = await api.forwardList(props.connId)
    forwards.value = res.forwards
  } catch (err) {
    console.warn('[ssh] forwardList failed', err)
  }
}

function buildForward(): PortForward {
  const id = `fwd-${Date.now().toString(36)}`
  const bindPort = draft.bindPort ?? 0
  if (draft.type === 'dynamic') return { id, type: 'dynamic', bindPort }
  return {
    id,
    type: draft.type,
    bindPort,
    destHost: draft.destHost.trim(),
    destPort: draft.destPort ?? 0,
  }
}

async function add(): Promise<void> {
  if (!canAdd.value || adding.value) return
  adding.value = true
  try {
    await api.forwardStart(props.connId, buildForward())
    draft.destHost = ''
    draft.destPort = null
    await refresh()
  } catch (err) {
    useToast().add({
      title: t('ssh.fwd.startFailed', { error: err instanceof Error ? err.message : '' }),
      color: 'error',
    })
  } finally {
    adding.value = false
  }
}

async function stop(forwardId: string): Promise<void> {
  try {
    await api.forwardStop(forwardId)
    await refresh()
  } catch (err) {
    useToast().add({
      title: t('ssh.fwd.stopFailed', { error: err instanceof Error ? err.message : '' }),
      color: 'error',
    })
  }
}

let unlisten: UnlistenFn | null = null
onMounted(async () => {
  await refresh()
  if (sc.available) {
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt?.type === 'ssh:forward-changed') void refresh()
      })
    } catch {
      unlisten = null
    }
  }
})
onBeforeUnmount(() => {
  if (unlisten) unlisten()
  unlisten = null
})
</script>
