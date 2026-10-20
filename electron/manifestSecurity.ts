import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const LOCAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.test',
  '.invalid',
];

function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);

    // IPv4 benchmarking range (RFC 2544), which ipaddr.js classifies as
    // unicast even though it is not globally routable.
    if (parsed.kind() === 'ipv4') {
      const ipv4 = parsed as ipaddr.IPv4;
      if (ipv4.match(ipaddr.IPv4.parse('198.18.0.0'), 15)) {
        return false;
      }
    }

    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;

      // IPv4-mapped addresses must pass the IPv4 checks as well.
      if (ipv6.isIPv4MappedAddress()) {
        return isPublicAddress(ipv6.toIPv4Address().toString());
      }
    }

    // Only globally routable unicast addresses are accepted.
    // ipaddr.js classifies private, loopback, link-local, multicast,
    // reserved, and other special-purpose ranges separately.
    if (parsed.range() !== 'unicast') return false;

    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;

      // Global unicast allocations are within 2000::/3. Reject other
      // address space, including unique-local, link-local, and special-use
      // ranges that may otherwise be classified as unicast by ipaddr.js.
      if (!ipv6.match(ipaddr.IPv6.parse('2000::'), 3)) return false;

      // Reject transition/translation ranges rather than allowing access
      // through embedded or translated IPv4 addresses.
      if (['rfc6052', 'rfc6145', '6to4', 'teredo'].includes(ipv6.range())) {
        return false;
      }

      // Reject the 2001::/23 special-purpose block conservatively because
      // ipaddr.js does not classify all of its assignments individually.
      if (ipv6.match(ipaddr.IPv6.parse('2001::'), 23)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function validateManifestUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Invalid manifest URL');
  }

  if (url.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  if (url.port && url.port !== '443') throw new Error('Non-standard HTTPS ports are not allowed');

  const pathname = url.pathname.toLowerCase();
  if (!pathname.endsWith('/manifest.json') && pathname !== '/manifest.json') {
    throw new Error('Only manifest.json files are allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' ||
      LOCAL_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new Error('Local hostnames are not allowed');
  }

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) {
      throw new Error('Non-public IP addresses are not allowed');
    }
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Manifest hostname could not be resolved');
  }

  if (addresses.length === 0 ||
      addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error('Manifest hostname resolves to a non-public address');
  }

  return url;
}
