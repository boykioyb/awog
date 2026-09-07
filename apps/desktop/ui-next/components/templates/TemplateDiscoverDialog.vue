<template>
  <LibraryEntityModal
    :open="open"
    :title="inspection ? t('templatesDiscover.consent.title') : t('templatesDiscover.title')"
    :lock-scrim="installing"
    :width="620"
    @close="emit('close')"
  >
    <TemplateConsentPanel v-if="inspection" :inspection="inspection" />

    <div v-else class="tdd">
      <div class="tdd-bar">
        <Icon name="search" class="tdd-bar-ic" />
        <input
          v-model="query"
          type="text"
          class="tdd-input"
          :placeholder="t('templatesDiscover.search')"
        />
        <button
          type="button"
          class="tdd-refresh"
          :title="t('templatesDiscover.refresh')"
          :disabled="loading"
          @click="load(true)"
        >
          <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <p class="tdd-origin" :class="{ stale: result.stale }">{{ originText }}</p>

      <div class="tdd-list">
        <p v-if="loading" class="tdd-muted">{{ t('templatesDiscover.loading') }}</p>
        <p v-else-if="!result.entries.length" class="tdd-muted">{{ emptyText }}</p>
        <template v-else>
          <button
            v-for="e in result.entries"
            :key="e.id"
            type="button"
            class="tdd-row"
            :disabled="inspectingId !== ''"
            @click="onPick(e)"
          >
            <Icon name="templates" class="tdd-row-ic" />
            <span class="tdd-row-tx">
              <span class="tdd-row-nm">
                {{ e.name }}
                <span v-if="e.version" class="tag">{{ e.version }}</span>
                <span v-for="kind in e.kinds" :key="kind" class="tag">
                  {{ t('templates.kind.' + kind) }}
                </span>
              </span>
              <span class="tdd-row-sub">{{ e.description || e.id }}</span>
              <span v-if="e.author" class="tdd-row-by">
                {{ t('templatesDiscover.by', { author: e.author }) }}
              </span>
            </span>
            <Icon name="chev-right" class="tdd-row-go" />
          </button>
        </template>
      </div>

      <p class="tdd-muted">{{ t('templatesDiscover.curatedNote') }}</p>
    </div>

    <div v-if="error" class="tdd-error">{{ error }}</div>

    <template #footer>
      <button v-if="inspection" class="btn" :disabled="installing" @click="back">
        {{ t('templatesDiscover.consent.back') }}
      </button>
      <button v-else class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button
        v-if="inspection"
        class="btn pri"
        :disabled="installing || !inspection.entities.length"
        @click="onInstall"
      >
        {{ installing ? t('templatesDiscover.installing') : installLabel }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Khám phá template từ danh mục AWOG công bố (gói #37) — hai bước trong một hộp
// thoại: DUYỆT (tìm + danh sách) rồi ĐỒNG Ý (nội dung thật của bundle).
//
// Bấm một mục KHÔNG cài gì: nó gọi `marketplaceInspect` để đọc `template.json`
// của bundle và dựng màn hình đồng ý. Chỉ nút ở màn hình đó mới ghi, và nó gửi
// kèm `token` của bản kiểm tra — engine từ chối nếu nguồn đã đổi từ lúc đó và trả
// về bản mới, thứ ta hiển thị lại thay vì nuốt.
//
// Offline giảm cấp đúng như bản MCP: cache cũ + banner nói rõ, rồi tới danh sách
// rỗng có giải thích.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import TemplateConsentPanel from '~/components/templates/TemplateConsentPanel.vue'
import {
  useTemplatesStore,
  type MarketplaceEntry,
  type MarketplaceInspection,
  type MarketplaceResult,
} from '~/stores/templates'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; installed: [{ name: string; templateId: string }] }>()

const { t } = useI18n()
const store = useTemplatesStore()

const SEARCH_DEBOUNCE_MS = 300

const query = ref('')
const loading = ref(false)
const error = ref('')
const inspectingId = ref('')
const installing = ref(false)
const inspection = ref<MarketplaceInspection | null>(null)
const result = ref<MarketplaceResult>({
  entries: [],
  origin: 'offline',
  fetchedAt: null,
  stale: false,
})

async function load(refresh = false): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    result.value = await store.marketplaceList({
      query: query.value.trim(),
      ...(refresh ? { refresh: true } : {}),
    })
  } catch (err) {
    result.value = {
      entries: [],
      origin: 'offline',
      fetchedAt: null,
      stale: true,
      error: err instanceof Error ? err.message : 'catalog unavailable',
    }
  } finally {
    loading.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    query.value = ''
    error.value = ''
    inspection.value = null
    installing.value = false
    inspectingId.value = ''
    void load()
  },
  { immediate: true },
)

