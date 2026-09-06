<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on sfmod-ovl" @click.self="emit('cancel')">
      <div class="sfmod-card" role="dialog" aria-modal="true">
        <div class="sfmod-head">
          <Icon name="shield" class="sfmod-icn" />
          <span class="sfmod-title">{{ t('ssh.sftp.chmod.title') }}</span>
        </div>
        <div class="sfmod-sub">{{ subtitle }}</div>

        <table class="sfmod-grid">
          <thead>
            <tr>
              <th />
              <th>{{ t('ssh.sftp.chmod.read') }}</th>
              <th>{{ t('ssh.sftp.chmod.write') }}</th>
              <th>{{ t('ssh.sftp.chmod.exec') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="grp in GROUPS" :key="grp.key">
              <td class="sfmod-rowlabel">{{ t(`ssh.sftp.chmod.${grp.key}`) }}</td>
              <td v-for="bit in grp.bits" :key="bit">
                <input type="checkbox" :checked="!!(mode & bit)" @change="toggle(bit)" />
              </td>
            </tr>
          </tbody>
        </table>

        <label class="sfmod-octal">
          <span>{{ t('ssh.sftp.chmod.octal') }}</span>
          <input v-model="octal" class="sfmod-octal-in mono" maxlength="3" inputmode="numeric" />
        </label>

        <div class="sfmod-foot">
          <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
          <button class="btn pri" @click="emit('confirm', mode)">
            {{ t('ssh.sftp.chmod.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// chmod editor — a 3×3 rwx grid (owner/group/other) mirrored by an octal input.
// Emits the resulting mode number (standard 0o777 bits). Seeds from the first
// target's current mode on open.
import { computed, ref, watch } from 'vue'
import type { SftpEntry } from '~/composables/useSshApi'

const props = defineProps<{ open: boolean; targets: SftpEntry[] }>()
const emit = defineEmits<{ confirm: [mode: number]; cancel: [] }>()

const { t } = useI18n()

const GROUPS = [
  { key: 'owner', bits: [0o400, 0o200, 0o100] },
  { key: 'group', bits: [0o040, 0o020, 0o010] },
  { key: 'other', bits: [0o004, 0o002, 0o001] },
] as const

const mode = ref(0o644)

watch(
  () => [props.open, props.targets] as const,
  ([isOpen]) => {
    if (isOpen && props.targets[0]) mode.value = props.targets[0].mode & 0o777
  },
  { immediate: true },
)

function toggle(bit: number): void {
  mode.value = mode.value & bit ? mode.value & ~bit : mode.value | bit
}

const octal = computed<string>({
  get: () => (mode.value & 0o777).toString(8).padStart(3, '0'),
  set: (v) => {
    if (/^[0-7]{1,3}$/.test(v)) mode.value = Number.parseInt(v.padStart(3, '0'), 8)
  },
})

const subtitle = computed(() =>
  props.targets.length === 1
    ? props.targets[0]?.name
    : t('ssh.sftp.chmod.many', { count: props.targets.length }),
)
</script>

<style scoped>
.sfmod-ovl {
  align-items: center;
  padding-top: 0;
  z-index: 200;
}
.sfmod-card {
  width: 340px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: var(--shadow-lg);
}
.sfmod-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.sfmod-icn {
  width: 16px;
  height: 16px;
  color: var(--accent);
}
.sfmod-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.sfmod-sub {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  word-break: break-all;
}
.sfmod-grid {
  border-collapse: collapse;
  width: 100%;
}
.sfmod-grid th {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--textDim);
  padding: 4px;
  text-align: center;
}
.sfmod-grid td {
  padding: 6px 4px;
  text-align: center;
}
.sfmod-rowlabel {
  text-align: left !important;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.sfmod-grid input {
  accent-color: var(--accent);
  cursor: pointer;
  width: 15px;
  height: 15px;
}
.sfmod-octal {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sfmod-octal-in {
  width: 70px;
  padding: 5px 8px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  text-align: center;
  outline: none;
}
.sfmod-octal-in:focus {
  border-color: var(--accent);
}
.sfmod-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
