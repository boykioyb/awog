<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2.5 px-4 py-3.5">
      <span class="text-lg font-semibold text-foreground">{{ t('ssh.nav.keychain') }}</span>
      <Badge variant="secondary">{{ identities.length }}</Badge>
      <Button
        :title="t('ssh.identity.new')"
        class="ml-auto"
        variant="default"
        size="sm"
        @click="emit('new')"
      >
        <Icon name="plus" />
        {{ t('ssh.identity.new') }}
      </Button>
    </div>
    <Separator />

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SshEmptyState
        v-if="!identities.length"
        icon="shield"
        :title="t('ssh.identity.empty')"
        :body="t('ssh.keychain.emptyBody')"
      />
      <div v-else class="flex flex-col gap-2 px-3 py-2">
        <Card
          v-for="idn in identities"
          :key="idn.id"
          class="flex-row items-center gap-3 rounded-lg p-3 shadow-none"
        >
          <span class="grid size-8 shrink-0 place-items-center rounded-md bg-selected text-primary">
            <Icon name="shield" class="size-4" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="text-base font-medium text-foreground">{{ idn.name }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <Badge v-if="idn.keyType" variant="secondary">{{ idn.keyType }}</Badge>
              <span class="font-mono text-sm break-all text-muted-foreground">
                {{ idn.inlineStored ? t('ssh.detail.inlineKey') : idn.keyPath || '—' }}
              </span>
              <Badge
                v-if="idn.hasPassphrase"
                variant="outline"
                class="border-transparent bg-primary/15 text-primary"
              >
                <Icon name="shield" />
                {{ t('ssh.detail.passphrase') }}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground"
            :title="t('ssh.identity.edit')"
            :aria-label="t('ssh.identity.edit')"
            @click="emit('edit', idn.id)"
          >
            <Icon name="edit" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :title="t('ssh.identity.delete')"
            :aria-label="t('ssh.identity.delete')"
            @click="emit('delete', idn.id)"
          >
            <Icon name="trash" />
          </Button>
        </Card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Keychain section of the SSH workspace — a flat list of every saved identity
// (name + key-type chip + key path/inline source + passphrase chip) with New /
// Edit / Delete. Orphan identities (linked to no host) stay editable/deletable
// here. Presentational: the page wires the events to the same CRUD handlers the
// host editor uses. Nothing reads a secret.
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import type { SshIdentity } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'

defineProps<{ identities: SshIdentity[] }>()

const emit = defineEmits<{ new: []; edit: [id: string]; delete: [id: string] }>()

const { t } = useI18n()
</script>
