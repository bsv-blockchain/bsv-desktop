import { describe, expect, it, vi } from 'vitest'
import { NotSentError } from '../src/lib/pages/Dashboard/Payments/directPayments'
import type { DialFailure } from '../src/lib/pages/Dashboard/Payments/directPayments'
import { fallbackPrompt, payIdentity } from '../src/lib/pages/Dashboard/Payments/payFlow'

const dialFails = (failure?: DialFailure, message = 'The recipient could not be reached. Nothing was spent.') => vi.fn(async (): Promise<{ ackStatus: string }> => { throw new NotSentError(message, '', failure) })

describe('payIdentity', () => {
  it('pays live when the direct attempt succeeds, without touching the message box', async () => {
    const messageBox = vi.fn(async () => {})
    await expect(payIdentity({ direct: async () => ({ ackStatus: 'accepted' }), messageBox })).resolves.toEqual({ kind: 'paid_live', ackStatus: 'accepted' })
    expect(messageBox).not.toHaveBeenCalled()
  })

  it('asks before falling back when the recipient is offline', async () => {
    const messageBox = vi.fn(async () => {})
    await expect(payIdentity({ direct: dialFails('offline'), messageBox })).resolves.toEqual({ kind: 'ask_fallback', reason: 'offline' })
    expect(messageBox).not.toHaveBeenCalled()
  })

  it('treats a wallet that is not receiving as offline', async () => {
    await expect(payIdentity({ direct: dialFails('not_receiving'), messageBox: async () => {} })).resolves.toEqual({ kind: 'ask_fallback', reason: 'offline' })
  })

  it('asks before falling back when the link failed', async () => {
    await expect(payIdentity({ direct: dialFails('link_failed'), messageBox: async () => {} })).resolves.toEqual({ kind: 'ask_fallback', reason: 'link_failed' })
  })

  it('asks before falling back when the new payment is over the 1 MB live limit (released, nothing spent)', async () => {
    await expect(payIdentity({ direct: dialFails('too_large'), messageBox: async () => {} })).resolves.toEqual({ kind: 'ask_fallback', reason: 'too_large' })
    await expect(payIdentity({ direct: dialFails('too_large', 'Too large. Nothing was spent.') })).resolves.toEqual({ kind: 'failed', message: 'Too large. Nothing was spent.' })
  })

  it('fails with the network copy when the signal could not be posted, offering no fallback', async () => {
    const messageBox = vi.fn(async () => {})
    await expect(payIdentity({ direct: dialFails('network'), messageBox })).resolves.toEqual({ kind: 'failed', message: "Couldn't reach the payment network — check your connection." })
    expect(messageBox).not.toHaveBeenCalled()
  })

  it('runs the message box at once when there is no direct attempt', async () => {
    const messageBox = vi.fn(async () => {})
    await expect(payIdentity({ messageBox })).resolves.toEqual({ kind: 'paid_messagebox' })
    expect(messageBox).toHaveBeenCalledTimes(1)
  })

  it('fails, offering nothing, when the recipient is offline and there is no message box', async () => {
    const outcome = await payIdentity({ direct: dialFails('offline'), name: 'Alice' })
    expect(outcome).toEqual({ kind: 'failed', message: "Alice isn't online right now. Nothing was spent. Connect a message box in Settings to pay people who are offline." })
  })

  it('never offers the fallback once the payment was made (one payment, one transaction)', async () => {
    const messageBox = vi.fn(async () => {})
    const direct = vi.fn(async (): Promise<{ ackStatus: string }> => { throw new Error("The recipient's wallet did not confirm the payment before the connection ended.") })
    await expect(payIdentity({ direct, messageBox })).resolves.toEqual({ kind: 'failed', message: "The recipient's wallet did not confirm the payment before the connection ended." })
    expect(messageBox).not.toHaveBeenCalled()
  })

  it('fails with the reason for a wrong network or an unclassified refusal', async () => {
    await expect(payIdentity({ direct: dialFails('wrong_network', "The recipient's wallet is on a different network. Nothing was spent."), messageBox: async () => {} }))
      .resolves.toEqual({ kind: 'failed', message: "The recipient's wallet is on a different network. Nothing was spent." })
    await expect(payIdentity({ direct: dialFails(undefined, 'This payment is too large to deliver directly. Nothing was spent.'), messageBox: async () => {} }))
      .resolves.toEqual({ kind: 'failed', message: 'This payment is too large to deliver directly. Nothing was spent.' })
  })

  it('reports a message box failure, and asks for a message box when there is neither route', async () => {
    await expect(payIdentity({ messageBox: async () => { throw new Error('host down') } })).resolves.toEqual({ kind: 'failed', message: 'host down' })
    await expect(payIdentity({})).resolves.toEqual({ kind: 'failed', message: 'Connect your message box in Settings to pay a wallet identity. Address payments are available.' })
  })
})

describe('fallbackPrompt', () => {
  it('words the offline and link failure prompts', () => {
    expect(fallbackPrompt('offline', 'Alice')).toBe("Alice isn't online right now. Send it to their message box? They'll get it next time they open their wallet.")
    expect(fallbackPrompt('link_failed', 'Alice')).toBe("Couldn't connect to Alice directly. Send it to their message box instead?")
    expect(fallbackPrompt('too_large', 'Alice')).toBe("This payment is too large to send live (over 1 MB). Send it to Alice's message box instead? Nothing has been spent yet.")
  })
})
