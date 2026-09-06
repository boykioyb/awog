<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on sim-ovl" @click.self="emit('close')">
      <div class="sim-card" role="dialog" aria-modal="true">
        <div class="sim-head">
          <Icon name="shield" class="sim-icn" />
          <span class="sim-title">{{ t('ssh.identity.title') }}</span>
          <button class="btn pri sm sim-new" @click="emit('new')">
            <Icon name="plus" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ t('ssh.identity.new') }}
          </button>
          <button
            class="sim-close"
            :title="t('ssh.panel.close')"
            :aria-label="t('ssh.panel.close')"
            @click="emit('close')"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <div class="sim-body">
          <div v-if="!identities.length" class="sim-empty">{{ t('ssh.identity.empty') }}</div>
          <div v-for="idn in identities" v-else :key="idn.id" class="sim-row">
            <div class="sim-row-main">
              <span class="sim-name">{{ idn.name }}</span>
              <div class="sim-meta">
                <span v-if="idn.keyType" class="sim-kt">{{ idn.keyType }}</span>
                <span class="sim-src mono">
                  {{ idn.inlineStored ? t('ssh.detail.inlineKey') : idn.keyPath || '—' }}
                </span>
                <span v-if="idn.hasPassphrase" class="sim-pp">
                  <Icon name="shield" style="width: 10px; height: 10px" />
                  {{ t('ssh.detail.passphrase') }}
                </span>
              </div>
            </div>
            <button
              class="sim-act"
              :title="t('ssh.identity.edit')"
              :aria-label="t('ssh.identity.edit')"
              @click="emit('edit', idn.id)"
            >
              <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
            <button
              class="sim-act sim-del"
              :title="t('ssh.identity.delete')"
              :aria-label="t('ssh.identity.delete')"
              @click="emit('delete', idn.id)"
            >
              <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Identity manager (ADR 0063 P5) — lists EVERY saved identity so orphans (linked
// to no host) stay editable/deletable, closing the P1 gap where identities were
// only reachable from a host's Identity card. Presentational: the page wires
// new/edit/delete to the same handlers the host card uses.
import { onBeforeUnmount, onMounted } from 'vue'
import type { SshIdentity } from '~/stores/ssh'

const props = defineProps<{ open: boolean; identities: SshIdentity[] }>()
const emit = defineEmits<{ new: []; edit: [id: string]; delete: [id: string]; close: [] }>()

const { t } = useI18n()

const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.sim-ovl {
  align-items: center;
  padding-top: 0;
  /* Base modal band — below the confirm dialog (z-200) it launches for delete. */
  z-index: 120;
}
.sim-card {
  width: 520px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.sim-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.sim-icn {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  color: var(--accent);
}
.sim-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.sim-new {
  margin-left: auto;
}
.sim-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.sim-close:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sim-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sim-body {
  overflow-y: auto;
  padding: 6px 0;
}
.sim-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sim-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
}
.sim-row + .sim-row {
  border-top: 1px solid var(--border);
}
.sim-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sim-name {
  color: var(--text);
  font-weight: 550;
}
.sim-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sim-kt {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--textDim);
  background: var(--bgHover);
}
.sim-src {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  word-break: break-all;
}
.sim-pp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  color: var(--accent);
  background: var(--accentDim);
}
.sim-act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.sim-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sim-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sim-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
</style>
