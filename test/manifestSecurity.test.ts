import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}));

import { validateManifestUrl } from '../electron/manifestSecurity.js';

describe('validateManifestUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });
  it.each([
    'http://example.com/manifest.json',
    'file:///manifest.json',
    'https://user:pass@example.com/manifest.json',
    'https://example.com:8443/manifest.json',
    'https://example.com/not-manifest.json',
    'https://localhost/manifest.json',
    'https://service.local/manifest.json',
    'https://service.internal/manifest.json',
    'https://127.0.0.1/manifest.json',
    'https://10.0.0.1/manifest.json',
    'https://198.18.0.1/manifest.json',
    'https://169.254.169.254/manifest.json',
    'https://[::1]/manifest.json',
    'https://[fc00::1]/manifest.json',
    'https://[fe80::1]/manifest.json',
    'https://[2001:db8::1]/manifest.json',
    'https://[2001:5::1]/manifest.json',
    'https://[2001:10::1]/manifest.json',
    'https://[2001:20::1]/manifest.json',
    'https://[2002::1]/manifest.json',
    'https://[64:ff9b::808:808]/manifest.json',
    'https://[::ffff:127.0.0.1]/manifest.json',
  ])('rejects unsafe URL: %s', async (url) => {
    await expect(validateManifestUrl(url)).rejects.toThrow();
  });

  it('accepts a public IPv4-mapped IPv6 manifest URL', async () => {
    await expect(
      validateManifestUrl('https://[::ffff:8.8.8.8]/manifest.json'),
    ).resolves.toBeInstanceOf(URL);
  });

  it('accepts a public IPv4 manifest URL', async () => {
    await expect(
      validateManifestUrl('https://8.8.8.8/manifest.json'),
    ).resolves.toBeInstanceOf(URL);
  });

  it('accepts a public IPv6 manifest URL', async () => {
    await expect(
      validateManifestUrl('https://[2606:4700:4700::1111]/manifest.json'),
    ).resolves.toBeInstanceOf(URL);
  });


  it('accepts a hostname that resolves only to public addresses', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);

    await expect(
      validateManifestUrl('https://example.com/manifest.json'),
    ).resolves.toBeInstanceOf(URL);

    expect(mockLookup).toHaveBeenCalledWith('example.com', {
      all: true,
      verbatim: true,
    });
  });

  it('rejects a hostname that resolves to a private address', async () => {
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(
      validateManifestUrl('https://example.com/manifest.json'),
    ).rejects.toThrow('Manifest hostname resolves to a non-public address');
  });

  it('rejects a hostname with mixed public and private DNS answers', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);

    await expect(
      validateManifestUrl('https://example.com/manifest.json'),
    ).rejects.toThrow('Manifest hostname resolves to a non-public address');
  });

  it('rejects a hostname with no DNS answers', async () => {
    mockLookup.mockResolvedValue([]);

    await expect(
      validateManifestUrl('https://example.com/manifest.json'),
    ).rejects.toThrow('Manifest hostname resolves to a non-public address');
  });

  it('rejects a hostname when DNS lookup fails', async () => {
    mockLookup.mockRejectedValue(new Error('DNS lookup failed'));

    await expect(
      validateManifestUrl('https://example.com/manifest.json'),
    ).rejects.toThrow('Manifest hostname could not be resolved');
  });

  it('rejects a malformed URL', async () => {
    await expect(validateManifestUrl('not a URL')).rejects.toThrow(
      'Invalid manifest URL',
    );
  });
});
