<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ChevronRight,
  FolderOpen,
  KeyRound,
  Pencil,
  Play,
  Square,
  Trash2,
} from 'lucide-vue-next'
import { connByHost, hostById, identityName, listForwards, loadSsh, sshConnect, sshDisconnect, sshExec, sshHosts, sshTest } from '../ssh'
import { gateway } from '../gateway'
import { navPop, sshHostId, showToast } from '../store'
import { errMsg } from '../util'
import AppSheet from '../components/AppSheet.vue'
import NavBar from '../components/NavBar.vue'
import SftpBrowser from '../components/SftpBrowser.vue'
import type { SshActiveForward, SshExecResult, SshForward } from '../types'

// Host detail — pushed layer over the SSH tab. One live connId at a time is
// what the phone drives: exec + SFTP + forwards all hang off it.

const host = computed(() => (sshHostId.value ? hostById(sshHostId.value) : undefined))
const connId = computed(() => (sshHostId.value ? connByHost.value.get(sshHostId.value) : undefined))
const connected = computed(() => !!connId.value)

const busy = ref('')
const statusErr = ref('')

const cmd = ref('')
const execBusy = ref(false)
const execOut = ref<SshExecResult | null>(null)

const forwards = ref<SshActiveForward[]>([])

const editing = ref(false)
const delArmed = ref(false)
const sftpOpen = ref(false)
const form = ref({
  name: '',
  host: '',
  port: 22,
  user: '',
  authMethod: 'agent' as 'agent' | 'key' | 'password',
  password: '',
})

onMounted(() => {
  if (!sshHosts.value.length) void loadSsh()
})

// Whenever the live conn appears/disappears, refresh the forward list to match.
watch(
  connId,
  async (id) => {
    forwards.value = id ? await listForwards(id).catch(() => []) : []
  },
  { immediate: true },
)

async function connect(): Promise<void> {
  if (!host.value) return
  busy.value = 'connect'
  statusErr.value = ''
  try {
    await sshConnect(host.value.id)
  } catch (e) {
    statusErr.value = errMsg(e)
  } finally {
    busy.value = ''
  }
}

async function disconnect(): Promise<void> {
  const id = connId.value
  if (!id) return
  busy.value = 'disconnect'
  try {
    await sshDisconnect(id)
  } catch (e) {
    statusErr.value = errMsg(e)
  } finally {
    busy.value = ''
  }
}

async function test(): Promise<void> {
  if (!host.value) return
  busy.value = 'test'
  statusErr.value = ''
  try {
    const r = await sshTest(host.value.id)
    if (r.status !== 'connected') statusErr.value = r.error ?? 'không kết nối được'
    else showToast('Kết nối OK')
  } catch (e) {
    statusErr.value = errMsg(e)
  } finally {
    busy.value = ''
  }
}

async function runExec(): Promise<void> {
  const id = connId.value
  if (!id || !cmd.value.trim()) return
  execBusy.value = true
  try {
    execOut.value = await sshExec(id, cmd.value)
    cmd.value = ''
  } catch (e) {
    execOut.value = { stdout: '', stderr: errMsg(e), code: -1 }
  } finally {
    execBusy.value = false
  }
}

function fwdActive(def: SshForward): SshActiveForward | undefined {
  return forwards.value.find((f) => f.forward.id === def.id)
}

async function toggleForward(def: SshForward): Promise<void> {
  const id = connId.value
  if (!id) return
  const live = fwdActive(def)
  try {
    if (live) await gateway.request('ssh.forward.stop', { forwardId: live.forwardId })
    else await gateway.request('ssh.forward.start', { connId: id, forward: def })
    forwards.value = await listForwards(id)
  } catch (e) {
    showToast(errMsg(e))
  }
}

function fwdLabel(f: SshForward): string {
  if (f.type === 'dynamic') return `dynamic :${f.bindPort}`
  return `:${f.bindPort} → ${f.destHost}:${f.destPort}`
}

function startEdit(): void {
  const h = host.value
  if (!h) return
  form.value = {
    name: h.name,
    host: h.host,
    port: h.port,
    user: h.user,
    authMethod: h.authMethod,
    password: '',
  }
  editing.value = true
}

