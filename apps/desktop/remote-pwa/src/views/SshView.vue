<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ChevronDown, Plus, Server } from 'lucide-vue-next'
import { capabilities } from '../catalog'
import { gateway } from '../gateway'
import { loadSsh, sshConns, sshError, sshHosts, sshLoading } from '../ssh'
import { openSshHost, showToast } from '../store'
import { usePullToRefresh, useScrollCollapse } from '../gestures'
import { errMsg } from '../util'
import AppSheet from '../components/AppSheet.vue'
import NavBar from '../components/NavBar.vue'
import type { SshHost } from '../types'

// SSH tab — saved hosts from the desktop config (~/.awog/ssh-hosts). Live
// connection status layers on via ssh.connections; everything here requires
// the desktop's unattended switch (the gateway rejects with a clear message
// otherwise, which is what the empty state shows).

const scroller = ref<HTMLElement | null>(null)
const { pull, refreshing, engaged, threshold } = usePullToRefresh(scroller, loadSsh)
const collapsed = useScrollCollapse(scroller)

const creating = ref(false)
const busy = ref(false)
const form = ref({
  id: '',
  name: '',
  host: '',
  port: 22,
  user: '',
  authMethod: 'agent' as 'agent' | 'key' | 'password',
  password: '',
})

onMounted(() => void loadSsh())

function statusOf(h: SshHost): { cls: string; label: string } {
  if (sshConns.value.some((c) => c.hostId === h.id)) return { cls: 'on', label: 'Đã kết nối' }
  switch (h.connectionStatus) {
    case 'connected':
      return { cls: 'on', label: 'Đã kết nối' }
    case 'error':
      return { cls: 'err', label: 'Lỗi' }
    default:
      return { cls: '', label: 'Chưa kết nối' }
  }
}

async function save(): Promise<void> {
  const f = form.value
  if (!f.id.trim() || !f.name.trim() || !f.host.trim() || !f.user.trim()) {
    showToast('Điền đủ id, tên, host và user')
    return
  }
  busy.value = true
  try {
    const now = new Date().toISOString()
    await gateway.request('ssh.upsert', {
      host: {
        id: f.id.trim().toLowerCase(),
        name: f.name.trim(),
        host: f.host.trim(),
        port: f.port || 22,
        user: f.user.trim(),
        authMethod: f.authMethod,
        createdAt: now,
        updatedAt: now,
      },
      mode: 'create',
    })
    if (f.authMethod === 'password' && f.password) {
      await gateway.request('ssh.setCredential', {
        scope: 'host',
        id: f.id.trim().toLowerCase(),
        mode: 'password',
        password: f.password,
      })
    }
    creating.value = false
    form.value = { id: '', name: '', host: '', port: 22, user: '', authMethod: 'agent', password: '' }
    await loadSsh()
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="list">
    <NavBar title="SSH" large :collapsed="collapsed">
      <template #trailing>
        <button
          v-if="capabilities.unattended"
          class="navbtn"
          title="Thêm host"
          aria-label="Thêm host SSH"
          @click="creating = true"
        >
          <Plus class="icn-lg" />
        </button>
      </template>
    </NavBar>

    <div ref="scroller" class="scroll">
      <div
        class="ptr"
        :style="{
          height: `${engaged || refreshing ? pull : 0}px`,
          opacity: Math.min(1, pull / threshold),
        }"
      >
        <span v-if="refreshing" class="spin" />
        <ChevronDown v-else class="icn-md" :class="{ met: pull >= threshold }" />
      </div>

      <div v-if="!capabilities.unattended" class="callout">
        <Server class="icn-lg muted-ic" />
        <p>
          SSH/terminal từ xa đang TẮT. Bật <b>unattended</b> ở Settings → Devices trên máy desktop
          để dùng.
        </p>
      </div>

      <div v-else-if="sshError" class="state danger">{{ sshError }}</div>
      <ul v-else-if="sshLoading && !sshHosts.length" class="rows">
        <li v-for="i in 4" :key="i" class="row"><div class="skel w60" /></li>
      </ul>
      <div v-else-if="!sshHosts.length" class="state muted">Chưa có host nào — bấm + để thêm.</div>

      <ul v-else class="rows">
        <li v-for="h in sshHosts" :key="h.id">
          <button class="row" @click="openSshHost(h.id)">
            <span class="dot" :class="statusOf(h).cls" />
            <span class="cols">
              <span class="name">{{ h.name }}</span>
              <span class="sub muted">{{ h.user }}@{{ h.host }}:{{ h.port }}</span>
            </span>
            <span class="badge">{{ statusOf(h).label }}</span>
          </button>
        </li>
      </ul>
    </div>

    <AppSheet :open="creating" title="Host mới" @close="creating = false">
      <label class="fld"><span>Id (a-z0-9-_)</span><input v-model="form.id" autocapitalize="off" /></label>
      <label class="fld"><span>Tên</span><input v-model="form.name" placeholder="prod-web" /></label>
      <label class="fld"><span>Host</span><input v-model="form.host" autocapitalize="off" placeholder="1.2.3.4 hoặc host.example.com" /></label>
      <div class="fldrow">
        <label class="fld"><span>Port</span><input v-model.number="form.port" type="number" /></label>
        <label class="fld"><span>User</span><input v-model="form.user" autocapitalize="off" /></label>
      </div>
      <label class="fld">
        <span>Xác thực</span>
        <select v-model="form.authMethod">
          <option value="agent">Agent</option>
          <option value="key">Key (identity)</option>
          <option value="password">Password</option>
        </select>
      </label>
      <label v-if="form.authMethod === 'password'" class="fld">
        <span>Password (lưu vào keychain desktop)</span>
        <input v-model="form.password" type="password" autocomplete="off" />
      </label>
      <button class="cta" :disabled="busy" @click="save">{{ busy ? 'Đang lưu…' : 'Lưu host' }}</button>
    </AppSheet>
  </div>
</template>

<style scoped>
.list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.ptr {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  color: var(--text-faint);
  padding-bottom: 4px;
}
.ptr .met {
  color: var(--accent);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 4px 0 20px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  padding: 6px 14px;
  border: none;
  border-bottom: 1px solid var(--hairline);
  background: transparent;
  color: var(--text);
  text-align: left;
}
.row:active {
  background: var(--surface-2);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
}
.dot.on {
  background: var(--accent);
}
.dot.err {
  background: var(--danger);
}
.cols {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* mono-ok: user@host is a typed identity people compare character-for-character. */
  font-family: var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--text-dim);
}
.callout {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 24px;
  text-align: center;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.muted-ic {
  color: var(--text-faint);
}
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 18px;
}
.state.danger {
  color: var(--danger);
}
.skel {
  height: 14px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
}
.w60 {
  width: 60%;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
  font-size: var(--fs-sm);
  color: var(--text-dim);
}
.fldrow {
  display: flex;
  gap: 10px;
}
.fldrow .fld {
  flex: 1;
}
.fld input,
.fld select {
  min-height: var(--tap);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--surface-2);
  color: var(--text);
  padding: 0 12px;
  font-size: var(--fs-md);
}
.cta {
  width: 100%;
  min-height: var(--tap);
  border: none;
  border-radius: var(--r-btn);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
  font-size: var(--fs-md);
}
.cta:disabled {
  opacity: 0.5;
}
</style>
