<template>
  <div class="ssh-row" @contextmenu.prevent="emit('menu', $event)">
    <div class="ssh-row-top">
      <span class="ssh-av" :style="avatarStyle">{{ initial }}</span>
      <span class="ssh-name">{{ host.name || host.host }}</span>
      <span
        class="ssh-dot"
        :style="{ background: statusColor }"
        :title="statusLabel"
        :aria-label="statusLabel"
      />
      <div class="ssh-row-acts">
        <button
          class="iconbtn ssh-qa"
          :title="t('ssh.detail.connect')"
          :aria-label="t('ssh.detail.connect')"
          @click.stop="emit('connect')"
        >
          <Icon name="play" style="width: 12px; height: 12px" />
        </button>
        <button
          class="iconbtn ssh-qa"
          :title="t('ssh.detail.sftp')"
          :aria-label="t('ssh.detail.sftp')"
          @click.stop="emit('sftp')"
        >
          <Icon name="folder" style="width: 12px; height: 12px" />
        </button>
        <button
          class="iconbtn ssh-qa"
          :title="t('ssh.detail.forward')"
          :aria-label="t('ssh.detail.forward')"
          @click.stop="emit('forward')"
        >
          <Icon name="move" style="width: 12px; height: 12px" />
        </button>
        <button
          class="iconbtn ssh-qa ssh-menu"
          :title="t('ssh.menu.more')"
          :aria-label="t('ssh.menu.more')"
          @click.stop="emit('menu', $event)"
        >
          <Icon name="dots" style="width: 13px; height: 13px" />
        </button>
      </div>
    </div>
    <div class="ssh-sub">
      <span class="ssh-endpoint mono">{{ endpoint }}</span>
      <span v-for="tag in tags" :key="tag" class="tag ssh-tag">{{ tag }}</span>
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
import { hostAccent, SSH_STATUS_COLORS, type SshHost } from '~/stores/ssh'

const props = defineProps<{ host: SshHost }>()

const emit = defineEmits<{
  menu: [event: MouseEvent]
  connect: []
  sftp: []
  forward: []
}>()

const { t } = useI18n()

const initial = computed(() => (props.host.name || props.host.host || '?').charAt(0).toUpperCase())
const endpoint = computed(() => `${props.host.user}@${props.host.host}:${props.host.port}`)
const tags = computed(() => props.host.tags ?? [])
const statusColor = computed(() => SSH_STATUS_COLORS[props.host.connectionStatus ?? 'unknown'])
const statusLabel = computed(() => t(`ssh.status.${props.host.connectionStatus ?? 'unknown'}`))

// Monogram tile colored by a stable per-host hue (seed by folder so a group
// shares a color — Termius-style scanning by hue). Generated HSL, theme-safe.
const avatarStyle = computed(() => {
  const a = hostAccent(props.host.folder || props.host.name || props.host.host)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
})
</script>

<style scoped>
.ssh-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.ssh-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ssh-av {
  width: 24px;
  height: 24px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  flex: 0 0 auto;
}
.ssh-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  font-weight: 550;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssh-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.ssh-row-acts {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
/* Quick-actions + ⋯ reveal on row hover — kept in layout (opacity, not display)
   so fading them in never shifts the status dot / tags. */
.ssh-qa {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--r-xs);
  opacity: 0;
  transition: opacity 0.12s;
}
.libli:hover .ssh-qa {
  opacity: 1;
}
.ssh-qa:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-qa:focus-visible {
  opacity: 1;
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.ssh-endpoint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ssh-tag {
  font-size: 12px;
  padding: 1px 6px;
}
</style>
