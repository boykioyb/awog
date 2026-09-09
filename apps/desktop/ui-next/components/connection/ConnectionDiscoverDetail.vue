<template>
  <div class="cdd">
    <button type="button" class="cdd-back" @click="emit('back')">
      <Icon name="chev-left" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('connectionsDiscover.detail.back') }}
    </button>

    <div class="cdd-head">
      <span class="cdd-nm">{{ entry.title }}</span>
      <span class="tag" :class="installBadgeClass">{{ installBadge }}</span>
      <span v-if="entry.version" class="tag">{{ entry.version }}</span>
    </div>
    <p v-if="entry.description" class="cdd-desc">{{ entry.description }}</p>
    <p class="cdd-id mono">{{ entry.name }}</p>

    <!-- Cảnh báo đọc-trước-khi-đồng-ý. Đây là điểm người dùng nhìn thấy CHÍNH XÁC
         thứ sẽ chạy; không có bước nào trước đó ghi hay khởi chạy gì. -->
    <p class="cdd-warn">{{ t('connectionsDiscover.detail.review') }}</p>

    <template v-if="entry.install.kind === 'remote'">
      <div class="cdd-row">
        <span class="cdd-k">{{ t('connectionsDiscover.detail.transport') }}</span>
        <span class="cdd-v mono">{{ entry.install.transport }}</span>
      </div>
      <div class="cdd-row">
        <span class="cdd-k">{{ t('connectionsDiscover.detail.url') }}</span>
        <span class="cdd-v mono">{{ entry.install.url }}</span>
      </div>
    </template>

    <template v-else-if="entry.install.kind === 'stdio'">
      <div class="cdd-row">
        <span class="cdd-k">{{ t('connectionsDiscover.detail.command') }}</span>
        <!-- mono-ok: dòng lệnh thật sự sẽ chạy — người dùng copy được vào terminal -->
        <span class="cdd-v mono">{{ commandLine }}</span>
      </div>
      <div v-if="entry.install.envKeys.length" class="cdd-row">
        <span class="cdd-k">{{ t('connectionsDiscover.detail.env') }}</span>
        <span class="cdd-v">
          <span v-for="k in entry.install.envKeys" :key="k" class="tag mono cdd-envk">{{ k }}</span>
          <span class="cdd-note">{{ t('connectionsDiscover.detail.envNote') }}</span>
        </span>
      </div>
    </template>

    <p v-else class="cdd-unsupported">
      {{ t('connectionsDiscover.detail.unsupported', { reason: entry.install.reason }) }}
    </p>

    <div v-if="entry.secretFields.length" class="cdd-row">
      <span class="cdd-k">{{ t('connectionsDiscover.detail.secrets') }}</span>
      <span class="cdd-v">
        <span v-for="k in entry.secretFields" :key="k" class="tag warn mono cdd-envk">{{ k }}</span>
      </span>
    </div>

    <div v-if="repoUrl" class="cdd-row">
      <span class="cdd-k">{{ t('connectionsDiscover.detail.repo') }}</span>
      <button type="button" class="cdd-link mono" @click="openRepo">
        {{ repoUrl }}
        <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>
    </div>

    <div class="cdd-actions">
      <span class="cdd-hint">{{ t('connectionsDiscover.detail.verifyHint') }}</span>
      <button v-if="installable" type="button" class="cdd-use" @click="emit('use', entry.id)">
        {{ t('connectionsDiscover.detail.use') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chi tiết một entry MCP Registry (gói #38) — màn hình ĐỒNG Ý.
//
// Đây là chỗ duy nhất mà nội dung bên thứ ba được trình bày đầy đủ trước khi nó
// chạm vào bất cứ thứ gì: lệnh + toàn bộ argument, hoặc URL, kèm danh sách biến
// môi trường (gieo rỗng) và khoá bí mật sẽ phải tự điền. Bấm "Dùng cái này" CHỈ
// mở ConnectionEditor với bản nháp — vẫn còn một lần bấm Lưu nữa mới có gì được
// ghi xuống đĩa, và không có gì được spawn cho tới khi người dùng Test.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { RegistryEntry } from '~/stores/connections'

const props = defineProps<{ entry: RegistryEntry }>()
const emit = defineEmits<{
  back: []
  use: [id: string]
}>()

const { t } = useI18n()

const installable = computed(() => props.entry.install.kind !== 'unsupported')

const installBadge = computed(() => {
  const kind = props.entry.install.kind
  if (kind === 'remote') return t('connectionsDiscover.badge.remote')
  if (kind === 'stdio') return t('connectionsDiscover.badge.stdio')
  return t('connectionsDiscover.badge.unsupported')
})
const installBadgeClass = computed(() =>
  props.entry.install.kind === 'unsupported' ? 'warn' : 'acc',
)

// Dòng lệnh hiển thị = đúng những gì sẽ được spawn dạng mảng (không qua shell).
const commandLine = computed(() => {
  const install = props.entry.install
  if (install.kind !== 'stdio') return ''
  return [install.command, ...install.args].join(' ')
})

// Chỉ nhận https. URL đến từ registry (L1) nên không mở thứ có scheme lạ.
const repoUrl = computed(() => {
  const raw = props.entry.repositoryUrl
  if (!raw) return ''
  try {
    return new URL(raw).protocol === 'https:' ? raw : ''
  } catch {
    return ''
  }
})

const openRepo = () => {
  if (repoUrl.value) void useLinkOpen().openLink(repoUrl.value)
}
</script>

<style scoped>
.cdd {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cdd-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 4px 8px 4px 4px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.cdd-back:hover {
  background: var(--bgHover);
  color: var(--text);
}
.cdd-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cdd-nm {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--text);
}
.cdd-desc {
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
  margin: 0;
}
.cdd-id {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  margin: 0;
  word-break: break-all;
}
.cdd-warn {
  margin: 0;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}
.cdd-row {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 10px;
  align-items: baseline;
}
.cdd-k {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.cdd-v {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  word-break: break-all;
}
.cdd-envk {
  color: var(--textMuted);
}
.cdd-note {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.cdd-unsupported {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}
.cdd-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  background: none;
  border: none;
  color: var(--accent);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}
.cdd-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.cdd-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.cdd-use {
  flex: 0 0 auto;
  padding: 7px 13px;
  border-radius: var(--r-btn);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  cursor: pointer;
}
.cdd-use:hover {
  background: var(--bgHover);
}
</style>
