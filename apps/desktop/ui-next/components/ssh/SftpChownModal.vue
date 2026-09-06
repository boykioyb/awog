<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on sfmod-ovl" @click.self="emit('cancel')">
      <div class="sfmod-card" role="dialog" aria-modal="true">
        <div class="sfmod-head">
          <Icon name="settings" class="sfmod-icn" />
          <span class="sfmod-title">{{ t('ssh.sftp.chown.title') }}</span>
        </div>
        <div class="sfmod-sub">{{ subtitle }}</div>

        <label class="sfmod-field">
          <span>{{ t('ssh.sftp.chown.owner') }}</span>
          <input
            ref="ownerInput"
            v-model="owner"
            class="sfmod-in mono"
            spellcheck="false"
            placeholder="root"
            @keydown.enter="submit"
          />
        </label>
        <label class="sfmod-field">
          <span>{{ t('ssh.sftp.chown.group') }}</span>
          <input
            v-model="group"
            class="sfmod-in mono"
            spellcheck="false"
            :placeholder="t('ssh.sftp.chown.groupPh')"
            @keydown.enter="submit"
          />
        </label>
        <label class="sfmod-check">
          <input v-model="recursive" type="checkbox" />
          <span>{{ t('ssh.sftp.chown.recursive') }}</span>
        </label>
        <div class="sfmod-hint">{{ t('ssh.sftp.chown.hint') }}</div>

        <div class="sfmod-foot">
          <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
          <button class="btn pri" :disabled="!valid" @click="submit">
            {{ t('ssh.sftp.chown.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// chown editor — owner + optional group + recursive flag. Owner/group are
// charset-validated (mirrors the sidecar's own guard) before the button enables.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type { SftpEntry } from '~/composables/useSshApi'

const props = defineProps<{ open: boolean; targets: SftpEntry[] }>()
const emit = defineEmits<{
  confirm: [owner: string, group: string, recursive: boolean]
  cancel: []
}>()

const { t } = useI18n()
const NAME_RE = /^[A-Za-z0-9._-]+$/

const owner = ref('')
const group = ref('')
const recursive = ref(false)
const ownerInput = useTemplateRef<HTMLInputElement>('ownerInput')

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    owner.value = ''
    group.value = ''
    recursive.value = props.targets.some((e) => e.type === 'dir')
    void nextTick(() => ownerInput.value?.focus())
  },
)

const valid = computed(
  () => NAME_RE.test(owner.value) && (group.value === '' || NAME_RE.test(group.value)),
)
function submit(): void {
  if (valid.value) emit('confirm', owner.value, group.value, recursive.value)
}

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
  width: 360px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  width: var(--icon-md);
  height: var(--icon-md);
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
.sfmod-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sfmod-in {
  padding: 7px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.sfmod-in:focus {
  border-color: var(--accent);
}
.sfmod-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  cursor: pointer;
}
.sfmod-check input {
  accent-color: var(--accent);
  cursor: pointer;
}
.sfmod-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.5;
}
.sfmod-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
