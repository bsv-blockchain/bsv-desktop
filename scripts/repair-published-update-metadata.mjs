#!/usr/bin/env node
/**
 * Repair the auto-update metadata of an ALREADY-PUBLISHED release.
 *
 * Releases built before the Windows signing fix shipped a latest.yml holding
 * the sha512 of the unsigned installer, while the signed installer was uploaded
 * alongside it. Installed clients download the installer, hash it, and abort
 * with "sha512 checksum mismatch". The installers themselves are fine — only
 * the metadata is wrong — so republishing a corrected latest.yml unblocks every
 * client in the wild without cutting a new release.
 *
 * Note that electron-updater only ever reads the newest release's metadata, so
 * in practice only the latest release needs repairing.
 *
 * This script never guesses: it downloads the published artifacts, recomputes
 * their hashes, and rewrites only the sha512/size fields. It is a dry run
 * unless --apply is passed, and --apply requires the `gh` CLI.
 *
 * Usage:
 *   node scripts/repair-published-update-metadata.mjs --tag v2.7.2
 *   node scripts/repair-published-update-metadata.mjs --tag v2.7.2 --apply
 *
 * Options:
 *   --tag <tag>      Release tag to inspect (required)
 *   --repo <o/r>     Defaults to bsv-blockchain/bsv-desktop
 *   --yml <name>     Metadata file to repair (default: latest.yml, the Windows one)
 *   --workdir <dir>  Download location (default: .update-metadata-repair)
 *   --apply          Upload the corrected metadata with `gh release upload --clobber`
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { repo: 'bsv-blockchain/bsv-desktop', yml: 'latest.yml', workdir: '.update-metadata-repair' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = true;
    else if (flag.startsWith('--')) args[flag.slice(2)] = argv[++i];
  }
  if (!args.tag) {
    console.error('--tag is required, e.g. --tag v2.7.2');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = `https://github.com/${args.repo}/releases/download/${args.tag}`;

async function download(name, dest) {
  try {
    const existing = await stat(dest);
    if (existing.size > 0) {
      console.log(`  cached  ${name} (${existing.size} bytes)`);
      return;
    }
  } catch {
    // not cached yet
  }

  const url = `${baseUrl}/${name}`;
  console.log(`  fetch   ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function sha512Base64(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

await mkdir(args.workdir, { recursive: true });

console.log(`Repairing ${args.yml} for ${args.repo} ${args.tag}\n`);

const ymlPath = path.join(args.workdir, args.yml);
await download(args.yml, ymlPath);
const original = await readFile(ymlPath, 'utf8');

// Collect the artifacts referenced by the metadata, in order of appearance.
const referenced = [...original.matchAll(/^\s*-\s*url:\s*(.+?)\s*$/gm)].map((m) => decodeURIComponent(m[1]));
if (referenced.length === 0) {
  console.error(`No file entries found in ${args.yml}`);
  process.exit(1);
}

const truth = new Map();
for (const name of referenced) {
  const dest = path.join(args.workdir, name);
  await download(name, dest);
  truth.set(name, { sha512: await sha512Base64(dest), size: (await stat(dest)).size });
}

// Rewrite sha512/size in place, tracking which artifact each block belongs to.
let currentUrl = null;
let changes = 0;

const repaired = original
  .split(/\r?\n/)
  .map((line) => {
    const urlMatch = line.match(/^(\s*-\s*url:\s*)(.+?)\s*$/);
    if (urlMatch) {
      currentUrl = decodeURIComponent(urlMatch[2]);
      return line;
    }

    // Top-level `path:` repeats the primary artifact; its sha512 follows.
    const pathMatch = line.match(/^path:\s*(.+?)\s*$/);
    if (pathMatch) {
      currentUrl = decodeURIComponent(pathMatch[1]);
      return line;
    }

    const fieldMatch = line.match(/^(\s*)(sha512|size):\s*(.+?)\s*$/);
    if (!fieldMatch || !currentUrl || !truth.has(currentUrl)) return line;

    const [, indent, field, oldValue] = fieldMatch;
    const newValue = String(truth.get(currentUrl)[field]);
    if (oldValue === newValue) return line;

    changes++;
    console.log(`\n  ${currentUrl} :: ${field}`);
    console.log(`    was: ${oldValue}`);
    console.log(`    now: ${newValue}`);
    return `${indent}${field}: ${newValue}`;
  })
  .join('\n');

console.log('');

if (changes === 0) {
  console.log(`${args.yml} for ${args.tag} is already correct — nothing to do.`);
  process.exit(0);
}

const outPath = path.join(args.workdir, `corrected-${args.yml}`);
await writeFile(outPath, repaired);
console.log(`${changes} field(s) corrected. Wrote ${outPath}`);

if (!args.apply) {
  console.log('\nDry run. Re-run with --apply to publish, or upload manually:');
  console.log(`  gh release upload ${args.tag} ${outPath} --clobber   # after renaming to ${args.yml}`);
  process.exit(0);
}

// `gh release upload` names the asset after the file, so upload under the real name.
const uploadPath = path.join(args.workdir, 'upload', args.yml);
await mkdir(path.dirname(uploadPath), { recursive: true });
await writeFile(uploadPath, repaired);

console.log(`\nUploading ${args.yml} to ${args.repo} ${args.tag}...`);
execFileSync('gh', ['release', 'upload', args.tag, uploadPath, '--clobber', '--repo', args.repo], {
  stdio: 'inherit',
});
console.log('Done. Installed clients will pick up the corrected metadata on their next check.');
