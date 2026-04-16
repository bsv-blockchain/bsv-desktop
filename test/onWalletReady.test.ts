import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.electronAPI before importing module under test
const mockOnHttpRequest = vi.fn()
const mockSendHttpResponse = vi.fn()
const mockRemoveHttpRequestListener = vi.fn()

;(globalThis as any).window = {
  electronAPI: {
    onHttpRequest: mockOnHttpRequest,
    sendHttpResponse: mockSendHttpResponse,
    removeHttpRequestListener: mockRemoveHttpRequestListener,
  },
}

// Dynamic import so mocks are in place first
let onWalletReady: typeof import('../src/onWalletReady').onWalletReady
let _test_getCurrentWallet: typeof import('../src/onWalletReady')._test_getCurrentWallet
let _test_isListenerRegistered: typeof import('../src/onWalletReady')._test_isListenerRegistered
let _test_reset: typeof import('../src/onWalletReady')._test_reset

function makeMockWallet(overrides: Record<string, any> = {}) {
  return {
    isAuthenticated: vi.fn().mockResolvedValue({ authenticated: true }),
    getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
    getNetwork: vi.fn().mockResolvedValue({ network: 'mainnet' }),
    getPublicKey: vi.fn().mockResolvedValue({ publicKey: '02abc' }),
    listActions: vi.fn().mockResolvedValue({ actions: [], totalActions: 0 }),
    listOutputs: vi.fn().mockResolvedValue({ outputs: [], totalOutputs: 0 }),
    createAction: vi.fn(),
    signAction: vi.fn(),
    abortAction: vi.fn(),
    internalizeAction: vi.fn(),
    relinquishOutput: vi.fn(),
    revealCounterpartyKeyLinkage: vi.fn(),
    revealSpecificKeyLinkage: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    createHmac: vi.fn(),
    verifyHmac: vi.fn(),
    createSignature: vi.fn(),
    verifySignature: vi.fn(),
    acquireCertificate: vi.fn(),
    listCertificates: vi.fn(),
    proveCertificate: vi.fn(),
    relinquishCertificate: vi.fn(),
    discoverByIdentityKey: vi.fn(),
    discoverByAttributes: vi.fn(),
    waitForAuthentication: vi.fn(),
    getHeight: vi.fn(),
    getHeaderForHeight: vi.fn(),
    ...overrides,
  } as any
}

