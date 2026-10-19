/**
 * The Direct payments card in Advanced settings: the form behind it, the status chip,
 * and how it is wired into the page. The repo has no DOM test environment, so the
 * component's logic lives in form.ts / status.ts and the wiring is checked in source.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  DEFAULT_DIRECT_PAY_SETTINGS,
  DIRECT_PAY_SETTINGS_KEY,
  loadDirectPaySettings,
  saveDirectPaySettings
} from '../src/lib/utils/directPaySettings'
import { followStoredSettings, formFromSettings, relayUrlError, saveDirectPayForm, settingsFromForm, showsTurn } from '../src/lib/components/DirectPayConfig/form'
import { DIRECT_PAY_STATE_COLOR, directPayState } from '../src/lib/components/DirectPayConfig/status'

let local: Map<string, string>

beforeEach(() => {
  local = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v) },
    removeItem: (k: string) => { local.delete(k) }
  })
  vi.stubGlobal('window', new EventTarget())
})

const stored = {
  receiveEnabled: false,
  signaling: 'relay' as const,
  relayUrl: 'wss://relay.example.com',
  stunUrls: ['stun:stun.example.com:3478'],
  turn: { urls: 'turn:turn.example.com:3478', username: '1700000000:tester', credential: 'secret' }
}

describe('direct-pay settings form', () => {
  it('shows the defaults with the STUN servers comma-separated and no TURN server', () => {
    expect(formFromSettings(DEFAULT_DIRECT_PAY_SETTINGS)).toEqual({
      receiveEnabled: true,
      signaling: 'messagebox',
      relayUrl: '',
      stunUrls:
        'stun:stun-us-1.bsvb.tech:3478, stun:stun.l.google.com:19302, stun:stun.cloudflare.com:3478',
      turnUrls: '',
      turnUsername: '',
      turnCredential: ''
    })
  })

  it('shows a stored relay and TURN server', () => {
    expect(formFromSettings(stored)).toEqual({
      receiveEnabled: false,
      signaling: 'relay',
      relayUrl: 'wss://relay.example.com',
      stunUrls: 'stun:stun.example.com:3478',
      turnUrls: 'turn:turn.example.com:3478',
      turnUsername: '1700000000:tester',
      turnCredential: 'secret'
    })
  })

  it('turns every form field into a setting, splitting STUN servers on commas', () => {
    const settings = settingsFromForm({
      ...formFromSettings(stored),
      receiveEnabled: true,
      stunUrls: ' stun:a.example:3478 ,stun:b.example:3478,, '
    })
    expect(Object.keys(settings).sort()).toEqual(['receiveEnabled', 'relayUrl', 'signaling', 'stunUrls', 'turn'])
    expect(settings.receiveEnabled).toBe(true)
    expect(settings.signaling).toBe('relay')
    expect(settings.relayUrl).toBe('wss://relay.example.com')
    expect(settings.stunUrls.map(url => url.trim()).filter(Boolean)).toEqual(['stun:a.example:3478', 'stun:b.example:3478'])
    expect(settings.turn).toEqual(stored.turn)
  })
})

describe('saving the direct-pay form', () => {
  it('keeps the relay and TURN server when only receiving is turned on (Ruling 14), then applies what was stored', async () => {
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify(stored))
    const apply = vi.fn(async () => {})
    const form = { ...formFromSettings(loadDirectPaySettings()), receiveEnabled: true }

    const saved = await saveDirectPayForm(form, apply)

    expect(saved).toEqual({ ...stored, receiveEnabled: true })
    expect(loadDirectPaySettings()).toEqual(saved)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(saved)
  })

  it('stores the cleaned-up values the form shows next', async () => {
    const apply = vi.fn(async () => {})
    const saved = await saveDirectPayForm({
      ...formFromSettings(DEFAULT_DIRECT_PAY_SETTINGS),
      stunUrls: ' stun:a.example:3478 ,, stun:b.example:3478 ',
      relayUrl: '  wss://relay.example.com  '
    }, apply)
    expect(saved.stunUrls).toEqual(['stun:a.example:3478', 'stun:b.example:3478'])
    expect(saved.relayUrl).toBe('wss://relay.example.com')
    expect(formFromSettings(saved).stunUrls).toBe('stun:a.example:3478, stun:b.example:3478')
  })

  it('removes the TURN server when its fields are cleared', async () => {
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify(stored))
    const form = { ...formFromSettings(loadDirectPaySettings()), turnUrls: '', turnUsername: ' ', turnCredential: '' }
    const saved = await saveDirectPayForm(form, async () => {})
    expect(saved.turn).toBeUndefined()
    expect(loadDirectPaySettings().turn).toBeUndefined()
    expect(loadDirectPaySettings().relayUrl).toBe('wss://relay.example.com')
  })

  it('accepts no STUN servers at all', async () => {
    const saved = await saveDirectPayForm({ ...formFromSettings(DEFAULT_DIRECT_PAY_SETTINGS), stunUrls: '  ' }, async () => {})
    expect(saved.stunUrls).toEqual([])
  })

  it.each([
    ['relay signaling without a relay URL', { relayUrl: '  ' }, /Enter the relay server address/],
    ['a relay URL that is not wss://', { relayUrl: 'http://relay.example.com' }, /wss:\/\//],
    ['a STUN server that is not stun:', { stunUrls: 'stun:ok.example:3478, https://bad.example' }, /stun: or stuns:/],
    ['a TURN server without a credential', { turnUrls: 'turn:t.example:3478', turnUsername: 'u', turnCredential: '' }, /username and a credential/]
  ])('stores and applies nothing for %s', async (_name, change, message) => {
    local.set(DIRECT_PAY_SETTINGS_KEY, JSON.stringify(stored))
    const apply = vi.fn(async () => {})
    await expect(saveDirectPayForm({ ...formFromSettings(stored), receiveEnabled: true, ...change }, apply)).rejects.toThrow(message)
    expect(apply).not.toHaveBeenCalled()
    expect(JSON.parse(local.get(DIRECT_PAY_SETTINGS_KEY)!)).toEqual(stored)
  })
})

describe('relay URL field errors', () => {
  it('shows a refused relay URL under the field, and nothing else there', async () => {
    const empty = await saveDirectPayForm({ ...formFromSettings(stored), relayUrl: '' }, async () => {}).catch(e => e)
    expect(relayUrlError(empty)).toBe('Enter the relay server address, or choose the message box for signaling.')
    const insecure = await saveDirectPayForm({ ...formFromSettings(stored), relayUrl: 'ws://relay.example.com' }, async () => {}).catch(e => e)
    expect(relayUrlError(insecure)).toMatch(/wss:\/\//)
    const stun = await saveDirectPayForm({ ...formFromSettings(stored), stunUrls: 'https://bad.example' }, async () => {}).catch(e => e)
    expect(relayUrlError(stun)).toBe('')
    expect(relayUrlError(new Error('Direct payment settings could not be saved on this device.'))).toBe('')
  })
})

describe('the TURN section', () => {
  it('is open when the settings have a TURN server', () => {
    expect(showsTurn(formFromSettings(stored))).toBe(true)
    expect(showsTurn(formFromSettings(DEFAULT_DIRECT_PAY_SETTINGS))).toBe(false)
  })
})

describe('reloading the form when the settings are saved elsewhere', () => {
  it('hands the form the stored settings after every save, until it stops following', () => {
    const setForm = vi.fn()
    const stop = followStoredSettings(setForm)

    const saved = saveDirectPaySettings(stored)
    expect(setForm).toHaveBeenCalledOnce()
    expect(setForm).toHaveBeenCalledWith(formFromSettings(saved))

    stop()
    saveDirectPaySettings({ ...stored, receiveEnabled: true })
    expect(setForm).toHaveBeenCalledOnce()
  })
})

describe('direct-pay status chip', () => {
  it.each([
    [{ status: 'off', via: 'messagebox', notice: '' }, 'off', 'default'],
    [{ status: 'off', via: null, notice: '' }, 'off', 'default'],
    // No message box to signal through: a gap in the setup, explained by the notice, not a failure.
    [{ status: 'off', via: null, notice: 'Connect a message box in Settings.' }, 'not_set_up', 'default'],
    [{ status: 'starting', via: 'relay', notice: '' }, 'starting', 'info'],
    [{ status: 'online', via: 'messagebox', notice: '' }, 'online_messagebox', 'success'],
    [{ status: 'online', via: 'relay', notice: '' }, 'online_relay', 'success'],
    // Real errors: relay signaling without an address (Ruling 14), or receiving failed (the relay is down).
    [{ status: 'error', via: null, notice: '' }, 'failed', 'error'],
    [{ status: 'error', via: 'relay', notice: '' }, 'failed', 'error'],
    [{ status: 'error', via: 'messagebox', notice: '' }, 'failed', 'error']
  ] as const)('%o shows as %s', (snapshot, state, color) => {
    expect(directPayState(snapshot)).toBe(state)
    expect(DIRECT_PAY_STATE_COLOR[directPayState(snapshot)]).toBe(color)
  })
})

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')

describe('Direct payments card wiring', () => {
  let settingsPage: string
  let card: string
  beforeAll(() => {
    settingsPage = read('src/lib/pages/Dashboard/Settings/AdvancedSettings.tsx')
    card = read('src/lib/components/DirectPayConfig/index.tsx')
  })

  it('sits right below the message box card in Advanced settings', () => {
    expect(settingsPage).toMatch(/import DirectPayConfig from '\.\.\/\.\.\/\.\.\/components\/DirectPayConfig\/index\.tsx'/)
    expect(settingsPage).toMatch(/<MessageBoxConfig \/>\s*<\/Box>\s*<Box sx=\{\{ my: 3 \}\}>\s*<DirectPayConfig \/>\s*<\/Box>/)
  })

  it('starts from the stored settings and saves the whole form, then applies it, while holding a wallet operation', () => {
    expect(card).toMatch(/formFromSettings\(loadDirectPaySettings\(\)\)/)
    // Settings saved anywhere else show in the form too, with the TURN section opened when they have a TURN server.
    expect(card).toMatch(/const \[showTurn, setShowTurn\] = useState\(\(\) => showsTurn\(form\)\)/)
    expect(card).toMatch(/useEffect\(\(\) => followStoredSettings\(next => \{ setForm\(next\); if \(showsTurn\(next\)\) setShowTurn\(true\) \}\), \[\]\)/)
    expect(card).toMatch(/saveDirectPayForm\(form, applyDirectPaySettings\)/)
    expect(card).toMatch(/release = beginUserWalletOperation\(\)/)
    expect(card).not.toMatch(/saveDirectPaySettings\(/)
  })

  it('shows the IP-disclosure warning with the receive switch, and the status from the snapshot', () => {
    expect(card).toMatch(/t\('directpay_receive_label'\)/)
    expect(card).toMatch(/t\('directpay_receive_warning'\)/)
    expect(card).toMatch(/directPayState\(directPay\)/)
    // A failure is an error; a setup gap is information.
    expect(card).toMatch(/\{directPay\.error && \(\s*<Alert severity="error"[^>]*>\s*\{directPay\.error\}/)
    expect(card).toMatch(/\{directPay\.notice && \(\s*<Alert severity="info"[^>]*>\s*\{directPay\.notice\}/)
  })

  it('refuses to save a relay URL it cannot use, saying why under the field instead of reporting it saved', () => {
    const save = card.slice(card.indexOf('const handleSave'), card.indexOf('const content'))
    expect(save).toMatch(/const problem = relayUrlError\(error\)\s*if \(problem\) \{ setRelayUrlFieldError\(problem\); return \}\s*throw error/)
    expect(save.indexOf('return }')).toBeLessThan(save.indexOf("toast.success(t('directpay_saved'))"))
    expect(card).toMatch(/error=\{!!relayUrlFieldError\}\s*helperText=\{relayUrlFieldError \|\| t\('directpay_relay_url_helper'\)\}/)
    // Editing the address or the signaling clears it.
    expect(card).toMatch(/if \(key === 'relayUrl' \|\| key === 'signaling'\) setRelayUrlFieldError\(''\)/)
  })

  it('offers both signaling choices and the relay, STUN and TURN fields', () => {
    for (const key of ['directpay_signaling_messagebox', 'directpay_signaling_relay', 'directpay_relay_url_label', 'directpay_stun_label', 'directpay_turn_url_label', 'directpay_turn_username_label', 'directpay_turn_credential_label', 'directpay_save']) {
      expect(card).toContain(`t('${key}')`)
    }
  })
})

describe('receive warning text (audit F14)', () => {
  let translations: string
  beforeAll(() => { translations = read('src/lib/i18n/translations.ts') })

  it('says what anyone who knows the identity key learns while receiving is on, without paying', () => {
    const en = translations.slice(translations.indexOf('const en = {'), translations.indexOf('const es = {'))
    const line = en.match(/^ {4}directpay_receive_warning: '((?:[^'\\]|\\.)*)',$/m)
    expect(line).not.toBeNull()
    const text = line![1]
    expect(text).toMatch(/while this is on/i)
    expect(text).toMatch(/any wallet that knows your identity key/)
    expect(text).toMatch(/public IP address/)
    expect(text).toMatch(/when your wallet is unlocked/)
    expect(text).toMatch(/starting a connection/)
    expect(text).toMatch(/without paying you/)
    // Final review M29: the setting is one per device, so it answers for every profile.
    expect(text).toMatch(/applies to every wallet profile on this device/)
  })

  it('exists, translated, in every language', () => {
    const lines = [...translations.matchAll(/^ {4}directpay_receive_warning: '((?:[^'\\]|\\.)*)',$/gm)].map(m => m[1])
    expect(lines).toHaveLength(12)
    expect(new Set(lines).size).toBe(12)
  })
})

describe('card description (C5 review)', () => {
  let translations: string
  beforeAll(() => { translations = read('src/lib/i18n/translations.ts') })
  const descriptions = () => [...translations.matchAll(/^ {4}directpay_description: '((?:[^'\\]|\\.)*)',$/gm)].map(m => m[1])

  it('says the payment goes between the wallets and the carrier only relays encrypted connection details', () => {
    const en = translations.slice(translations.indexOf('const en = {'), translations.indexOf('const es = {'))
    const text = en.match(/^ {4}directpay_description: '((?:[^'\\]|\\.)*)',$/m)![1]
    expect(text).toMatch(/directly between/)
    expect(text).toMatch(/message box or relay server only (carries|passes on) the encrypted connection details/)
    expect(text).toMatch(/until they are read/)
    expect(text).not.toMatch(/stored on a server|Nothing is stored/i)
  })

  // Final review M14/M26 (spec §12): a TURN server may carry the encrypted connection, and the
  // carriers see who connects, their addresses and when, but never the payment.
  it('says a TURN server may relay the encrypted connection, and what the servers see, in every language', () => {
    const en = translations.slice(translations.indexOf('const en = {'), translations.indexOf('const es = {'))
    const text = en.match(/^ {4}directpay_description: '((?:[^'\\]|\\.)*)',$/m)![1]
    expect(text).toMatch(/usually goes directly between the wallets/)
    expect(text).toMatch(/If the wallets cannot connect directly, a TURN server may relay the encrypted connection\./)
    expect(text).toMatch(/message box, relay and TURN servers can see which wallets connect, their IP addresses and when, but never the payment/)
    expect(text).toMatch(/STUN servers see this device\\'s IP address when it connects/)
    for (const line of descriptions()) {
      expect(line).toMatch(/TURN/)
      expect(line).toMatch(/STUN/)
    }
  })

  it('no longer claims, in any language, that nothing is stored on a server', () => {
    const claims = [
      'Nothing is stored on a server', 'Nada se guarda en un servidor', 'Rien n\\\'est stocké sur un serveur',
      'Nada é armazenado em um servidor', '服务器上不会存储任何内容', 'सर्वर पर कुछ भी संग्रहीत नहीं होता',
      'কোনো সার্ভারে কিছুই সংরক্ষিত হয় না', 'لا يُخزَّن أي شيء على خادم', 'На сервере ничего не хранится',
      'Tidak ada yang disimpan di server', 'サーバーには何も保存されません', 'Nic nie jest przechowywane na serwerze'
    ]
    const lines = descriptions()
    expect(lines).toHaveLength(12)
    expect(new Set(lines).size).toBe(12)
    for (const claim of claims) expect(lines.filter(line => line.includes(claim))).toEqual([])
  })
})
