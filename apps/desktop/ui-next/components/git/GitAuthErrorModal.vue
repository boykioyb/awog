<template>
  <Dialog :open="!!error" @update:open="(v) => !v && emit('close')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon name="shield" class="size-4 shrink-0 text-destructive" />
          {{ t('git.auth.title') }}
        </DialogTitle>
        <DialogDescription v-if="error">
          {{ t('git.auth.lead', { op: error.op }) }}
        </DialogDescription>
      </DialogHeader>

      <p class="text-sm text-muted-foreground">{{ hintCopy }}</p>

      <!-- Suggested fix command (copy → paste in a terminal) -->
      <div class="flex items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2">
        <span class="shrink-0 select-none font-mono text-muted-foreground">$</span>
        <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm">
          {{ fixCommand }}
        </code>
        <Button
          variant="ghost"
          class="h-auto p-0 shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          :title="t('git.auth.copyCommand')"
          :aria-label="t('git.auth.copyCommand')"
          @click="copyCommand"
        >
          <Icon :name="copied ? 'check' : 'copy'" class="size-3.5" />
        </Button>
      </div>

      <!-- Raw (sanitized) git stderr, for the curious / for filing bugs -->
      <pre
        v-if="error?.message"
        class="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-input bg-transparent p-3 font-mono text-xs text-muted-foreground"
        >{{ error.message }}</pre
      >

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.close') }}</Button>
        <Button @click="openGithub">
          <Icon name="globe" class="size-3.5" />
          {{ error?.hint === 'ssh-key' ? t('git.auth.openSshKeys') : t('git.auth.openTokens') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Rich auth-failure modal — shown when fetch/pull/push fails to authenticate
// (gitCode AUTH_FAILED). The sidecar tags the error with an `authHint` (SSH key
// vs HTTPS token) which drives actionable copy + a one-click fix command + a
// link to the right GitHub settings page. Mirrors production
// apps/desktop/ui/components/git/GitAuthErrorModal.vue (ported to prototype styling).
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'

type GitAuthHint = 'ssh-key' | 'https-token' | 'unknown'

const props = defineProps<{
  error: { op: string; hint: GitAuthHint; message: string } | null
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const hintCopy = computed(() => {
  switch (props.error?.hint) {
    case 'ssh-key':
      return t('git.auth.hint.sshKey')
    case 'https-token':
      return t('git.auth.hint.httpsToken')
    default:
      return t('git.auth.hint.unknown')
  }
})

// SSH → reload the agent; HTTPS/unknown → re-auth gh (covers the keychain token).
const fixCommand = computed(() => (props.error?.hint === 'ssh-key' ? 'ssh-add' : 'gh auth login'))

const githubUrl = computed(() =>
  props.error?.hint === 'ssh-key'
    ? 'https://github.com/settings/keys'
    : 'https://github.com/settings/tokens',
)

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyCommand() {
  try {
    await navigator.clipboard?.writeText(fixCommand.value)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard unavailable — the command is visible to copy by hand.
  }
}

function openGithub() {
  void useLinkOpen().openLink(githubUrl.value)
}

// Reset the transient "copied" tick whenever a fresh error opens the modal.
watch(
  () => props.error,
  () => {
    copied.value = false
  },
)

onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>
