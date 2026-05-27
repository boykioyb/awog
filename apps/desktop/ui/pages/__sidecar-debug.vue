<script setup lang="ts">
import { ref } from 'vue'
import { useSidecar, SidecarError } from '~/composables/useSidecar'

definePageMeta({ layout: false })

type PingResult = { pong: boolean; version: string; ts: number }

const sidecar = useSidecar()
const result = ref<PingResult | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const eventLog = ref<string[]>([])

const ping = async () => {
  loading.value = true
  error.value = null
  result.value = null
  try {
    result.value = await sidecar.request<PingResult>('ping')
  } catch (e) {
    if (e instanceof SidecarError) {
      error.value = `${e.code}: ${e.message}`
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    loading.value = false
  }
}

const callBadMethod = async () => {
  loading.value = true
  error.value = null
  result.value = null
  try {
    await sidecar.request('does-not-exist')
  } catch (e) {
    if (e instanceof SidecarError) {
      error.value = `${e.code}: ${e.message}`
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    loading.value = false
  }
}

let unlisten: (() => void) | null = null

onMounted(async () => {
  if (!sidecar.available) return
  unlisten = await sidecar.onEvent((evt) => {
    eventLog.value = [
      `${new Date().toLocaleTimeString()} ${evt.type}: ${JSON.stringify(evt.payload)}`,
      ...eventLog.value,
    ].slice(0, 20)
  })
})

onUnmounted(() => {
  if (unlisten) unlisten()
})
</script>

<template>
  <div class="min-h-screen p-8 font-mono text-sm" style="background: #0a0a0a; color: #d4d4d4">
    <h1 class="text-xl mb-4">Sidecar IPC Debug</h1>

    <div class="mb-4">
      <span>Tauri runtime:</span>
      <strong :style="{ color: sidecar.available ? '#4ade80' : '#f87171' }">
        {{ sidecar.available ? 'available' : 'NOT available (running in browser?)' }}
      </strong>
    </div>

    <div class="flex gap-2 mb-6">
      <button
        :disabled="loading"
        class="px-3 py-1.5 rounded border"
        style="border-color: #374151; background: #1f2937"
        @click="ping"
      >
        {{ loading ? '...' : 'Call ping' }}
      </button>
      <button
        :disabled="loading"
        class="px-3 py-1.5 rounded border"
        style="border-color: #374151; background: #1f2937"
        @click="callBadMethod"
      >
        Call bogus method (expect -32601)
      </button>
    </div>

    <div v-if="result" class="mb-4 p-3 rounded" style="background: #064e3b">
      <div class="text-xs mb-1" style="color: #6ee7b7">Result</div>
      <pre class="whitespace-pre-wrap break-all">{{ JSON.stringify(result, null, 2) }}</pre>
    </div>

    <div v-if="error" class="mb-4 p-3 rounded" style="background: #7f1d1d">
      <div class="text-xs mb-1" style="color: #fecaca">Error</div>
      <pre class="whitespace-pre-wrap break-all">{{ error }}</pre>
    </div>

    <div class="mt-8">
      <div class="text-xs mb-2" style="color: #9ca3af">Sidecar events (last 20)</div>
      <div class="p-3 rounded text-xs" style="background: #111827; min-height: 100px">
        <div v-if="eventLog.length === 0" style="color: #6b7280">No events yet</div>
        <div v-for="(line, i) in eventLog" :key="i" class="font-mono">{{ line }}</div>
      </div>
    </div>
  </div>
</template>
