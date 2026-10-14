<template>
  <div class="cap-tab">
    <div v-if="!decoded.length" class="cap-note">{{ t('capture.jwt.none') }}</div>
    <section v-for="(j, i) in decoded" :key="i" class="cap-sec">
      <h4>
        {{ sourceLabel(j.hit) }}
        <Badge v-if="j.jwt.expired" variant="destructive">{{ t('capture.jwt.expired') }}</Badge>
        <Badge v-if="isNone(j.jwt.header)" variant="destructive">
          {{ t('capture.jwt.algNone') }}
        </Badge>
        <span class="cap-grow" />
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
      <pre class="cap-pre cap-code cap-wrap">{{ j.hit.token }}</pre>
      <div class="cap-sub">{{ t('capture.jwt.header') }}</div>
      <pre class="cap-pre cap-code">{{ JSON.stringify(j.jwt.header, null, 2) }}</pre>
      <div class="cap-sub">{{ t('capture.jwt.payload') }}</div>
      <pre class="cap-pre cap-code">{{ JSON.stringify(j.jwt.payload, null, 2) }}</pre>
      <div class="cap-sub">{{ t('capture.jwt.signature') }}</div>
      <pre class="cap-pre cap-code cap-wrap">{{
        j.jwt.signature || t('capture.jwt.noSignature')
      }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import { decodeJwt } from '~/utils/capture-export'
import { jwtsInEntry, type JwtHit } from '~/utils/capture-jwt-scan'

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