async function saveEdit(): Promise<void> {
  const h = host.value
  if (!h) return
  busy.value = 'edit'
  try {
    await gateway.request('ssh.upsert', {
      host: {
        ...h,
        name: form.value.name.trim() || h.name,
        host: form.value.host.trim() || h.host,
        port: form.value.port || h.port,
        user: form.value.user.trim() || h.user,
        authMethod: form.value.authMethod,
        updatedAt: new Date().toISOString(),
      },
      mode: 'update',
    })
    if (form.value.authMethod === 'password' && form.value.password) {
      await gateway.request('ssh.setCredential', {
        scope: 'host',
        id: h.id,
        mode: 'password',
        password: form.value.password,
      })
    }
    editing.value = false
    await loadSsh()
  } catch (e) {
    showToast(errMsg(e))
  } finally {
    busy.value = ''
  }
}

async function del(): Promise<void> {
  const h = host.value
  if (!h) return
  if (!delArmed.value) {
    delArmed.value = true
    setTimeout(() => (delArmed.value = false), 2600)
    return
  }
  busy.value = 'del'
  try {
    await gateway.request('ssh.delete', { id: h.id })
    await loadSsh()
    navPop()
  } catch (e) {
    showToast(errMsg(e))
    busy.value = ''
  }
}
</script>

<template>
  <div class="host">
    <NavBar
      :title="host?.name ?? 'SSH host'"
      :subtitle="host ? `${host.user}@${host.host}:${host.port}` : ''"
      back
      @back="navPop"
    >
      <template #trailing>
        <button v-if="host" class="navbtn" title="Sửa" aria-label="Sửa host" @click="startEdit">
          <Pencil class="icn-lg" />
        </button>
      </template>
    </NavBar>

    <div v-if="!host" class="state muted">Không tìm thấy host.</div>

    <div v-else class="scroll">
      <!-- Connection -->
      <div class="sect">
        <div class="stitle">Kết nối</div>
        <div class="srow">
          <span class="dot" :class="connected ? 'on' : host.connectionStatus === 'error' ? 'err' : ''" />
          <span class="stext">
            {{ connected ? 'Đã kết nối' : (host.connectionError || 'Chưa kết nối') }}
          </span>
        </div>
        <div v-if="statusErr" class="err muted">{{ statusErr }}</div>
        <div class="btnrow">
          <button v-if="!connected" class="btn accent" :disabled="busy === 'connect'" @click="connect">
            <Play class="icn-sm" /> {{ busy === 'connect' ? 'Đang kết nối…' : 'Kết nối' }}
          </button>
          <button v-else class="btn" :disabled="busy === 'disconnect'" @click="disconnect">
            <Square class="icn-sm" /> Ngắt
          </button>
          <button class="btn" :disabled="busy === 'test'" @click="test">
            {{ busy === 'test' ? 'Đang test…' : 'Test' }}
          </button>
        </div>
        <div v-if="host.identityId" class="srow meta">
          <KeyRound class="icn-sm muted-ic" />
          <span class="muted">Identity: {{ identityName(host.identityId) }}</span>
        </div>
      </div>

      <!-- Exec -->
      <div v-if="connected" class="sect">
        <div class="stitle">Chạy lệnh</div>
        <div class="execrow">
          <input
            v-model="cmd"
            class="einput"
            placeholder="uptime, df -h, docker ps…"
            autocapitalize="off"
            autocorrect="off"
            enterkeyhint="send"
            @keydown.enter.prevent="runExec"
          />
          <button class="btn accent" :disabled="execBusy || !cmd.trim()" @click="runExec">
            {{ execBusy ? '…' : 'Chạy' }}
          </button>
        </div>
        <pre v-if="execOut" class="eout"><template v-if="execOut.stdout">{{ execOut.stdout }}</template><span v-if="execOut.stderr" class="estderr">{{ execOut.stderr }}</span>
