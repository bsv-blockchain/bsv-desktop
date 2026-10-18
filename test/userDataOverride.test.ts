import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// electron/main.ts cannot be imported under vitest (it opens windows and
// servers), so the override lives in its own module that takes the app and the
// environment as arguments.
import { applyUserDataOverride, USER_DATA_ENV } from '../electron/userDataOverride'

const fakeApp = () => ({ setPath: vi.fn() })

describe('applyUserDataOverride', () => {
  it('reads BSV_DESKTOP_USER_DATA', () => {
    expect(USER_DATA_ENV).toBe('BSV_DESKTOP_USER_DATA')
  })

  it('leaves userData alone when the variable is not set', () => {
    const app = fakeApp()
    expect(applyUserDataOverride(app, {})).toBeUndefined()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('leaves userData alone when the variable is empty or blank', () => {
    const app = fakeApp()
    expect(applyUserDataOverride(app, { BSV_DESKTOP_USER_DATA: '' })).toBeUndefined()
    expect(applyUserDataOverride(app, { BSV_DESKTOP_USER_DATA: '   ' })).toBeUndefined()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('sets userData to an absolute path as given', () => {
    const app = fakeApp()
    const dir = path.resolve(path.sep, 'tmp', 'bsv-desktop-b')
    expect(applyUserDataOverride(app, { BSV_DESKTOP_USER_DATA: dir })).toBe(dir)
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData', dir)
  })

  it('resolves a relative path against the working directory', () => {
    const app = fakeApp()
    const resolved = path.resolve('some', 'relative', 'dir')
    expect(applyUserDataOverride(app, { BSV_DESKTOP_USER_DATA: path.join('some', 'relative', 'dir') })).toBe(resolved)
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData', resolved)
  })

  it('ignores other environment variables', () => {
    const app = fakeApp()
    expect(applyUserDataOverride(app, { HOME: '/home/x', BSV_DESKTOP_USER_DATA_OTHER: '/elsewhere' })).toBeUndefined()
    expect(app.setPath).not.toHaveBeenCalled()
  })
})

// The module is only useful if main.ts applies it before the app is ready and
// before any statement that could read userData.
describe('electron/main.ts wiring', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

  it('applies the override at the top level, before app.whenReady and the first IPC registration', () => {
    const call = main.search(/^applyUserDataOverride\(app\);?$/m)
    expect(call, 'applyUserDataOverride(app) must be an unindented top-level statement').toBeGreaterThan(-1)
    expect(main).toMatch(/^import \{ applyUserDataOverride \} from '\.\/userDataOverride\.js';?$/m)
    expect(call).toBeLessThan(main.indexOf('app.whenReady()'))
    expect(call).toBeLessThan(main.indexOf('registerWalletPortabilityIpc('))
    expect(call).toBeLessThan(main.indexOf('ipcMain.handle('))
  })

  it('is the only place the override is applied', () => {
    expect(main.match(/applyUserDataOverride\(/g)).toHaveLength(1)
  })
})
