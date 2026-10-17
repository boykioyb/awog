// Schema zod cho payload Slack Web API mà tính năng dùng tới.
//
// Payload từ mạng là L1 ⇒ parse trước khi đọc. Cố ý LỎNG: mọi field optional +
// `passthrough`, vì Slack thêm/bớt field theo loại tin (bot, tin hệ thống, file
// đã xoá…) và một field lạ không được làm hỏng cả thread. Field nào UI cần mà
// vắng thì nơi map tự điền mặc định.
import { z } from 'zod'

const optStr = z.string().optional()
const optNum = z.number().optional()

export const RawFileSchema = z
  .object({
    id: z.string(),
    name: optStr,
    title: optStr,
    mimetype: optStr,
    filetype: optStr,
    size: optNum,
    mode: optStr,
    file_access: optStr,
    is_external: z.boolean().optional(),
    external_url: optStr,
    permalink: optStr,
    url_private: optStr,
    url_private_download: optStr,
    thumb_360: optStr,
    thumb_360_w: optNum,
    thumb_360_h: optNum,
    thumb_720: optStr,
    thumb_720_w: optNum,
    thumb_720_h: optNum,
    thumb_video: optStr,
    thumb_video_w: optNum,
    thumb_video_h: optNum,
    preview: optStr,
    plain_text: optStr,
  })
  .passthrough()
export type RawFile = z.infer<typeof RawFileSchema>

const RawReactionSchema = z
  .object({ name: z.string(), count: optNum, users: z.array(z.string()).optional() })
  .passthrough()

const RawAttachmentSchema = z
  .object({
    title: optStr,
    text: optStr,
    fallback: optStr,
    title_link: optStr,
    from_url: optStr,
    original_url: optStr,
    service_name: optStr,
    image_url: optStr,
    thumb_url: optStr,
  })
  .passthrough()

export const RawMessageSchema = z
  .object({
    ts: z.string(),
    user: optStr,
    username: optStr,
    bot_id: optStr,
    bot_profile: z.object({ name: optStr }).passthrough().optional(),
    text: optStr,
    thread_ts: optStr,
    reply_count: optNum,
    latest_reply: optStr,
    subtype: optStr,
    edited: z.object({ ts: optStr }).passthrough().optional(),
    reactions: z.array(RawReactionSchema).optional(),
    files: z.array(RawFileSchema).optional(),
    attachments: z.array(RawAttachmentSchema).optional(),
  })
  .passthrough()
export type RawMessage = z.infer<typeof RawMessageSchema>

export const RepliesSchema = z
  .object({
    messages: z.array(RawMessageSchema).default([]),
    has_more: z.boolean().optional(),
    response_metadata: z.object({ next_cursor: optStr }).passthrough().optional(),
  })
  .passthrough()

export const RawUserSchema = z
  .object({
    id: z.string(),
    name: optStr,
    real_name: optStr,
    deleted: z.boolean().optional(),
    is_bot: z.boolean().optional(),
    profile: z
      .object({
        display_name: optStr,
        real_name: optStr,
        image_72: optStr,
        image_48: optStr,
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type RawUser = z.infer<typeof RawUserSchema>

export const ConversationInfoSchema = z
  .object({
    channel: z
      .object({
        id: z.string(),
        name: optStr,
        is_im: z.boolean().optional(),
        user: optStr,
      })
      .passthrough(),
  })
  .passthrough()

export function nextCursorOf(data: { response_metadata?: { next_cursor?: string | undefined } | undefined }): string | null {
  const c = data.response_metadata?.next_cursor
  return c && c.length > 0 ? c : null
}
