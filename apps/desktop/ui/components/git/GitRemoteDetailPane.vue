<template>
  <div class="flex-1 overflow-auto p-6">
    <div v-if="!remote" :style="{ color: t.textDim }" class="text-[1em]">
      {{ tr('git.sidebar.empty') }}
    </div>
    <div v-else class="max-w-xl">
      <div class="flex items-center gap-2 mb-4">
        <Cloud :size="18" :style="{ color: t.accent }" />
        <h2 class="text-base font-medium" :style="{ color: t.text }">
          {{ remote.name }}
        </h2>
      </div>

      <div class="rounded p-4" :style="{ background: t.bgPanel, border: `1px solid ${t.border}` }">
        <div class="grid gap-2 text-[1em]" style="grid-template-columns: 80px 1fr">
          <span :style="{ color: t.textDim }">{{ tr('git.remote.fetch_url') }}</span>
          <span class="font-mono break-all" :style="{ color: t.textMuted }">
            {{ remote.fetchUrl }}
          </span>
          <span :style="{ color: t.textDim }">{{ tr('git.remote.push_url') }}</span>
          <span class="font-mono break-all" :style="{ color: t.textMuted }">
            {{ remote.pushUrl }}
          </span>
        </div>

        <div class="flex items-center gap-2 mt-4">
          <button
            class="text-[1em] px-3 py-1.5 rounded transition flex items-center gap-1"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            :disabled="store.isFetching"
            @click="store.fetchRemote()"
          >
            <DownloadCloud :size="12" />
            {{ tr('git.remote.fetch') }}
          </button>
          <button
            class="text-[1em] px-3 py-1.5 rounded transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            :disabled="store.isPulling"
            @click="store.pull()"
          >
            {{ tr('git.remote.pull') }}
          </button>
          <button
            class="text-[1em] px-3 py-1.5 rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            :disabled="store.isPushing"
            @click="store.pushDialogOpen = true"
          >
            {{ tr('git.remote.push') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Cloud, DownloadCloud } from 'lucide-vue-next'
import type { GitRemote } from '~/types'

type Props = {
  name: string
}

const props = defineProps<Props>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const remote = computed<GitRemote | undefined>(() =>
  store.remotes.find((r: GitRemote) => r.name === props.name),
)
</script>
