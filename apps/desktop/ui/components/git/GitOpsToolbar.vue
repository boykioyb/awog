<template>
  <div class="flex items-center gap-1.5">
    <button
      class="flex items-center gap-1.5 text-[1em] px-2.5 py-1.5 rounded-lg transition"
      :style="btnStyle(store.isFetching)"
      :disabled="store.isFetching"
      @click="store.fetchRemote()"
    >
      <DownloadCloud :size="13" />
      <span>Fetch</span>
      <Loader2 v-if="store.isFetching" :size="11" class="animate-spin" />
    </button>

    <button
      class="flex items-center gap-1.5 text-[1em] px-2.5 py-1.5 rounded-lg transition"
      :style="btnStyle(store.isPulling)"
      :disabled="store.isPulling"
      @click="store.pull()"
    >
      <ArrowDownToLine :size="13" />
      <span>Pull</span>
      <span v-if="store.behind > 0" class="font-mono text-[12px] leading-none">
        ↓{{ store.behind }}
      </span>
      <Loader2 v-if="store.isPulling" :size="11" class="animate-spin" />
    </button>

    <button
      class="flex items-center gap-1.5 text-[1em] px-2.5 py-1.5 rounded-lg font-medium transition"
      :style="primaryBtnStyle"
      :disabled="store.isPushing"
      @click="store.pushDialogOpen = true"
    >
      <ArrowUpFromLine :size="13" />
      <span>Push</span>
      <span v-if="store.ahead > 0" class="font-mono text-[12px] leading-none">
        ↑{{ store.ahead }}
      </span>
      <Loader2 v-if="store.isPushing" :size="11" class="animate-spin" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ArrowDownToLine, ArrowUpFromLine, DownloadCloud, Loader2 } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()

const btnStyle = (busy: boolean) => ({
  background: t.value.bgInput,
  color: busy ? t.value.textDim : t.value.text,
  border: `1px solid ${t.value.border}`,
  cursor: busy ? 'not-allowed' : 'pointer',
})

const primaryBtnStyle = computed(() => ({
  background: store.isPushing ? t.value.bgInput : t.value.accent,
  color: store.isPushing ? t.value.textDim : t.value.accentText,
  border: `1px solid ${store.isPushing ? t.value.border : t.value.accent}`,
  cursor: store.isPushing ? 'not-allowed' : 'pointer',
}))
</script>
