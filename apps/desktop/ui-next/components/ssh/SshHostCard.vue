<template>
  <div class="group flex min-w-0 flex-col gap-1" @contextmenu.prevent="emit('menu', $event)">
    <div class="flex items-center gap-2">
      <!-- Màu monogram sinh theo từng host (HSL dữ liệu, không phải token theme). -->
      <span
        class="grid size-6 shrink-0 place-items-center rounded-sm text-sm font-semibold"
        :style="avatarStyle"
      >
        {{ initial }}
      </span>
      <span class="min-w-0 flex-1 truncate text-base font-medium text-foreground">
        {{ host.name || host.host }}
      </span>
      <span
        class="size-2 shrink-0 rounded-full"
        :class="statusDot"
        :title="statusLabel"
        :aria-label="statusLabel"
      />
      <!-- Quick-action + ⋯ hiện khi hover hàng — giữ chỗ trong layout (opacity, không
           display) để lúc hiện không đẩy chấm trạng thái / tag. -->
      <div class="flex shrink-0 items-center gap-0.5">
        <Button
          :title="t('ssh.detail.connect')"
          :aria-label="t('ssh.detail.connect')"
          :class="qa"
          variant="ghost"
          size="iconSm"
          @click.stop="emit('connect')"
        >
          <Icon name="play" />
        </Button>
        <Button
          :title="t('ssh.detail.sftp')"
          :aria-label="t('ssh.detail.sftp')"
          :class="qa"
          variant="ghost"
          size="iconSm"
          @click.stop="emit('sftp')"
        >
          <Icon name="folder" />
        </Button>
        <Button
          :title="t('ssh.detail.forward')"
          :aria-label="t('ssh.detail.forward')"
          :class="qa"
          variant="ghost"
          size="iconSm"
          @click.stop="emit('forward')"
        >
          <Icon name="move" />
        </Button>
        <Button
          :title="t('ssh.menu.more')"
          :aria-label="t('ssh.menu.more')"
          :class="qa"
          variant="ghost"
          size="iconSm"
          @click.stop="emit('menu', $event)"
        >
          <Icon name="dots" />
        </Button>
      </div>
    </div>
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      <span class="min-w-0 truncate font-mono text-xs text-muted-foreground">{{ endpoint }}</span>
      <Badge
        v-for="tag in tags"
        :key="tag"
        variant="outline"
        class="font-normal text-muted-foreground"
      >
        {{ tag }}
      </Badge>
    </div>
  </div>
</template>

<script setup lang="ts">
// One host row, rendered as a card inside LibraryView's `.libli` (which supplies
// the hover / selected-accent framing). Avatar tile + name + status dot on the top
// line; `user@host:port` (mono) + tag chips beneath. A ⋯ menu button and the
// Connect / SFTP / Forward quick-actions fade in on row hover (kept in layout so
// the fade never shifts the badges — the app's .hoveract idiom).
import { computed } from 'vue'
import { hostAccent, type SshHost } from '~/stores/ssh'
import { SSH_STATUS_DOT } from '~/components/ssh/ssh-status'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ host: SshHost }>()

const emit = defineEmits<{
  menu: [event: MouseEvent]
  connect: []
  sftp: []
  forward: []
}>()

const { t } = useI18n()

const qa = 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'

const initial = computed(() => (props.host.name || props.host.host || '?').charAt(0).toUpperCase())
const endpoint = computed(() => `${props.host.user}@${props.host.host}:${props.host.port}`)
const tags = computed(() => props.host.tags ?? [])
const statusDot = computed(() => SSH_STATUS_DOT[props.host.connectionStatus ?? 'unknown'])
const statusLabel = computed(() => t(`ssh.status.${props.host.connectionStatus ?? 'unknown'}`))

// Monogram tile colored by a stable per-host hue (seed by folder so a group
// shares a color — Termius-style scanning by hue). Generated HSL, theme-safe.
const avatarStyle = computed(() => {
  const a = hostAccent(props.host.folder || props.host.name || props.host.host)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
})
</script>
