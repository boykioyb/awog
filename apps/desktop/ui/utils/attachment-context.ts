import type { InjectionKey } from 'vue'
import type { SessionAttachment } from '~/types'

// Open a session attachment in the full-screen lightbox. Provided by SessionChat
// (which owns the lightbox state) and consumed by descendants like the Info
// workspace tab. Null in non-session contexts so callers gracefully no-op.
export const OPEN_ATTACHMENT_KEY: InjectionKey<(attachment: SessionAttachment) => void> =
  Symbol('openAttachment')