exit {{ execOut.code }}</pre>
      </div>

      <!-- SFTP -->
      <div v-if="connected" class="sect">
        <button class="shead" @click="sftpOpen = !sftpOpen">
          <FolderOpen class="icn-md muted-ic" />
          <span class="stitle t0">Tệp (SFTP)</span>
          <ChevronRight class="icn-md caret" :class="{ open: sftpOpen }" />
        </button>
        <SftpBrowser v-if="sftpOpen" :conn-id="connId!" />
      </div>

      <!-- Forwards -->
      <div v-if="host.portForwards?.length" class="sect">
        <div class="stitle">Port forward</div>
        <div v-for="f in host.portForwards" :key="f.id" class="srow fwd">
          <span class="fname">
            {{ f.label || fwdLabel(f) }}
            <span class="muted fpath">{{ fwdLabel(f) }}</span>
          </span>
          <button
            class="btn"
            :class="{ accent: fwdActive(f) }"
            :disabled="!connected"
            @click="toggleForward(f)"
          >
            {{ fwdActive(f) ? 'Đang chạy · Dừng' : 'Bật' }}
          </button>
        </div>
      </div>
      <div v-else-if="connected" class="sect">
        <div class="stitle">Port forward</div>
        <div class="muted nosmall">Host này chưa định nghĩa forward — thêm ở desktop khi cần.</div>
      </div>

      <div v-if="!connected" class="sect">
        <div class="muted nosmall">Kết nối để chạy lệnh, duyệt SFTP và bật forward.</div>
      </div>

      <!-- Danger -->
      <div class="sect">
        <button class="btn danger wide" :class="{ armed: delArmed }" :disabled="busy === 'del'" @click="del">
          <Trash2 class="icn-sm" /> {{ delArmed ? 'Chắc? Bấm lần nữa để xoá' : 'Xoá host' }}
        </button>
      </div>
    </div>

    <!-- Edit sheet -->
    <AppSheet :open="editing" title="Sửa host" @close="editing = false">
      <label class="fld"><span>Tên</span><input v-model="form.name" /></label>
      <label class="fld"><span>Host</span><input v-model="form.host" autocapitalize="off" /></label>
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
        <span>Password mới (bỏ trống = giữ keychain cũ)</span>
        <input v-model="form.password" type="password" autocomplete="off" />
      </label>
      <button class="cta" :disabled="busy === 'edit'" @click="saveEdit">
        {{ busy === 'edit' ? 'Đang lưu…' : 'Lưu' }}
      </button>
    </AppSheet>
  </div>
</template>

<style scoped>
.host {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: calc(20px + var(--sab, env(safe-area-inset-bottom)));
  -webkit-overflow-scrolling: touch;
}
.sect {
  padding: 14px 14px 6px;
  border-bottom: 1px solid var(--hairline);
}
.stitle {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-faint);
  margin-bottom: 8px;
}
.stitle.t0 {
  margin-bottom: 0;
  flex: 1;
  text-align: left;
}
.shead {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  min-height: var(--tap);
  color: var(--text);
}
.caret {
  color: var(--text-faint);
  transition: transform 0.15s;
}
.caret.open {
  transform: rotate(90deg);
}
.srow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  font-size: var(--fs-sm);
}
.srow.meta {
  margin-top: 6px;
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
.stext {
  flex: 1;
  overflow-wrap: anywhere;
}
.err {
  font-size: var(--fs-sm);
  color: var(--danger);
  padding: 4px 0;
  overflow-wrap: anywhere;
}
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--surface-2);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.btn:active {
  background: var(--surface-3);
}
.btn:disabled {
  opacity: 0.45;
}
.btn.accent {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn.danger {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
}
.btn.danger.armed {
  background: var(--danger);
  color: var(--on-accent, #fff);
  border-color: var(--danger);
}
.btn.wide {
  width: 100%;
  margin-bottom: 8px;
}
.muted-ic {
  color: var(--text-faint);
}
.nosmall {
  font-size: var(--fs-sm);
  padding-bottom: 8px;
}
.execrow {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.einput {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--surface-2);
  color: var(--text);
  padding: 0 12px;
  /* mono-ok: a shell command. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.eout {
  margin: 0 0 8px;
  max-height: 200px;
  overflow: auto;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  font-size: var(--fs-xs);
  /* mono-ok: command output. */
  font-family: var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.estderr {
  color: var(--danger);
}
.fwd {
  justify-content: space-between;
  padding: 4px 0;
}
.fname {
  display: flex;
  flex-direction: column;
  font-size: var(--fs-sm);
  font-weight: 600;
  min-width: 0;
}
.fpath {
  font-weight: 400;
  /* mono-ok: a bind→dest mapping. */
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.state {
  padding: 40px 0;
  text-align: center;
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
</style>
