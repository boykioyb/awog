<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Hero: colored monogram + name + endpoint + status/tags, then a primary
         Connect CTA and icon-only secondary actions. Stays compact so an open
         terminal/SFTP/forward panel below gets the full remaining height. -->
    <header class="flex shrink-0 items-start gap-3 px-4 py-4">
      <!-- Màu monogram sinh theo folder/host (HSL dữ liệu, không phải token theme). -->
      <span
        class="grid size-11 shrink-0 place-items-center rounded-lg text-lg font-semibold"
        :style="monoStyle"
      >
        {{ initial }}
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="text-lg font-semibold break-words text-foreground">
          {{ host.name || host.host }}
        </div>
        <div class="font-mono text-sm break-all text-muted-foreground">{{ endpoint }}</div>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" :class="statusText">
            <span class="size-2 shrink-0 rounded-full bg-current" />
            {{ statusLabel }}
          </Badge>
          <Badge variant="secondary">{{ authMethodLabel }}</Badge>
          <Badge v-if="folder" variant="secondary">
            <Icon name="folder" />
            {{ folder }}
          </Badge>
          <Badge v-for="tag in tags" :key="tag" variant="secondary">{{ tag }}</Badge>
          <Badge
            v-if="host.options?.strictHostKey === false"
            variant="outline"
            class="border-warning text-warning"
            :title="t('ssh.detail.hostKeyOffHint')"
          >
            <Icon name="alert" />
            {{ t('ssh.detail.hostKeyOff') }}
          </Badge>
        </div>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <!-- Đang mở terminal → CTA chuyển sang dạng accent-tint (đang chọn). -->
        <Button
          size="sm"
          class="mr-1"
          :class="{
            'border border-selected-border bg-selected text-primary shadow-none hover:bg-selected':
              showTerminal,
          }"
          :title="t('ssh.detail.connect')"
          @click="emit('connect')"
        >
          <Icon name="play" />
          {{ t('ssh.detail.connect') }}
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-muted-foreground"
          :title="t('ssh.detail.test')"
          :aria-label="t('ssh.detail.test')"
          @click="emit('test')"
        >
          <Icon name="refresh" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-muted-foreground"
          :class="{ 'bg-selected text-primary hover:bg-selected hover:text-primary': showSftp }"
          :title="t('ssh.detail.sftp')"
          :aria-label="t('ssh.detail.sftp')"
          @click="toggleSftp"
        >
          <Icon name="folder" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-muted-foreground"
          :class="{ 'bg-selected text-primary hover:bg-selected hover:text-primary': showForward }"
          :title="t('ssh.detail.forward')"
          :aria-label="t('ssh.detail.forward')"
          @click="toggleForward"
        >
          <Icon name="move" />
        </Button>
        <Separator orientation="vertical" class="mx-1 h-4.5" />
        <Button
          variant="ghost"
          size="iconMd"
          class="text-muted-foreground"
          :title="t('ssh.detail.edit')"
          :aria-label="t('ssh.detail.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" />
        </Button>
        <Button
          variant="ghost"
          size="iconMd"
          class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :title="t('ssh.detail.delete')"
          :aria-label="t('ssh.detail.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" />
        </Button>
      </div>
    </header>
    <Separator />

    <!-- Body: a live surface (terminal / SFTP / forward) takes over full height
         when open; otherwise the host info list scrolls. -->
    <div
      v-if="hasPanel"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pt-3.5 pb-4"
    >
      <section
        v-if="showTerminal"
        class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
      >
        <div class="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Icon name="ssh" class="size-3.5" />
          {{ t('ssh.terminal.title') }}
          <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ endpoint }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground"
            :title="t('ssh.terminal.close')"
            :aria-label="t('ssh.terminal.close')"
            @click="store.closeTerminal()"
          >
            <Icon name="x" />
          </Button>
        </div>
        <Separator />
        <div class="min-h-0 flex-1 bg-background">
          <SshTerminal :key="host.id" :host-id="host.id" />
        </div>
      </section>

      <SshSftpBrowser v-if="showSftp && connId" :conn-id="connId" @close="store.closeSftp()" />
      <ConnectGate
        v-else-if="showSftp"
        @connect="store.openTerminal(host.id)"
        @close="store.closeSftp()"
      />

      <SshForwardPanel
        v-if="showForward && connId"
        :conn-id="connId"
        @close="store.closeForward()"
      />
      <ConnectGate
        v-else-if="showForward"
        @connect="store.openTerminal(host.id)"
        @close="store.closeForward()"
      />
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div class="mb-1.5 text-xs font-semibold text-muted-foreground">
        {{ t('ssh.section.connection') }}
      </div>
      <dl class="mb-5.5">
        <div class="flex gap-4 py-2 text-sm [&+&]:border-t">
          <dt class="w-29 shrink-0 text-muted-foreground">{{ t('ssh.editor.host') }}</dt>
          <dd
            class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground font-mono"
          >
            {{ endpoint }}
          </dd>
        </div>
        <div class="flex gap-4 py-2 text-sm [&+&]:border-t">
          <dt class="w-29 shrink-0 text-muted-foreground">{{ t('ssh.detail.authMethod') }}</dt>
          <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground">
            {{ authMethodLabel }}
          </dd>
        </div>
        <div v-if="host.authMethod === 'key'" class="flex gap-4 py-2 text-sm [&+&]:border-t">
          <dt class="w-29 shrink-0 text-muted-foreground">{{ t('ssh.detail.identity') }}</dt>
          <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground">
            <template v-if="identity">
              <span>{{ identity.name }}</span>
              <Badge
                v-if="identity.hasPassphrase"
                variant="outline"
                class="border-transparent bg-primary/15 text-primary"
              >
                {{ t('ssh.detail.passphrase') }}
              </Badge>
              <Button
                variant="ghost"
                size="iconSm"
                class="text-muted-foreground"
                :title="t('ssh.identity.edit')"
                @click="emit('edit-identity', identity.id)"
              >
                <Icon name="edit" />
              </Button>
            </template>
            <Button
              v-else
              variant="ghost"
              size="xs"
              class="gap-1 px-1.5 text-primary"
              @click="emit('new-identity')"
            >
              <Icon name="plus" />
              {{ t('ssh.identity.new') }}
            </Button>
          </dd>
        </div>
        <div
          v-if="host.authMethod === 'key' && identity?.keyPath"
          class="flex gap-4 py-2 text-sm [&+&]:border-t"
        >
          <dt class="w-29 shrink-0 text-muted-foreground">{{ t('ssh.detail.keyPath') }}</dt>
          <dd
            class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground font-mono"
          >
            {{ identity.keyPath }}
          </dd>
        </div>
        <div v-if="jumpHostName" class="flex gap-4 py-2 text-sm [&+&]:border-t">
          <dt class="w-29 shrink-0 text-muted-foreground">{{ t('ssh.detail.jumpHost') }}</dt>
          <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground">
            {{ jumpHostName }}
          </dd>
        </div>
        <div class="flex gap-4 py-2 text-sm [&+&]:border-t">
          <dt class="w-29 shrink-0 text-muted-foreground">
            {{ t('ssh.detail.lastConnected') }}
          </dt>
          <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-2 break-words text-foreground">
            {{ lastConnectedRelative }}
          </dd>
        </div>
      </dl>

      <Alert
        v-if="connectionError"
        variant="destructive"
        class="mb-5.5 border-destructive/40 bg-destructive/10"
      >
        <Icon name="alert" />
        <AlertDescription class="font-mono">{{ connectionError }}</AlertDescription>
      </Alert>

      <template v-if="portForwards.length">
        <div class="mb-1.5 text-xs font-semibold text-muted-foreground">
          {{ t('ssh.section.forwards') }}
        </div>
        <div class="mb-5.5 flex flex-col divide-y overflow-hidden rounded-lg border">
          <div
            v-for="fwd in portForwards"
            :key="fwd.id"
            class="flex items-center gap-2.5 px-3 py-2"
          >
            <Badge variant="secondary">{{ t('ssh.forward.' + fwd.type) }}</Badge>
            <span class="font-mono text-sm break-all text-foreground">{{ forwardLabel(fwd) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// SSH host detail (ADR 0063) — Termius-inspired: a compact hero (colored monogram
// + name + endpoint + status/tags + primary Connect) over EITHER a full-height
// live surface (terminal / SFTP / forward) when one is open, OR a flat host-info
// list. Connect is driven from the page (openTerminal) so the card quick-action
// and this button share one path; SFTP/Forward toggle here. Nothing reads a secret.
import { computed } from 'vue'
import SshTerminal from '~/components/ssh/SshTerminal.vue'
import SshSftpBrowser from '~/components/ssh/SshSftpBrowser.vue'
import SshForwardPanel from '~/components/ssh/SshForwardPanel.vue'
import ConnectGate from '~/components/ssh/SshConnectGate.vue'
import { useSshDetail } from '~/composables/useSshDetail'
import { hostAccent, useSshStore, type PortForward, type SshHost } from '~/stores/ssh'
import { SSH_STATUS_BADGE } from '~/components/ssh/ssh-status'

const props = defineProps<{ host: SshHost }>()

const emit = defineEmits<{
  edit: []
  delete: []
  connect: []
  sftp: []
  forward: []
  test: []
  'edit-identity': [id: string]
  'new-identity': []
}>()

const { t } = useI18n()
const store = useSshStore()

const showTerminal = computed(() => store.terminalHostId === props.host.id)
const showSftp = computed(() => store.sftpHostId === props.host.id)
const showForward = computed(() => store.forwardHostId === props.host.id)
const hasPanel = computed(() => showTerminal.value || showSftp.value || showForward.value)
const connId = computed(() => store.liveConnByHost[props.host.id] ?? null)
const toggleSftp = () => (showSftp.value ? store.closeSftp() : store.openSftp(props.host.id))
const toggleForward = () =>
  showForward.value ? store.closeForward() : store.openForward(props.host.id)

const {
  host,
  status,
  statusLabel,
  endpoint,
  authMethodLabel,
  identity,
  jumpHostName,
  portForwards,
  tags,
  folder,
  connectionError,
  lastConnectedRelative,
} = useSshDetail(() => props.host)

// Màu Badge trạng thái theo utility ngữ nghĩa (thay statusColor dạng var thô).
const statusText = computed(() => SSH_STATUS_BADGE[status.value])

const initial = computed(() => (props.host.name || props.host.host || '?').charAt(0).toUpperCase())
const monoStyle = computed(() => {
  const a = hostAccent(props.host.folder || props.host.name || props.host.host)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
})

const forwardLabel = (fwd: PortForward): string => {
  const bind = `${fwd.bindHost ?? '127.0.0.1'}:${fwd.bindPort}`
  if (fwd.type === 'dynamic') return `${bind} (SOCKS)`
  const arrow = fwd.type === 'local' ? '→' : '←'
  return `${bind} ${arrow} ${fwd.destHost}:${fwd.destPort}`
}
</script>
