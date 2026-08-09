<script setup lang="ts">
import { computed, ref } from 'vue'
import AppSheet from './AppSheet.vue'
import { gateway } from '../gateway'
import { enabled, requestPermission, setEnabled, state, supported } from '../notify'
import { applyUpdate, updateReady } from '../pwa'
import { loadCatalog } from '../catalog'
import { loadSessions } from '../store'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const forgetting = ref(false)
const host = location.host

const notifyLabel = computed(() => {
  if (!supported) return 'Không khả dụng (cần HTTPS)'
  switch (state.value) {
    case 'granted':
      return enabled.value ? 'Đang bật' : 'Đã tắt'
    case 'denied':
      return 'Bị chặn trong cài đặt trình duyệt'
    default:
      return 'Chưa cấp quyền'
  }
})

const phaseLabel = computed(() => {
  switch (gateway.phase.value) {
    case 'ready':
      return 'Đã kết nối'
    case 'reconnecting':
      return 'Đang kết nối lại'
    case 'authing':
    case 'connecting':
      return 'Đang kết nối'
    default:
      return 'Ngoại tuyến'
  }
})

async function refreshAll(): Promise<void> {
  await Promise.all([loadCatalog(true), loadSessions()])
  emit('close')
}

function forget(): void {
  gateway.forget()
  emit('close')
}
</script>

<template>
  <AppSheet :open="open" title="Cài đặt" @close="emit('close')">
    <section class="sec">
      <div class="srow">
        <div class="txt">
          <span class="k">Thông báo</span>
          <span class="d muted">{{ notifyLabel }}</span>
        </div>
        <button
          v-if="supported && state === 'default'"
          class="btn"
          @click="requestPermission"
        >
          Cấp quyền
        </button>
        <button
          v-else-if="supported && state === 'granted'"
          class="btn"
          @click="setEnabled(!enabled)"
        >
          {{ enabled ? 'Tắt' : 'Bật' }}
        </button>
      </div>
      <p v-if="!supported" class="hint muted">
        Trình duyệt chỉ cho phép thông báo trên kết nối bảo mật. PWA đang chạy qua HTTP trên IP
        tailnet nên phần này tắt; khi có tên HTTPS (Tailscale serve) nó tự bật lại. Hiện tại app vẫn
        rung nhẹ và hiện huy hiệu số gate đang chờ.
      </p>
    </section>

    <section class="sec">
      <div class="srow">
        <div class="txt">
          <span class="k">Kết nối</span>
          <span class="d muted">{{ phaseLabel }} · {{ host }}</span>
        </div>
        <button class="btn" @click="refreshAll">Làm mới</button>
      </div>
    </section>

    <section v-if="updateReady" class="sec">
      <div class="srow">
        <div class="txt">
          <span class="k">Có bản mới</span>
          <span class="d muted">Tải lại để cập nhật giao diện</span>
        </div>
        <button class="btn btn-accent" @click="applyUpdate">Cập nhật</button>
      </div>
    </section>

    <section class="sec">
      <template v-if="forgetting">
        <p class="warn">Quên thiết bị? Bạn sẽ phải ghép nối lại bằng mã QR trên desktop.</p>
        <div class="row">
          <button class="btn grow" @click="forgetting = false">Huỷ</button>
          <button class="btn btn-danger grow" @click="forget">Quên</button>
        </div>
      </template>
      <button v-else class="btn btn-danger wide" @click="forgetting = true">
        Quên thiết bị này
      </button>
    </section>
  </AppSheet>
</template>

<style scoped>
.sec {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.sec:last-child {
  border-bottom: none;
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.k {
  font-weight: 500;
}
.d {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  font-size: 12px;
  margin: 10px 0 0;
}
.warn {
  font-size: 13px;
  color: var(--danger);
  margin: 0 0 10px;
}
.row {
  display: flex;
  gap: 10px;
}
.grow {
  flex: 1;
}
.wide {
  width: 100%;
  min-height: 44px;
}
</style>
