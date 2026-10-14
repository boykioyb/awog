<template>
  <div class="cap-tab">
    <div v-if="!entry.initiator" class="cap-note">{{ t('capture.initiator.none') }}</div>
    <template v-else>
      <section class="cap-sec">
        <table class="cap-kv">
          <tbody>
            <tr>
              <th>{{ t('capture.initiator.type') }}</th>
              <td>
                <Badge variant="outline">{{ entry.initiator.type }}</Badge>
              </td>
            </tr>
            <tr v-if="entry.initiator.url">
              <th>{{ t('capture.initiator.url') }}</th>
              <td class="cap-code cap-wrap">
                {{ entry.initiator.url }}
                <template v-if="entry.initiator.lineNumber !== undefined">
                  :{{ entry.initiator.lineNumber }}
                </template>
              </td>
            </tr>
            <tr v-if="entry.documentUrl">
              <th>{{ t('capture.initiator.document') }}</th>
              <td class="cap-code cap-wrap">{{ entry.documentUrl }}</td>
            </tr>
            <tr v-if="entry.frameId">
              <th>{{ t('capture.initiator.frame') }}</th>
              <td class="cap-code cap-wrap">{{ entry.frameId }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="entry.initiator.stack?.length" class="cap-sec">
        <h4>
          {{ t('capture.initiator.stack') }}
          <Button
            variant="ghost"
            size="iconSm"
            :class="copiedKey === 'stack' && 'text-success'"
            :title="labelFor('stack', t('capture.headers.copy'))"
            :aria-label="labelFor('stack', t('capture.headers.copy'))"
            @click="copy('stack', entry.initiator.stack.join('\n'))"
          >
            <Icon :name="iconFor('stack')" />
          </Button>
        </h4>
        <pre class="cap-pre cap-code">{{ entry.initiator.stack.join('\n') }}</pre>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CaptureEntry } from '~/types/network-capture'

defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()
</script>
