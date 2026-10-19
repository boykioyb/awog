<template>
  <!-- Escape do listener window trong script xử lý (giữ hành vi cũ) nên chặn Escape
       của Dialog để không reject hai lần; bấm nền / nút X → reject như bấm scrim cũ.
       z-200: band hộp thoại trên cùng (khớp LibraryConfirmDelete) — đè mọi modal. -->
  <Dialog :open="open && !!prompt" @update:open="(v: boolean) => !v && reject()">
    <DialogContent
      v-if="prompt"
      class="z-200 flex max-w-[92vw] flex-col gap-3.5 rounded-xl p-4.5 sm:max-w-115"
      @escape-key-down.prevent
    >
      <DialogHeader class="flex-row items-center gap-2">
        <Icon
          name="shield"
          class="size-4 shrink-0"
          :class="changed ? 'text-destructive' : 'text-primary'"
        />
        <DialogTitle class="text-lg font-semibold text-foreground">
          {{ changed ? t('ssh.hostKey.titleChanged') : t('ssh.hostKey.title') }}
        </DialogTitle>
      </DialogHeader>

      <DialogDescription
        class="text-sm"
        :class="changed ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ changed ? t('ssh.hostKey.bodyChanged') : t('ssh.hostKey.body') }}
      </DialogDescription>

      <div class="flex flex-col divide-y overflow-hidden rounded-lg border bg-muted">
        <div class="flex gap-3 px-3 py-2 text-sm">
          <span class="min-w-32 shrink-0 text-muted-foreground">
            {{ t('ssh.hostKey.endpoint') }}
          </span>
          <span class="min-w-0 flex-1 font-mono break-all text-foreground select-text">
            {{ prompt.host }}:{{ prompt.port }}
          </span>
        </div>
        <div class="flex gap-3 px-3 py-2 text-sm">
          <span class="min-w-32 shrink-0 text-muted-foreground">
            {{ t('ssh.hostKey.keyType') }}
          </span>
          <span class="min-w-0 flex-1 font-mono break-all text-foreground select-text">
            {{ prompt.keyType }}
          </span>
        </div>
        <div class="flex gap-3 px-3 py-2 text-sm">
          <span class="min-w-32 shrink-0 text-muted-foreground">
            {{ t('ssh.hostKey.fingerprint') }}
          </span>
          <span class="min-w-0 flex-1 font-mono break-all text-primary select-text">
            {{ prompt.fingerprint }}
          </span>
        </div>
      </div>

      <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Checkbox :model-value="remember" @update:model-value="remember = $event === true" />
        <span>{{ t('ssh.hostKey.remember') }}</span>
      </label>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="reject">{{ t('ssh.hostKey.reject') }}</Button>
        <Button :variant="changed ? 'destructive' : 'default'" @click="accept">
          {{ t('ssh.hostKey.accept') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Host-key TOFU prompt (ADR 0063 P2). Shown when the sidecar parks a connect on
// an unknown / changed host key. Accept → verify(true) (+ optionally append to
// known_hosts); Reject → the pending connect fails closed. A `changed` key is
// treated as a red warning (possible MITM). Presentational — the page binds it to
// the ssh store's pendingHostKey + confirmHostKey.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SshHostKeyPrompt } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ open: boolean; prompt: SshHostKeyPrompt | null }>()
const emit = defineEmits<{ confirm: [accept: boolean, remember: boolean] }>()

const { t } = useI18n()

const remember = ref(true)
const changed = computed(() => props.prompt?.status === 'changed')

// Default to NOT remembering a changed key (safer — the user must opt in).
watch(
  () => props.prompt,
  (p) => {
    remember.value = p?.status !== 'changed'
  },
)

const accept = () => emit('confirm', true, remember.value)
const reject = () => emit('confirm', false, false)

const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') reject()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
