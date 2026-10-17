import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitMock = vi.fn()
const threads: Array<{ id: string; sessionId: string | null }> = []

vi.mock('../../../transport/stdio.js', () => ({ emit: (...a: unknown[]) => emitMock(...a) }))
vi.mock('../../../slack/store.js', () => ({ listThreads: async () => threads }))

const { runSlackDraftReply, MAX_DRAFT_LEN } = await import('../slack-tools.js')
const { bridgedNameOf } = await import('../bridged.js')

describe('slack_draft_reply', () => {
  beforeEach(() => {
    emitMock.mockReset()
    threads.length = 0
  })

  it('refuses when the session has no linked thread and emits nothing', async () => {
    threads.push({ id: 'T0000TEAM:C0000CHAN:1760000000.000100', sessionId: 'ses-other' })
    const r = await runSlackDraftReply('ses-a', 'hello')
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/not linked to a Slack thread/)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('emits slack.draft for the thread linked to THIS session only', async () => {
    threads.push({ id: 'T0000TEAM:C0000CHAN:1760000000.000100', sessionId: 'ses-a' })
    const r = await runSlackDraftReply('ses-a', '  Thanks, will check.  ')
    expect(r.isError).toBe(false)
    expect(r.text).toBe('Draft placed in the Slack composer; the user will review and send it.')
    expect(emitMock).toHaveBeenCalledWith('slack.draft', {
      threadId: 'T0000TEAM:C0000CHAN:1760000000.000100',
      text: 'Thanks, will check.',
    })
  })

  it('neutralizes broadcast pings and labelled links before emitting', async () => {
    threads.push({ id: 'T0000TEAM:C0000CHAN:1760000000.000100', sessionId: 'ses-a' })
    const r = await runSlackDraftReply(
      'ses-a',
      '<!channel> hi <@U0123ABCD>, see <https://evil.example|the doc> <!subteam^S01|@devs>',
    )
    expect(r.isError).toBe(false)
    expect(emitMock).toHaveBeenCalledWith('slack.draft', {
      threadId: 'T0000TEAM:C0000CHAN:1760000000.000100',
      text: '@channel hi <@U0123ABCD>, see the doc (https://evil.example) @devs',
    })
  })

  it('rejects empty and oversized drafts', async () => {
    threads.push({ id: 'T0000TEAM:C0000CHAN:1760000000.000100', sessionId: 'ses-a' })
    expect((await runSlackDraftReply('ses-a', '   ')).isError).toBe(true)
    expect((await runSlackDraftReply('ses-a', 'x'.repeat(MAX_DRAFT_LEN + 1))).isError).toBe(true)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('is bridged under the awogslack server on the Claude SDK path', () => {
    expect(bridgedNameOf('slack_draft_reply')).toBe('mcp__awogslack__slack_draft_reply')
  })
})
