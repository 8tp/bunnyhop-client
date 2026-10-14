import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { RELEASE_PUBLIC_KEY, checkForUpdate, compareVersions, isReleasePage, readSignedFeed } from '../update-check.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
function feed(fields = {}, key = privateKey) {
  const manifest = JSON.stringify({ schema: 1, product: 'bunnyhop-client', version: '0.2.0', page: 'https://github.com/8tp/bunnyhop-client/releases/tag/v0.2.0', notes: 'Faster', files: [], ...fields });
  return JSON.stringify({ manifest, signature: sign(null, Buffer.from(manifest), key).toString('base64') });
}
const respond = (body, status = 200) => async () => new Response(body, { status });

test('the shipped release key is a real Ed25519 key', () => {
  assert.doesNotMatch(RELEASE_PUBLIC_KEY, /__RELEASE_PUBLIC_KEY__/);
  assert.equal(readSignedFeed(feed(), RELEASE_PUBLIC_KEY), null);
});

test('versions compare numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), null);
});

test('only release pages may be opened from a feed', () => {
  assert.equal(isReleasePage('https://github.com/8tp/bunnyhop-client/releases/tag/v0.2.0'), true);
  assert.equal(isReleasePage('https://bunnyhop.lol/download'), true);
  for (const u of ['http://github.com/8tp/bunnyhop-client/releases', 'https://github.com/evil/bunnyhop-client/releases', 'https://github.com/8tp/bunnyhop-client/releases/download/v1.0.0/x.exe', 'https://bunnyhop.lol/download?x=1', 'https://user@bunnyhop.lol/download', 'https://bunnyhop.lol.evil.test/download']) assert.equal(isReleasePage(u), false, u);
});

test('a signed feed is read; altered, wrongly signed or misdirected feeds are not', () => {
  assert.deepEqual(readSignedFeed(feed(), pem), { version: '0.2.0', page: 'https://github.com/8tp/bunnyhop-client/releases/tag/v0.2.0', notes: 'Faster' });
  const tampered = JSON.parse(feed());
  tampered.manifest = tampered.manifest.replace('0.2.0', '9.9.9');
  assert.equal(readSignedFeed(JSON.stringify(tampered), pem), null);
  assert.equal(readSignedFeed(feed({}, generateKeyPairSync('ed25519').privateKey), pem), null);
  assert.equal(readSignedFeed(feed({ page: 'https://evil.test/' }), pem), null);
  assert.equal(readSignedFeed(feed({ product: 'other' }), pem), null);
  assert.equal(readSignedFeed('not json', pem), null);
  assert.equal(readSignedFeed('x'.repeat(70_000), pem), null);
});

test('checkForUpdate reports newer releases only, and failures as errors', async () => {
  assert.equal((await checkForUpdate({ fetch: respond(feed()), currentVersion: '0.1.0', publicKey: pem })).state, 'available');
  assert.equal((await checkForUpdate({ fetch: respond(feed()), currentVersion: '0.2.0', publicKey: pem })).state, 'current');
  assert.equal((await checkForUpdate({ fetch: respond('', 404), currentVersion: '0.1.0', publicKey: pem })).state, 'current');
  assert.equal((await checkForUpdate({ fetch: respond('', 500), currentVersion: '0.1.0', publicKey: pem })).state, 'error');
  assert.equal((await checkForUpdate({ fetch: respond(feed({}, generateKeyPairSync('ed25519').privateKey)), currentVersion: '0.1.0', publicKey: pem })).state, 'error');
  assert.equal((await checkForUpdate({ fetch: async () => { throw new Error('offline'); }, currentVersion: '0.1.0', publicKey: pem })).message, 'offline');
});
