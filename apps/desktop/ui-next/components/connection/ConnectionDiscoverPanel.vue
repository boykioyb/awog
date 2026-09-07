<template>
  <ConnectionDiscoverDetail
    v-if="selected"
    :entry="selected"
    @back="selected = null"
    @use="emit('pick', $event)"
  />

  <div v-else class="cdp">
    <!-- Gợi ý theo ngữ cảnh: chỉ hiện khi chưa gõ tìm kiếm, và chỉ khi có bằng
         chứng thật. Không có tín hiệu ⇒ nói thẳng là không có, không bịa. -->
    <section v-if="!query.trim()" class="cdp-sug">
      <div class="cdp-sug-head">
        <span class="cdp-lbl">{{ t('connectionsDiscover.suggest.title') }}</span>
        <AppSelect
          v-if="projectOptions.length"
          v-model="projectId"
          :options="projectOptions"
          width="190px"
        />
      </div>
      <p v-if="!projectOptions.length" class="cdp-muted">
        {{ t('connectionsDiscover.suggest.noProject') }}
      </p>
      <p v-else-if="!suggestions.length" class="cdp-muted">
        {{ t('connectionsDiscover.suggest.none') }}
      </p>
      <template v-else>
        <button
          v-for="s in suggestions"
          :key="s.id"
          type="button"
          class="cdp-row"
          @click="onSuggestion(s)"
        >
          <Icon name="bulb" class="cdp-row-ic" />
          <span class="cdp-row-tx">
            <span class="cdp-row-nm">
              {{ s.name }}
              <span v-if="s.kind === 'preset'" class="tag">
                {{ t('connectionsDiscover.badge.curated') }}
              </span>
            </span>
            <span class="cdp-row-why">{{ reasonText(s.reason) }}</span>
          </span>
        </button>
      </template>
    </section>

    <!-- Tìm kiếm registry -->
    <div class="cdp-bar">
      <Icon name="search" class="cdp-bar-ic" />
      <input
        v-model="query"
        type="text"
        class="cdp-input"
        :placeholder="t('connectionsDiscover.search')"
      />
      <button
        type="button"
        class="cdp-refresh"
        :title="t('connectionsDiscover.refresh')"
        :disabled="loading"
        @click="load(true)"
      >
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <p class="cdp-origin" :class="{ stale: result.stale }">{{ originText }}</p>

    <div class="cdp-list">
      <p v-if="loading" class="cdp-muted">{{ t('connectionsDiscover.loading') }}</p>
      <p v-else-if="!result.entries.length" class="cdp-muted">
        {{
          query.trim()
            ? t('connectionsDiscover.emptySearch', { query: query.trim() })
            : t('connectionsDiscover.empty')
        }}
      </p>
      <template v-else>
        <button
          v-for="e in result.entries"
          :key="e.id"
          type="button"
          class="cdp-row"
          @click="selected = e"
        >
          <Icon name="conn" class="cdp-row-ic" />
          <span class="cdp-row-tx">
            <span class="cdp-row-nm">
              {{ e.title }}
              <span class="tag" :class="e.install.kind === 'unsupported' ? 'warn' : ''">
                {{ badgeFor(e) }}
              </span>
            </span>
            <span class="cdp-row-sub">{{ e.description || e.name }}</span>
          </span>
          <Icon name="chev-right" class="cdp-row-go" />
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tab "Khám phá" của picker thêm connection (gói #38).
//
// Catalog tĩnh trong `preset-catalog.ts` là hằng số biên dịch — không cập nhật
// được nếu không release app. Panel này đọc danh sách ĐỘNG từ MCP Registry công
// khai qua `source.discoverRegistry` (sidecar lo SSRF + cache + validate), cộng
// một khu gợi ý theo project đang chọn (`source.suggestSources`).
//
// Panel KHÔNG tự cài gì. Bấm một entry mở màn hình chi tiết (đủ command/args/url)
// và chỉ từ đó mới `emit('pick')` — picker chuyển tiếp lên trang, trang gọi
// `source.discoverPreset` để lấy bản nháp và mở ConnectionEditor. Người dùng vẫn
// phải tự bấm Lưu, rồi tự bấm Test để probe.
import { computed, onMounted, ref, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import ConnectionDiscoverDetail from '~/components/connection/ConnectionDiscoverDetail.vue'
import { useI18n } from '~/composables/useI18n'
import {
  useConnectionsStore,
  type RegistryEntry,
  type RegistryResult,
  type SourceSuggestion,
  type SourceSuggestionReason,
} from '~/stores/connections'
import { useProjectsStore } from '~/stores/projects'

const emit = defineEmits<{ pick: [id: string] }>()

const { t } = useI18n()
const store = useConnectionsStore()
const projects = useProjectsStore()

const SEARCH_DEBOUNCE_MS = 350

const query = ref('')
const loading = ref(false)
const selected = ref<RegistryEntry | null>(null)
const result = ref<RegistryResult>({
  entries: [],
  origin: 'offline',
  fetchedAt: null,
  stale: false,
})
const suggestions = ref<SourceSuggestion[]>([])
const projectId = ref('')

const projectOptions = computed(() =>
  projects.projects.map((p) => ({ label: p.name, value: p.id })),
)

async function load(refresh = false): Promise<void> {
  loading.value = true
  try {
    result.value = await store.discoverRegistry({ query: query.value.trim(), refresh })
  } catch (err) {
    result.value = {
      entries: [],
      origin: 'offline',
      fetchedAt: null,
      stale: true,
      error: err instanceof Error ? err.message : 'registry unavailable',
    }
  } finally {
    loading.value = false
  }
}

async function loadSuggestions(): Promise<void> {
  const project = projects.projects.find((p) => p.id === projectId.value)
  if (!project) {
    suggestions.value = []
    return
  }
  try {
    suggestions.value = await store.suggestSources(project.path)
  } catch {
    // Gợi ý là phần thêm — hỏng thì im lặng bỏ, không chặn phần khám phá.
    suggestions.value = []
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS)
})

watch(projectId, () => void loadSuggestions())

onMounted(async () => {
  await projects.hydrate()
  projectId.value = projects.projects[0]?.id ?? ''
  await Promise.all([load(), loadSuggestions()])
})

function badgeFor(e: RegistryEntry): string {
  if (e.install.kind === 'remote') return t('connectionsDiscover.badge.remote')
  if (e.install.kind === 'stdio') return t('connectionsDiscover.badge.stdio')
  return t('connectionsDiscover.badge.unsupported')
}

// Lý do gợi ý luôn kèm bằng chứng cụ thể — người dùng phải hiểu vì sao thấy nó.
function reasonText(reason: SourceSuggestionReason): string {
  return t(`connectionsDiscover.reason.${reason.code}`, { evidence: reason.evidence })
}

// Gợi ý preset tĩnh đi thẳng vào editor (đã là catalog của AWOG, không cần soi
// lại); gợi ý từ registry phải qua màn hình chi tiết như mọi entry bên thứ ba.
function onSuggestion(s: SourceSuggestion): void {
  if (s.kind === 'preset') {
    emit('pick', s.id)
    return
  }
  const hit = result.value.entries.find((e) => e.id === s.id)
  if (hit) selected.value = hit
  else emit('pick', s.id)
}

const originText = computed(() => {
  const r = result.value
  if (r.stale && r.error) return t('connectionsDiscover.stale', { error: r.error })
  if (r.origin === 'offline') return t('connectionsDiscover.origin.offline')
  if (r.origin === 'cache') {
    return t('connectionsDiscover.origin.cache', {
      when: r.fetchedAt ? new Date(r.fetchedAt).toLocaleString() : '—',
    })
  }
  return t('connectionsDiscover.origin.network')
})
</script>

<style scoped>
.cdp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cdp-sug {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.cdp-sug-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.cdp-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textDim);
}
.cdp-muted {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.cdp-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cdp-bar-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--textDim);
}
.cdp-input {
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
.cdp-refresh {
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
.cdp-refresh:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.cdp-refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.cdp-origin {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textDim);
}
.cdp-origin.stale {
  color: var(--amber);
}
.cdp-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}
.cdp-row {
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
.cdp-row:hover {
  border-color: var(--accent);
  background: var(--bgHover);
}
.cdp-row-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--textDim);
}
.cdp-row-tx {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1 1 auto;
}
.cdp-row-nm {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.cdp-row-sub,
.cdp-row-why {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdp-row-why {
  color: var(--textMuted);
}
.cdp-row-go {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--textDim);
}
</style>
