<template>
  <div class="cap-tab">
    <section class="cap-sec">
      <h4>{{ t('capture.cookies.sent', { n: sent.length }) }}</h4>
      <table v-if="sent.length" class="cap-kv">
        <thead>
          <tr>
            <th>{{ t('capture.cookies.name') }}</th>
            <th>{{ t('capture.cookies.value') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in sent" :key="i">
            <th class="cap-code">{{ c.name }}</th>
            <td class="cap-code cap-wrap">{{ c.value }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="cap-note">{{ t('capture.cookies.noneSent') }}</div>
    </section>

    <section class="cap-sec">
      <h4>{{ t('capture.cookies.received', { n: received.length }) }}</h4>
      <div v-if="received.length" class="cap-scroll-x">
        <table class="cap-kv cap-cookies">
          <thead>
            <tr>
              <th>{{ t('capture.cookies.name') }}</th>
              <th>{{ t('capture.cookies.value') }}</th>
              <th>Domain</th>
              <th>Path</th>
              <th>Expires / Max-Age</th>
              <th>HttpOnly</th>
              <th>Secure</th>
              <th>SameSite</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in received" :key="i">
              <th class="cap-code">{{ c.name }}</th>
              <td class="cap-code cap-wrap">{{ c.value }}</td>
              <td class="cap-code">{{ c.domain }}</td>
              <td class="cap-code">{{ c.path }}</td>
              <td>{{ c.expires }}</td>
              <td>
                <Badge :variant="c.httpOnly ? 'success' : 'destructive'">
                  {{ c.httpOnly ? '✓' : t('capture.cookies.missing') }}
                </Badge>
              </td>
              <td>
                <Badge :variant="c.secure ? 'success' : 'destructive'">
                  {{ c.secure ? '✓' : t('capture.cookies.missing') }}
                </Badge>
              </td>
              <td>
                <Badge :variant="sameSiteVariant(c)">
                  {{ c.sameSite || t('capture.cookies.missing') }}
                </Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="cap-note">{{ t('capture.cookies.noneReceived') }}</div>
    </section>

    <section v-if="entry.blockedCookies?.length" class="cap-sec">
      <h4>{{ t('capture.cookies.blocked', { n: entry.blockedCookies.length }) }}</h4>
      <table class="cap-kv">
        <tbody>
          <tr v-for="(b, i) in entry.blockedCookies" :key="i">
            <th class="cap-code">{{ b.name || '—' }}</th>
            <td class="cap-wrap">
              <Badge v-for="r in b.reasons" :key="r" variant="destructive" class="mr-1">
                {{ r }}
              </Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import { parseCookieHeader, parseSetCookie } from '~/utils/capture-export'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

type ReceivedCookie = { sameSite: string; sameSiteNone: boolean; secure: boolean }

// Thiếu SameSite = cảnh báo (trình duyệt mặc định Lax); SameSite=None mà không Secure = bị từ chối.
const sameSiteVariant = (c: ReceivedCookie): 'success' | 'warning' | 'destructive' =>
  !c.sameSite ? 'warning' : c.sameSiteNone && !c.secure ? 'destructive' : 'success'

const sent = computed(() =>
  props.entry.requestHeaders
    .filter(([k]) => k.toLowerCase() === 'cookie')
    .flatMap(([, v]) => parseCookieHeader(v)),
)

const received = computed(() =>
  props.entry.responseHeaders
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => {
      const c = parseSetCookie(v)
      const attrs: Record<string, string | true> = {}
      for (const [k, val] of Object.entries(c.attrs)) attrs[k.toLowerCase()] = val
      const str = (k: string): string => {
        const val = attrs[k]
        return typeof val === 'string' ? val : ''
      }
      const sameSite = str('samesite')
      return {
        name: c.name,
        value: c.value,
        domain: str('domain'),
        path: str('path'),
        expires: str('expires') || (str('max-age') ? `max-age=${str('max-age')}` : ''),
        httpOnly: attrs.httponly !== undefined,
        secure: attrs.secure !== undefined,
        sameSite,
        sameSiteNone: sameSite.toLowerCase() === 'none',
      }
    }),
)
</script>
