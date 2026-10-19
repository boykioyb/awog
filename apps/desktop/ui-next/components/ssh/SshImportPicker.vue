<template>
  <LibraryEntityModal
    :open="open"
    :title="t('ssh.import.title')"
    :width="600"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <div class="text-sm text-muted-foreground">{{ t('ssh.import.subtitle') }}</div>

      <div v-if="loading" class="py-4.5 text-center text-sm text-muted-foreground">
        {{ t('ssh.import.loading') }}
      </div>
      <div v-else-if="!candidates.length" class="py-4.5 text-center text-sm text-muted-foreground">
        {{ t('ssh.import.empty') }}
      </div>

      <template v-else>
        <Button variant="link" size="xs" class="h-auto self-start px-0 text-sm" @click="toggleAll">
          {{ allSelected ? t('ssh.import.deselectAll') : t('ssh.import.selectAll') }}
        </Button>
        <!-- List phẳng một khung viền, hàng chia bằng hairline (không chồng card đặc). -->
        <div class="flex max-h-[48vh] flex-col divide-y overflow-y-auto rounded-lg border">
          <label
            v-for="c in candidates"
            :key="c.alias"
            class="flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-accent"
          >
            <Checkbox
              class="mt-0.5"
              :model-value="selected.has(c.alias)"
              @update:model-value="toggle(c.alias)"
            />
            <span class="flex min-w-0 flex-col gap-1">
              <span class="text-sm font-semibold break-all text-foreground">{{ c.alias }}</span>
              <span class="font-mono text-xs break-all text-muted-foreground">
                {{ endpoint(c) }}
              </span>
              <span v-if="c.proxyJump" class="font-mono text-xs break-all text-muted-foreground">
                {{ t('ssh.import.viaJump', { jump: c.proxyJump }) }}
              </span>
            </span>
          </label>
        </div>
      </template>
    </div>

    <template #footer>
      <span class="text-sm text-muted-foreground">
        {{ t('ssh.import.selectedCount', { n: selected.size }) }}
      </span>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!selected.size" variant="default" @click="confirm">
        {{ t('ssh.import.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// SSH import picker (ADR 0063 P1) — lists the dry-run candidates parsed from
// ~/.ssh/config (ssh.importConfig) with checkboxes. Confirm emits the selected
// aliases; the page applies them (ssh.importConfigApply). Re-opening resets the
// selection to all candidates so the common "import everything" path is one click.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { SshConfigCandidate } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    candidates: SshConfigCandidate[]
    loading?: boolean
  }>(),
  { loading: false },
)

const emit = defineEmits<{
  close: []
  confirm: [aliases: string[]]
}>()

const { t } = useI18n()

const selected = ref<Set<string>>(new Set())

// Default to all candidates selected whenever the list (re)loads while open.
watch(
  () => [props.open, props.candidates] as const,
  ([isOpen]) => {
    if (!isOpen) return
    selected.value = new Set(props.candidates.map((c) => c.alias))
  },
  { immediate: true },
)

const allSelected = computed(
  () => props.candidates.length > 0 && selected.value.size === props.candidates.length,
)

const toggle = (alias: string) => {
  const next = new Set(selected.value)
  if (next.has(alias)) next.delete(alias)
  else next.add(alias)
  selected.value = next
}
const toggleAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(props.candidates.map((c) => c.alias))
}
const endpoint = (c: SshConfigCandidate): string =>
  `${c.user ? `${c.user}@` : ''}${c.host}:${c.port}`
const confirm = () => {
  if (selected.value.size) emit('confirm', [...selected.value])
}
</script>
