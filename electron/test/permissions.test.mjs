import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionCheckAllowed, permissionRequestAllowed } from '../security.mjs';

const game = 'https://bunnyhop.lol/?client=bunnyhop-client';

test('the game page may use the microphone, audio only', () => {
  assert.equal(permissionRequestAllowed({ permission: 'media', requestingUrl: game, pageUrl: game, mediaTypes: ['audio'] }), true);
  assert.equal(permissionRequestAllowed({ permission: 'media', requestingUrl: 'https://www.bunnyhop.lol/', pageUrl: 'https://www.bunnyhop.lol/', mediaTypes: ['audio'] }), true);
  assert.equal(permissionCheckAllowed({ permission: 'media', requestingOrigin: 'https://bunnyhop.lol', pageUrl: game, mediaType: 'audio' }), true);
});

test('camera, screen capture and empty media requests are refused', () => {
  for (const mediaTypes of [['video'], ['audio', 'video'], [], undefined, ['audio', 'screen']]) {
    assert.equal(permissionRequestAllowed({ permission: 'media', requestingUrl: game, pageUrl: game, mediaTypes }), false);
  }
  for (const mediaType of ['video', 'unknown', undefined]) {
    assert.equal(permissionCheckAllowed({ permission: 'media', requestingOrigin: 'https://bunnyhop.lol', pageUrl: game, mediaType }), false);
  }
  for (const permission of ['display-capture', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'hid', 'serial', 'usb', 'speaker-selection', 'openExternal']) {
    assert.equal(permissionRequestAllowed({ permission, requestingUrl: game, pageUrl: game, mediaTypes: ['audio'] }), false, permission);
    assert.equal(permissionCheckAllowed({ permission, requestingOrigin: 'https://bunnyhop.lol', pageUrl: game, mediaType: 'audio' }), false, permission);
  }
});

test('other origins and pages get nothing', () => {
  for (const url of ['https://discord.com/', 'https://bunnyhop.lol.evil.test/', 'http://bunnyhop.lol/', 'https://evil.test/', '', undefined]) {
    assert.equal(permissionRequestAllowed({ permission: 'media', requestingUrl: url, pageUrl: game, mediaTypes: ['audio'] }), false, String(url));
    assert.equal(permissionRequestAllowed({ permission: 'pointerLock', requestingUrl: url, pageUrl: game }), false, String(url));
    assert.equal(permissionCheckAllowed({ permission: 'media', requestingOrigin: url, pageUrl: game, mediaType: 'audio' }), false, String(url));
  }
  // A game frame inside some other page (or no page at all) may not open the microphone.
  for (const pageUrl of ['https://evil.test/', 'bunnyhop-settings://app/index.html', undefined]) {
    assert.equal(permissionRequestAllowed({ permission: 'media', requestingUrl: game, pageUrl, mediaTypes: ['audio'] }), false);
    assert.equal(permissionCheckAllowed({ permission: 'media', requestingOrigin: 'https://bunnyhop.lol', pageUrl, mediaType: 'audio' }), false);
  }
});

test('the earlier game permissions still work', () => {
  for (const permission of ['pointerLock', 'fullscreen', 'keyboardLock', 'clipboard-sanitized-write']) {
    assert.equal(permissionRequestAllowed({ permission, requestingUrl: game, pageUrl: game }), true, permission);
    assert.equal(permissionCheckAllowed({ permission, requestingOrigin: 'https://bunnyhop.lol', pageUrl: game }), true, permission);
  }
});
