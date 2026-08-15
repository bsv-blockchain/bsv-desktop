#!/usr/bin/env node
/**
 * Release guard: prove the auto-update metadata matches the artifacts we ship.
 *
 * electron-updater downloads the file named in latest*.yml, hashes it, and
 * aborts the update if the hash differs from the one declared there. Any
 * release step that rewrites an artifact after electron-builder has computed
 * that hash silently breaks updates for every installed client — which is
 * exactly how "sha512 checksum mismatch" shipped on Windows in v2.6.x/2.7.x.
 *
 * This script recomputes the hashes from the files on disk and fails the build
 * on any mismatch, so that class of bug can never reach a release again.
 *
 * Usage: node scripts/verify-update-metadata.mjs [releaseDir]   (default: release)
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = process.argv[2] ?? 'release';

/**
 * Minimal parser for the update-metadata subset of YAML that electron-builder
 * emits: a top-level `files:` sequence of url/sha512/size maps.
 */
function parseUpdateYml(text) {
  const entries = [];
  let current = null;
  let inFiles = false;

  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\S/.test(rawLine)) {
      inFiles = /^files:\s*$/.test(rawLine);
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (!inFiles) continue;

    const item = rawLine.match(/^\s*-\s*url:\s*(.+?)\s*$/);
    if (item) {
      if (current) entries.push(current);
      current = { url: item[1] };
      continue;
    }
    const field = rawLine.match(/^\s+(sha512|size):\s*(.+?)\s*$/);
    if (field && current) {
      current[field[1]] = field[2];
    }
  }
  if (current) entries.push(current);

  return entries;
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

const ymlFiles = (await readdir(releaseDir))
  .filter((name) => /^latest(-mac|-linux)?\.yml$/.test(name))
  .sort();

if (ymlFiles.length === 0) {
  console.error(`No latest*.yml found in ${releaseDir}/ — nothing to verify.`);
  process.exit(1);
}

let failures = 0;
let checked = 0;
/* Hash mismatches specifically, as opposed to artifacts that were not there at
   all. The two have different causes and the summary should not blame signing
   for a missing file. */
let mismatches = 0;

for (const ymlName of ymlFiles) {
  const ymlPath = path.join(releaseDir, ymlName);
  console.log(`\n=== ${ymlName} ===`);

  const entries = parseUpdateYml(await readFile(ymlPath, 'utf8'));
  if (entries.length === 0) {
    console.error(`  ERROR: no file entries parsed from ${ymlName}`);
    failures++;
    continue;
  }

  /*
   * How many of THIS file's artifacts were actually hashed.
   *
   * Tracked per metadata file rather than globally because the skip below is
   * legitimate — latest-mac.yml lists x64 and arm64, and a runner that built one
   * arch cannot hash the other. What is never legitimate is a metadata file none
   * of whose artifacts could be found: that is a release whose installer is
   * missing or misnamed, and this script reporting success on it is the same
   * silent pass it exists to prevent.
   *
   * Counts what was HASHED, not what passed — a mismatch is a failure that has
   * already been reported, and counting it here too would report it twice.
   */
  let hashedHere = 0;

  for (const entry of entries) {
    const artifact = path.join(releaseDir, decodeURIComponent(entry.url));

    let stats;
    try {
      stats = await stat(artifact);
    } catch {
      // Not every artifact listed is necessarily built on this runner.
      console.log(`  SKIP  ${entry.url} (not present on this runner)`);
      continue;
    }

    checked++;
    hashedHere++;
    const actual = await sha512Base64(artifact);
    const sizeOk = entry.size == null || Number(entry.size) === stats.size;

    if (actual === entry.sha512 && sizeOk) {
      console.log(`  OK    ${entry.url}`);
      continue;
    }

    failures++;
    mismatches++;
    console.error(`  FAIL  ${entry.url}`);
    console.error(`        expected sha512: ${entry.sha512}`);
    console.error(`        actual   sha512: ${actual}`);
    if (!sizeOk) {
      console.error(`        expected size:   ${entry.size}`);
      console.error(`        actual   size:   ${stats.size}`);
    }
  }

  if (hashedHere === 0) {
    failures++;
    console.error(
      `  ERROR: ${ymlName} lists ${entries.length} artifact(s) and not one of them could be hashed.\n` +
        '         Every entry was missing from this runner, so nothing was verified. An update\n' +
        '         built from this directory would tell clients to download a file that is not there.'
    );
  }
}

console.log('');
if (failures > 0) {
  console.error(
    `Update metadata verification FAILED (${failures} problem(s) across ${checked} artifact(s) hashed).`
  );
  if (mismatches > 0) {
    console.error(
      'An artifact was modified after electron-builder computed its hash — most likely code signing\n' +
        'running as a separate step after the build. Sign inside electron-builder instead.'
    );
  } else {
    console.error(
      'No hash mismatched; the artifacts named by the metadata were not found. Either the build did\n' +
        'not produce them or something renamed or moved them after it did.'
    );
  }
  process.exit(1);
}

if (checked === 0) {
  // Belt and braces on top of the per-file check above: a run that hashed nothing
  // at all has proved nothing at all, whatever the reason.
  console.error('Update metadata verification checked NOTHING — refusing to report success.');
  process.exit(1);
}

console.log(`Update metadata verified: ${checked} artifact(s) match their declared sha512.`);
