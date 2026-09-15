<template>
  <!-- Chọn ĐIỂM VÀO của graph. Spec §"Giới hạn nói trước": account lớn không có nút
       "vẽ cả tài khoản" — luôn bắt đầu từ một điểm vào. Vì vậy đây là màn của trạng
       thái CHƯA có graph, và nó chịu trách nhiệm nói cách sửa khi chưa có gì để chọn. -->
  <div class="igr">
    <p v-if="loading" class="igr-state">{{ t('infra.graph.roots.loading') }}</p>

    <template v-else-if="error">
      <p class="igr-state err">{{ error }}</p>
      <button class="btn sm" type="button" @click="emit('retry')">
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.graph.roots.retry') }}
      </button>
    </template>

    <template v-else-if="!roots.length">
      <span class="igr-ico">
        <Icon name="branch" style="width: var(--icon-lg); height: var(--icon-lg)" />
      </span>
      <div class="igr-ttl">{{ t('infra.graph.roots.empty.title') }}</div>
      <p class="igr-body">{{ t('infra.graph.roots.empty.body') }}</p>
      <button class="btn sm" type="button" @click="emit('retry')">
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('infra.graph.roots.retry') }}
      </button>
    </template>

    <template v-else>
      <div class="igr-ttl">{{ t('infra.graph.roots.title') }}</div>
      <p class="igr-body">{{ t('infra.graph.roots.about') }}</p>
      <ul class="igr-list">
        <li v-for="root in roots" :key="root.id">
          <button
            class="igr-row"
            type="button"
            :title="t('infra.graph.roots.select')"
            @click="emit('select', root.id)"
          >
            <span class="igr-rowico">
              <Icon
                :name="graphServiceIcon(root.service)"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </span>
            <span class="igr-rowmain">
              <span class="igr-rowttl">{{ root.label }}</span>
              <span class="igr-rowsub">
                {{ root.service }}
                <template v-if="root.region">· {{ root.region }}</template>
              </span>
            </span>
            <Icon name="chev-right" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </li>
      </ul>
      <ul v-if="notes.length" class="igr-notes">
        <li v-for="(note, i) in notes" :key="i">{{ t(note) }}</li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { graphServiceIcon } from '~/composables/useInfraGraph'
import type { InfraGraphRoot } from '~/composables/useInfraGraphApi'

defineProps<{
  roots: InfraGraphRoot[]
  loading: boolean
  error: string
  /** Khoá i18n cho những điểm vào bị bỏ qua (hợp đồng §3). */
  notes: string[]
}>()

const emit = defineEmits<{ select: [id: string]; retry: [] }>()

const { t } = useI18n()
</script>

<style scoped>
.igr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(460px, 100%);
  max-height: 100%;
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
  box-shadow: var(--shadow-md);
  text-align: center;
}

.igr-state {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.igr-state.err {
  color: var(--red);
}

.igr-ico {
  width: 46px;
  height: 46px;
  border-radius: var(--r-card);
  background: var(--bgEl);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  color: var(--textDim);
}

.igr-ttl {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--text);
}

.igr-body {
  margin: 0;
  text-align: left;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.igr-list,
.igr-notes {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.igr-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.igr-row:hover {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}

.igr-rowico {
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}

.igr-rowmain {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.igr-rowttl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.igr-rowsub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.igr-notes {
  gap: 2px;
  text-align: left;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
</style>