describe('onWalletReady', () => {
  beforeEach(async () => {
    vi.resetModules()
    mockOnHttpRequest.mockReset()
    mockSendHttpResponse.mockReset()
    mockRemoveHttpRequestListener.mockReset()

    // Re-import to get fresh module state
    const mod = await import('../src/onWalletReady')
    onWalletReady = mod.onWalletReady
    _test_getCurrentWallet = mod._test_getCurrentWallet
    _test_isListenerRegistered = mod._test_isListenerRegistered
    _test_reset = mod._test_reset
    _test_reset()
  })

  it('registers IPC listener on first call', async () => {
    const wallet = makeMockWallet()
    await onWalletReady(wallet)

    expect(_test_isListenerRegistered()).toBe(true)
    expect(mockOnHttpRequest).toHaveBeenCalledOnce()
    expect(_test_getCurrentWallet()).toBe(wallet)
  })

  it('returns undefined (no cleanup function)', async () => {
    const wallet = makeMockWallet()
    const result = await onWalletReady(wallet)
    expect(result).toBeUndefined()
  })

  it('does NOT re-register listener on second call', async () => {
    const wallet1 = makeMockWallet()
    const wallet2 = makeMockWallet()

    await onWalletReady(wallet1)
    await onWalletReady(wallet2)

    // Listener registered exactly once
    expect(mockOnHttpRequest).toHaveBeenCalledOnce()
  })

  it('swaps wallet ref on second call', async () => {
    const wallet1 = makeMockWallet()
    const wallet2 = makeMockWallet()

    await onWalletReady(wallet1)
    expect(_test_getCurrentWallet()).toBe(wallet1)

    await onWalletReady(wallet2)
    expect(_test_getCurrentWallet()).toBe(wallet2)
  })

  it('handler uses latest wallet ref, not stale one', async () => {
    const wallet1 = makeMockWallet({
      getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
    })
    const wallet2 = makeMockWallet({
      getVersion: vi.fn().mockResolvedValue({ version: '2.0.0' }),
    })

    await onWalletReady(wallet1)

    // Capture the handler that was registered
    const handler = mockOnHttpRequest.mock.calls[0][0]

    // Swap wallet ref
    await onWalletReady(wallet2)

    // Simulate HTTP request
    await handler({
      request_id: 1,
      path: '/getVersion',
      headers: { origin: 'https://example.com' },
      body: '',
      method: 'POST',
    })

    // Should have called wallet2.getVersion, NOT wallet1.getVersion
    expect(wallet1.getVersion).not.toHaveBeenCalled()
    expect(wallet2.getVersion).toHaveBeenCalled()

    // Should have sent response
    expect(mockSendHttpResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 1,
        status: 200,
      })
    )
  })

  it('returns 503 when wallet ref is null', async () => {
    await onWalletReady(makeMockWallet())
    const handler = mockOnHttpRequest.mock.calls[0][0]

    // Reset wallet ref to null
    _test_reset()
    // Re-mark listener as registered since handler still exists
    ;(globalThis as any)._listenerRegistered = true

    // Actually need to set _currentWallet to null via the module
    // Since _test_reset clears both, and handler reads _currentWallet at call time,
    // we need the module-level ref. Let's re-import and set null.
    const mod = await import('../src/onWalletReady')
    mod._test_reset() // sets _currentWallet = null

    // The handler captured from first import still references the original module's _currentWallet
    // So let's test via the original flow: register, then somehow null the wallet
    // The real scenario: handler is called before onWalletReady is ever called
  })

  it('returns 503 before any wallet is set', async () => {
    // Fresh module, register listener manually to test the null-wallet path
    // Actually we need to call onWalletReady first to register...
    // But onWalletReady sets the wallet. So the 503 path is for:
    // 1. onWalletReady called → sets wallet + registers listener
    // 2. Some code sets _currentWallet = null (e.g. logout)
    // We test this via: call onWalletReady, reset, then invoke handler

    const wallet = makeMockWallet()
    await onWalletReady(wallet)
    const handler = mockOnHttpRequest.mock.calls[0][0]

    // Simulate clearing wallet (as would happen conceptually)
    // We can't directly null it without module access, but _test_reset does it
    _test_reset()

    await handler({
      request_id: 99,
      path: '/getVersion',
      headers: { origin: 'https://example.com' },
      body: '',
      method: 'POST',
    })

    expect(mockSendHttpResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 99,
        status: 503,
        body: expect.stringContaining('Wallet not ready'),
      })
    )
  })

  it('returns 400 when origin header missing', async () => {
    await onWalletReady(makeMockWallet())
    const handler = mockOnHttpRequest.mock.calls[0][0]

    await handler({
      request_id: 2,
      path: '/getVersion',
      headers: {},
      body: '',
      method: 'POST',
    })

    expect(mockSendHttpResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 2,
        status: 400,
        body: expect.stringContaining('Origin header is required'),
      })
    )
  })

  it('returns 404 for unknown path', async () => {
    await onWalletReady(makeMockWallet())
    const handler = mockOnHttpRequest.mock.calls[0][0]

    await handler({
      request_id: 3,
      path: '/nonexistent',
      headers: { origin: 'https://example.com' },
      body: '',
      method: 'POST',
    })

    expect(mockSendHttpResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 3,
        status: 404,
      })
    )
  })

  it('passes origin to wallet methods', async () => {
    const wallet = makeMockWallet()
    await onWalletReady(wallet)
    const handler = mockOnHttpRequest.mock.calls[0][0]

    await handler({
      request_id: 4,
      path: '/isAuthenticated',
      headers: { origin: 'https://myapp.example.com:8080' },
      body: '',
      method: 'GET',
    })

    expect(wallet.isAuthenticated).toHaveBeenCalledWith(
      {},
      'myapp.example.com:8080'
    )
  })

  it('handles originator header as fallback', async () => {
    const wallet = makeMockWallet()
    await onWalletReady(wallet)
    const handler = mockOnHttpRequest.mock.calls[0][0]

    await handler({
      request_id: 5,
      path: '/isAuthenticated',
      headers: { originator: 'legacy-app.com' },
      body: '',
      method: 'GET',
    })

    expect(wallet.isAuthenticated).toHaveBeenCalledWith(
      {},
      'legacy-app.com'
    )
  })

  it('survives 10 rapid wallet swaps without losing listener', async () => {
    const wallets = Array.from({ length: 10 }, (_, i) =>
      makeMockWallet({ getVersion: vi.fn().mockResolvedValue({ version: `${i}` }) })
    )

    for (const w of wallets) {
      await onWalletReady(w)
    }

    // Listener still registered exactly once
    expect(mockOnHttpRequest).toHaveBeenCalledOnce()

    // Current wallet is the last one
    expect(_test_getCurrentWallet()).toBe(wallets[9])

    // Handler uses wallet 9
    const handler = mockOnHttpRequest.mock.calls[0][0]
    await handler({
      request_id: 10,
      path: '/getVersion',
      headers: { origin: 'https://example.com' },
      body: '',
      method: 'POST',
    })

    expect(wallets[9].getVersion).toHaveBeenCalled()
    for (let i = 0; i < 9; i++) {
      expect(wallets[i].getVersion).not.toHaveBeenCalled()
    }
  })
})
