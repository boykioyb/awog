<template>
  <div :class="CAP_TAB">
    <div v-if="!decoded.length" :class="CAP_NOTE">{{ t('capture.jwt.none') }}</div>
    <section v-for="(j, i) in decoded" :key="i" :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">
        {{ sourceLabel(j.hit) }}
        <Badge v-if="j.jwt.expired" variant="destructive">{{ t('capture.jwt.expired') }}</Badge>
        <Badge v-if="isNone(j.jwt.header)" variant="destructive">
          {{ t('capture.jwt.algNone') }}
        </Badge>
        <span class="flex-auto" />
        <Button
          variant="ghost"
          size="iconSm"
          :class="copiedKey === `jwt-${i}` && 'text-success'"
          :title="labelFor(`jwt-${i}`, t('capture.headers.copy'))"
          :aria-label="labelFor(`jwt-${i}`, t('capture.headers.copy'))"
          @click="copy(`jwt-${i}`, j.hit.token)"
        >
          <Icon :name="iconFor(`jwt-${i}`)" />
        </Button>
      </h4>
      <pre :class="CAP_PRE">{{ j.hit.token }}</pre>
      <div class="mt-2 mb-0.5 text-dim">{{ t('capture.jwt.header') }}</div>
      <pre :class="CAP_PRE">{{ JSON.stringify(j.jwt.header, null, 2) }}</pre>
      <div class="mt-2 mb-0.5 text-dim">{{ t('capture.jwt.payload') }}</div>
      <pre :class="CAP_PRE">{{ JSON.stringify(j.jwt.payload, null, 2) }}</pre>
      <div class="mt-2 mb-0.5 text-dim">{{ t('capture.jwt.signature') }}</div>
      <pre :class="CAP_PRE">{{ j.jwt.signature || t('capture.jwt.noSignature') }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import { decodeJwt } from '~/utils/capture-export'
import { jwtsInEntry, type JwtHit } from '~/utils/capture-jwt-scan'
import { CAP_NOTE, CAP_PRE, CAP_SEC, CAP_SEC_TITLE, CAP_TAB } from './capture-ui'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()

const decoded = computed(() =>
  jwtsInEntry(props.entry).flatMap((hit) => {
    const jwt = decodeJwt(hit.token)
    return jwt ? [{ hit, jwt }] : []
  }),
)

const isNone = (header: unknown): boolean =>
  typeof header === 'object' &&
  header !== null &&
  String((header as { alg?: unknown }).alg ?? '').toLowerCase() === 'none'

const sourceLabel = (h: JwtHit): string =>
  h.name ? `${t(`capture.jwt.src.${h.source}`)} · ${h.name}` : t(`capture.jwt.src.${h.source}`)
</script>
