import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchTrustManifest } = vi.hoisted(() => ({
  fetchTrustManifest: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@mui/material', () => ({
  Typography: 'typography',
  Button: 'button',
  TextField: 'text-field',
  DialogContent: 'dialog-content',
  DialogContentText: 'dialog-content-text',
  DialogActions: 'dialog-actions',
  LinearProgress: 'linear-progress',
  InputAdornment: 'input-adornment',
  Box: 'box'
}))

vi.mock('@mui/icons-material/Public', () => ({ default: 'domain-icon' }))
vi.mock('@mui/icons-material/ExpandMore', () => ({ default: 'expand-more-icon' }))
vi.mock('@mui/icons-material/ExpandLess', () => ({ default: 'expand-less-icon' }))
vi.mock('@mui/icons-material/DocumentScanner', () => ({ default: 'get-trust-icon' }))
vi.mock('@mui/icons-material/Security', () => ({ default: 'shield-icon' }))
vi.mock('@mui/icons-material/Person', () => ({ default: 'name-icon' }))
vi.mock('@mui/icons-material/InsertPhoto', () => ({ default: 'picture-icon' }))
vi.mock('@mui/icons-material/Key', () => ({ default: 'key-icon' }))
vi.mock('../src/lib/components/CustomDialog', () => ({ default: 'custom-dialog' }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn() } }))
vi.mock('../src/lib/utils/validateTrust', () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../src/lib/utils/parseTrustManifest', () => ({
  default: fetchTrustManifest,
  TrustManifestError: class TrustManifestError extends Error {}
}))

import AddEntityModal from '../src/lib/pages/Dashboard/Trust/AddEntityModal'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolver => { resolve = resolver })
  return { promise, resolve }
}

const trust = (name: string, publicKeyPrefix: '02' | '03') => ({
  trust: {
    name,
    note: `${name} trust provider`,
    icon: `https://${name.toLowerCase().replaceAll(' ', '-')}.example/icon.png`,
    publicKey: `${publicKeyPrefix}${'1'.repeat(64)}`
  }
})

describe('AddEntityModal trust-manifest request ownership', () => {
  beforeEach(() => {
    fetchTrustManifest.mockReset()
  })

  it('never applies domain A after the visible input changes to domain B', async () => {
    const domainA = deferred<ReturnType<typeof trust>>()
    const domainB = deferred<ReturnType<typeof trust>>()
    fetchTrustManifest
      .mockReturnValueOnce(domainA.promise)
      .mockReturnValueOnce(domainB.promise)

    let renderer!: TestRenderer.ReactTestRenderer
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AddEntityModal, {
        open: true,
        setOpen: vi.fn(),
        trustedEntities: [],
        setTrustedEntities: vi.fn()
      }))
    })

    const domainField = () => renderer.root.findByProps({ label: 'trust_add_entity_domain_label' })
    const manifestForm = () => renderer.root.findAllByType('form')[0]

    await act(async () => {
      domainField().props.onChange({ target: { value: 'a.example' } })
    })
    await act(async () => {
      void manifestForm().props.onSubmit({ preventDefault: vi.fn() })
    })

    await act(async () => {
      domainField().props.onChange({ target: { value: 'b.example' } })
    })
    await act(async () => {
      void manifestForm().props.onSubmit({ preventDefault: vi.fn() })
    })

    await act(async () => {
      domainB.resolve(trust('Domain B', '03'))
      await domainB.promise
    })

    expect(renderer.root.findByProps({ value: 'Domain B trust provider' })).toBeTruthy()
    expect(renderer.root.findByProps({ src: 'https://domain-b.example/icon.png' })).toBeTruthy()
    expect(renderer.root.findByProps({ children: `03${'1'.repeat(64)}` })).toBeTruthy()

    await act(async () => {
      domainA.resolve(trust('Domain A', '02'))
      await domainA.promise
    })

    expect(renderer.root.findByProps({ value: 'b.example' })).toBeTruthy()
    expect(renderer.root.findByProps({ value: 'Domain B trust provider' })).toBeTruthy()
    expect(renderer.root.findByProps({ src: 'https://domain-b.example/icon.png' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: 'Domain A' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ children: `02${'1'.repeat(64)}` })).toHaveLength(0)
  })
})
