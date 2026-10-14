/* Local release helper (docs/releases.md). Nothing here runs on its own and
   nothing is published without `draft`, which only makes a draft release.

     node scripts/release.mjs keygen                  one-time Ed25519 release key
     node scripts/release.mjs manifest --notes "..."  sign bunnyhop-update.json, write SHA256SUMS
     node scripts/release.mjs draft                   upload dist/electron artifacts to a draft release

   The private key lives outside the repository, at BUNNYHOP_RELEASE_KEY or
   ~/.config/bunnyhop-client/release-ed25519.pem. Back it up: without it no
   later release can tell installed clients about itself. */
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { readSignedFeed } from '../electron/update-check.mjs';

const REPO = '8tp/bunnyhop-client';
const OUTPUT = path.resolve('dist', 'electron');
const FEED = 'bunnyhop-update.json';
const keyFile = process.env.BUNNYHOP_RELEASE_KEY || path.join(os.homedir(), '.config', 'bunnyhop-client', 'release-ed25519.pem');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ARTIFACT = new RegExp(`^Bunnyhop-${version.replace(/\./g, '\\.')}-(mac|win|linux)-([A-Za-z0-9_]+)(?:-setup)?\\.(dmg|exe|zip|AppImage|deb)$`);

function artifacts() {
  if (!existsSync(OUTPUT)) throw new Error(`no build output in ${OUTPUT}`);
  const names = readdirSync(OUTPUT).filter((name) => ARTIFACT.test(name)).sort();
  if (!names.length) throw new Error(`no Bunnyhop-${version}-* artifacts in ${OUTPUT}; run npm run release:build first`);
  return names;
}

function keygen() {
  if (existsSync(keyFile)) throw new Error(`${keyFile} already exists; a new key would orphan installed clients`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const source = path.resolve('electron', 'update-check.mjs');
  const text = readFileSync(source, 'utf8');
  const body = pem.trim().split('\n').slice(1, -1).join('\n');
  if (text.includes('__RELEASE_PUBLIC_KEY__')) writeFileSync(source, text.replace('__RELEASE_PUBLIC_KEY__', body));
  console.log(`Private key written to ${keyFile} (back it up). Public key:\n${pem}`);
}

function manifest() {
  const notes = String(arg('--notes') || '').trim();
  if (!notes) throw new Error('--notes "one line players see in F10" is required');
  const files = artifacts().map((name) => {
    const bytes = readFileSync(path.join(OUTPUT, name));
    const [, platform, arch] = ARTIFACT.exec(name);
    return { name, platform, arch, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const body = JSON.stringify({
    schema: 1,
    product: 'bunnyhop-client',
    version,
    publishedAt: new Date().toISOString(),
    page: `https://github.com/${REPO}/releases/tag/v${version}`,
    notes: notes.slice(0, 500),
    files,
  });
  const signature = sign(null, Buffer.from(body, 'utf8'), createPrivateKey(readFileSync(keyFile))).toString('base64');
  const feed = `${JSON.stringify({ manifest: body, signature }, null, 2)}\n`;
  // The shipped public key must accept it, or installed clients would ignore this release.
  if (readSignedFeed(feed)?.version !== version) throw new Error('the signed feed does not verify against electron/update-check.mjs');
  writeFileSync(path.join(OUTPUT, FEED), feed);
  writeFileSync(path.join(OUTPUT, 'SHA256SUMS'), files.map((f) => `${f.sha256}  ${f.name}`).join('\n') + '\n');
  console.log(`Signed ${FEED} for ${version}:\n${files.map((f) => `  ${f.name}`).join('\n')}`);
}

function draft() {
  const tag = `v${version}`;
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { stdio: 'ignore' });
  const feed = readSignedFeed(readFileSync(path.join(OUTPUT, FEED), 'utf8'));
  if (feed?.version !== version) throw new Error(`${FEED} is missing or not for ${version}; run manifest first`);
  const notesFile = path.join(OUTPUT, 'release-notes.md');
  writeFileSync(notesFile, `${feed.notes}\n\nInstall help, including the one-time Windows and macOS security prompts: https://github.com/${REPO}#install\n\nChecksums are in SHA256SUMS.\n`);
  const upload = [...artifacts(), FEED, 'SHA256SUMS'].map((name) => path.join(OUTPUT, name));
  execFileSync('gh', ['release', 'create', tag, '--repo', REPO, '--verify-tag', '--draft', '--title', `Bunnyhop Client ${version}`, '--notes-file', notesFile, ...upload], { stdio: 'inherit' });
  console.log('Draft created. Review it on GitHub, then publish; clients only see published releases.');
}

const command = process.argv[2];
if (command === 'keygen') keygen();
else if (command === 'manifest') manifest();
else if (command === 'draft') draft();
else {
  console.error('usage: node scripts/release.mjs keygen | manifest --notes "..." | draft');
  process.exit(2);
}
