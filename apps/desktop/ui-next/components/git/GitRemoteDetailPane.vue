<template>
  <div class="gdetailpane">
    <div v-if="!remote" class="gsecempty">{{ t('git.sidebar.empty') }}</div>
    <div v-else style="max-width: 560px">
      <div class="gdph">
        <Icon name="conn" style="width: 18px; height: 18px; color: var(--accent)" />
        <span class="gdpt">{{ remote.name }}</span>
      </div>
      <div class="gcard">
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.fetchUrl') }}</span>
          <span class="kvv mono">{{ remote.fetchUrl }}</span>
        </div>
        <div class="kvrow">
          <span class="kvk">{{ t('git.remote.pushUrl') }}</span>
          <span class="kvv mono">{{ remote.pushUrl }}</span>
        </div>
        <div class="gdpactions">
          <button class="btn sm" @click="emit('fetch')">
            <Icon name="refresh" style="width: 13px; height: 13px" />
            {{ t('git.ops.fetch') }}
          </button>
          <button class="btn sm" @click="emit('pull')">{{ t('git.ops.pullWord') }}</button>
          <button class="btn pri sm" @click="emit('push')">{{ t('git.ops.pushWord') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Remote detail pane — fetch/push URLs + ops. Mirrors production GitRemoteDetailPane.vue.
import type { RemoteInfo } from './git-types'

const props = defineProps<{ name: string; remotes: RemoteInfo[] }>()

const emit = defineEmits<{
  (e: 'fetch'): void
  (e: 'pull'): void
  (e: 'push'): void
}>()

const { t } = useI18n()
const remote = computed(() => props.remotes.find((r) => r.name === props.name))
</script>
