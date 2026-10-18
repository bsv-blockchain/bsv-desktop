import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// electron/main.ts cannot be imported under vitest (it opens windows and servers), so the
// choice lives in its own module that takes the packaging state and the environment.
import { isDevMode, LOAD_DIST_ENV } from '../electron/rendererSource'

describe('isDevMode', () => {
  it('reads BSV_DESKTOP_LOAD_DIST', () => {
    expect(LOAD_DIST_ENV).toBe('BSV_DESKTOP_LOAD_DIST')
  })

  it('runs from the Vite dev server when started from source, or with NODE_ENV=development', () => {
    expect(isDevMode(false, {})).toBe(true)
    expect(isDevMode(true, { NODE_ENV: 'development' })).toBe(true)
  })

  it('loads the build when packaged', () => {
    expect(isDevMode(true, {})).toBe(false)
    expect(isDevMode(true, { NODE_ENV: 'production' })).toBe(false)
  })

  // So a second test wallet can run from a build, without a Vite server, and never shows
  // whatever else happens to listen on port 5173.
  it.each(['1', 'true', 'TRUE', ' 1 '])('loads the build from source with BSV_DESKTOP_LOAD_DIST=%j, whatever NODE_ENV says', value => {
    expect(isDevMode(false, { BSV_DESKTOP_LOAD_DIST: value })).toBe(false)
    expect(isDevMode(false, { BSV_DESKTOP_LOAD_DIST: value, NODE_ENV: 'development' })).toBe(false)
  })

  it.each(['', '0', 'false', 'no'])('ignores BSV_DESKTOP_LOAD_DIST=%j', value => {
    expect(isDevMode(false, { BSV_DESKTOP_LOAD_DIST: value })).toBe(true)
  })
})

describe('electron/main.ts wiring', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

  it('decides development mode only through isDevMode', () => {
    expect(main).toMatch(/^import \{ isDevMode \} from '\.\/rendererSource\.js';?$/m)
    expect(main).toMatch(/^const isDev = isDevMode\(app\.isPackaged\);?$/m)
    expect(main).not.toMatch(/NODE_ENV/)
    expect(main.match(/app\.isPackaged/g)).toHaveLength(1)
  })

  it('loads dist/index.html when not in development mode, and the dev server only in it', () => {
    expect(main).toMatch(/if \(isDev\) \{\s*mainWindow\.loadURL\('http:\/\/localhost:5173'\);[\s\S]*?\} else \{\s*mainWindow\.loadFile\(path\.join\(__dirname, '\.\.\/dist\/index\.html'\)\);/)
  })
})
