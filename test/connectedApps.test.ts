import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Utils } from '@bsv/sdk'
import { getRecentApps, subscribeRecentApps, updateRecentApp } from '../src/lib/pages/Dashboard/Apps/getApps'
import isImageUrl from '../src/lib/utils/isImageUrl'

vi.mock('../src/lib/utils/isImageUrl', () => ({ default: vi.fn(async () => false) }))
vi.mock('../src/lib/utils/parseAppManifest', () => ({ default: vi.fn(async () => undefined) }))

const key = Utils.toBase64([1, 2, 3])
let storage: Map<string, string>
let windowEvents: EventTarget
const apps = [{ name: 'Example', domain: 'example.com', timestamp: 12 }]
beforeEach(() => {
  storage = new Map()
  windowEvents = Object.assign(new EventTarget(), { localStorage: {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => { storage.set(name, value) },
  } })
  vi.stubGlobal('window', windowEvents)
  vi.mocked(isImageUrl).mockResolvedValue(false)
})

describe('connected app profile subscriptions', () => {
  it('loads the existing profile-specific app history used by RequestInterceptorWallet', () => {
    storage.set(`brc100_recent_apps_${key}`, JSON.stringify({ apps }))
    storage.set('brc100_recent_apps', JSON.stringify({ apps: [{ domain: 'different.com' }] }))
    const changed = vi.fn()
    const cleanup = subscribeRecentApps(key, changed)
    expect(changed).toHaveBeenLastCalledWith(apps)
    cleanup()
  })

  it('refreshes on matching profile events and stops on cleanup', () => {
    const changed = vi.fn()
    const cleanup = subscribeRecentApps(key, changed)
    storage.set(`brc100_recent_apps_${key}`, JSON.stringify({ apps }))
    windowEvents.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId: 'other-profile' } }))
    expect(changed).toHaveBeenCalledTimes(1)
    windowEvents.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId: key } }))
    expect(changed).toHaveBeenLastCalledWith(apps)
    cleanup()
    windowEvents.dispatchEvent(new CustomEvent('recentAppsUpdated', { detail: { profileId: key } }))
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('keeps an unselected identity empty even when another profile has apps', () => {
    storage.set(`brc100_recent_apps_${key}`, JSON.stringify({ apps }))
    const changed = vi.fn()
    const cleanup = subscribeRecentApps('', changed)
    expect(changed).toHaveBeenLastCalledWith([])
    cleanup()
  })

  it('retains concurrent new app connections while website metadata is loading', async () => {
    const pending = new Map<string, () => void>()
    vi.mocked(isImageUrl).mockImplementation(url => new Promise(resolve => { pending.set(url, () => resolve(false)) }))
    const first = updateRecentApp(key, 'first.example')
    const second = updateRecentApp(key, 'second.example')
    pending.get('https://first.example/favicon.ico')!()
    await first
    pending.get('https://second.example/favicon.ico')!()
    await second
    expect(getRecentApps(key).map(app => app.domain)).toEqual(['second.example', 'first.example'])
  })
})
