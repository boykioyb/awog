<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="px-3 py-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[11px] uppercase tracking-wider" :style="{ color: t.textDim }">Remotes</div>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.remotes.length === 0"
        class="px-3 py-12 text-center text-xs"
        :style="{ color: t.textDim }"
      >
        No remotes configured
      </div>
      <div
        v-for="r in store.remotes"
        :key="r.name"
        class="px-4 py-3"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2">
          <Cloud :size="14" :style="{ color: t.accent }" />
          <span class="text-sm font-medium" :style="{ color: t.text }">{{ r.name }}</span>
        </div>
        <div class="mt-2 grid gap-1 text-[11px]" style="grid-template-columns: 60px 1fr">
          <span :style="{ color: t.textDim }">fetch</span>
          <span class="font-mono truncate" :style="{ color: t.textMuted }">{{ r.fetchUrl }}</span>
          <span :style="{ color: t.textDim }">push</span>
          <span class="font-mono truncate" :style="{ color: t.textMuted }">{{ r.pushUrl }}</span>
        </div>
        <div class="flex items-center gap-1 mt-3">
          <button
            class="text-[10px] px-2 py-1 rounded transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            :disabled="store.isFetching"
            @click="store.fetchRemote()"
          >
            <DownloadCloud :size="10" class="inline-block mr-1" />
            Fetch
          </button>
          <button
            class="text-[10px] px-2 py-1 rounded transition"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
            :disabled="store.isPulling"
            @click="store.pull()"
          >
            Pull
          </button>
          <button
            class="text-[10px] px-2 py-1 rounded transition"
            :style="{ background: t.accent, color: t.accentText }"
            :disabled="store.isPushing"
            @click="store.push()"
          >
            Push
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Cloud, DownloadCloud } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()
</script>
