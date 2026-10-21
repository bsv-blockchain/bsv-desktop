import { describe, expect, it } from 'vitest'
import { liveStatus } from '../src/lib/pages/Dashboard/Payments/delivery'

describe('live payments card on the Receive tab', () => {
  const on = (via: string) => ({ tone: 'on', title: 'Open to live payments', body: `People can pay you directly while this app is open. Connected via ${via}.` })
  it.each([
    [{ status: 'online', via: 'relay', error: '', notice: '' }, on('relay')],
    [{ status: 'online', via: 'relay', relayUnreachable: false, error: '', notice: '' }, on('relay')],
    // The user chose the message box.
    [{ status: 'online', via: 'messagebox', relayUnreachable: false, error: '', notice: '' }, on('message box')],
    // The relay the settings choose cannot be reached: the message box carries signals meanwhile.
    [{ status: 'online', via: 'messagebox', relayUnreachable: true, error: '', notice: '' }, on('message box (relay unreachable)')],
    [{ status: 'starting', via: 'messagebox', error: '', notice: '' }, { tone: 'starting', title: 'Connecting…', body: 'Getting ready to take live payments.' }],
    [{ status: 'off', via: 'messagebox', error: '', notice: '' }, { tone: 'off', title: 'Live payments are off', body: 'Turn them on in Settings so people can pay you directly while this app is open.' }],
    // No message box to signal through: off, and the notice says why.
    [{ status: 'off', via: null, error: '', notice: 'Connect a message box in Settings.' }, { tone: 'off', title: 'Live payments are off', body: 'Connect a message box in Settings.' }],
    [{ status: 'error', via: 'relay', error: 'The relay server cannot be reached. Trying again…', notice: '' }, { tone: 'error', title: "Live payments aren't working right now", body: 'The relay server cannot be reached. Trying again…' }],
    [{ status: 'error', via: null, error: '', notice: '' }, { tone: 'error', title: "Live payments aren't working right now", body: 'Live payments cannot be received right now.' }]
  ] as const)('%o', (snapshot, expected) => {
    expect(liveStatus(snapshot)).toEqual(expected)
  })
})