const back = () => {
  inspection.value = null
  error.value = ''
}

// Đọc nội dung thật của bundle. Không ghi gì — đây chỉ là bước dựng màn hình đồng ý.
async function onPick(entry: MarketplaceEntry): Promise<void> {
  if (inspectingId.value) return
  inspectingId.value = entry.id
  error.value = ''
  try {
    inspection.value = await store.marketplaceInspect(entry.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('templatesDiscover.inspectFailed')
  } finally {
    inspectingId.value = ''
  }
}

async function onInstall(): Promise<void> {
  const current = inspection.value
  if (!current || installing.value) return
  installing.value = true
  error.value = ''
  try {
    const res = await store.marketplaceInstall({
      id: current.entryId,
      token: current.token,
      overwrite: current.alreadyInstalled,
    })
    if (res.status === 'changed') {
      // Nguồn đổi giữa lúc đọc và lúc bấm: không ghi gì, hiện lại nội dung MỚI.
      inspection.value = res.inspection
      error.value = t('templatesDiscover.consent.sourceChanged')
      return
    }
    if (res.status === 'exists') {
      error.value = t('templatesDiscover.consent.exists', { id: res.templateId })
      return
    }
    emit('installed', { name: res.template.name, templateId: res.template.id })
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('templatesDiscover.installFailed')
  } finally {
    installing.value = false
  }
}

const installLabel = computed(() =>
  inspection.value?.alreadyInstalled
    ? t('templatesDiscover.consent.reinstall')
    : t('templatesDiscover.consent.confirm'),
)

const emptyText = computed(() => {
  const r = result.value
  if (query.value.trim() && r.entries.length === 0 && r.origin !== 'offline') {
    return t('templatesDiscover.emptySearch', { query: query.value.trim() })
  }
  return r.origin === 'offline' ? t('templatesDiscover.emptyOffline') : t('templatesDiscover.empty')
})

const originText = computed(() => {
  const r = result.value
  if (r.stale && r.error) return t('templatesDiscover.stale', { error: r.error })
  if (r.origin === 'offline') return t('templatesDiscover.origin.offline')
  if (r.origin === 'cache') {
    return t('templatesDiscover.origin.cache', {
      when: r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : '—',
    })
  }
  return t('templatesDiscover.origin.network')
})
</script>

<style scoped>
.tdd {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tdd-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tdd-bar-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--textDim);
}
.tdd-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.tdd-input:focus {
  border-color: var(--accent);
}
.tdd-refresh {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  padding: 6px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--textDim);
  cursor: pointer;
}
.tdd-refresh:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.tdd-refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.tdd-origin,
.tdd-muted {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.tdd-origin.stale {
  color: var(--amber);
}
.tdd-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 340px;
  overflow-y: auto;
}
.tdd-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.tdd-row:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bgHover);
}
.tdd-row:disabled {
  opacity: 0.6;
  cursor: default;
}
.tdd-row-ic,
.tdd-row-go {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--textDim);
}
.tdd-row-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.tdd-row-nm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.tdd-row-sub,
.tdd-row-by {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tdd-row-by {
  color: var(--textMuted);
}
.tdd-error {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
</style>
