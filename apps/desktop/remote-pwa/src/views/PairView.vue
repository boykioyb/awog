<script setup lang="ts">
import { ref, watch } from 'vue'
import { gateway } from '../gateway'
import { clearHash, deviceLabel, detectPlatform, errMsg, hashPairCode } from '../util'

const code = ref(hashPairCode() ?? '')
const busy = ref(false)
const error = ref<string | null>(null)
let autoTried = false

async function doPair(): Promise<void> {
  const c = code.value.trim()
  if (!c || busy.value) return
  busy.value = true
  error.value = null
  try {
    await gateway.pair(c, deviceLabel(), detectPlatform())
    clearHash()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

// Auto-pair once the socket is open (phase 'need-pair') if the QR handed us a code
// in the URL fragment and this isn't a re-pair after revocation (stale one-time code).
watch(
  () => gateway.phase.value,
  (ph) => {
    if (ph === 'need-pair' && code.value && !autoTried && !gateway.revoked.value) {
      autoTried = true
      void doPair()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="pair">
    <div class="card">
      <div class="logo">
        <span class="ring" />
      </div>
      <h1>AWOG Remote</h1>

      <p v-if="gateway.revoked.value" class="notice danger">
        Thiết bị này đã bị thu hồi trên desktop. Hãy tạo mã ghép nối mới ở
        <strong>Settings → Devices</strong> rồi nhập lại.
      </p>
      <p v-else class="notice">
        Quét mã QR ở <strong>Settings → Devices</strong> trên desktop, hoặc nhập mã ghép nối bên
        dưới.
      </p>

      <label class="field">
        <span>Mã ghép nối</span>
        <input
          v-model="code"
          type="text"
          inputmode="text"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="vd. 8F2K-QP7X"
          @keyup.enter="doPair"
        />
      </label>

      <p v-if="error" class="notice danger">{{ error }}</p>

      <button class="btn btn-accent connect" :disabled="!code.trim() || busy" @click="doPair">
        <span v-if="busy" class="spin" />
        <span v-else>Kết nối</span>
      </button>

      <p class="hint muted">
        Điện thoại phải cùng tailnet (Tailscale) với desktop. Không có API key nào được lưu trên
        thiết bị này.
      </p>
    </div>
  </div>
</template>

<style scoped>
.pair {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 22px;
  text-align: center;
}
.logo {
  display: flex;
  justify-content: center;
  margin-bottom: 14px;
}
.ring {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 4px solid var(--accent);
  position: relative;
}
.ring::after {
  content: '';
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  background: var(--accent);
}
h1 {
  font-size: 20px;
  margin: 0 0 14px;
}
.notice {
  font-size: 14px;
  color: var(--text-dim);
  margin: 0 0 18px;
  text-align: left;
}
.notice.danger {
  color: var(--danger);
}
.field {
  display: block;
  text-align: left;
  margin-bottom: 16px;
}
.field span {
  display: block;
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.field input {
  width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  letter-spacing: 1px;
  outline: none;
}
.field input:focus {
  border-color: var(--accent);
}
.connect {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
}
.hint {
  font-size: 12px;
  margin: 16px 0 0;
  text-align: left;
}
</style>
