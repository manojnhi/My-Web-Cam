import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from './sessionStore';

test('SessionStore defaults rooms to local-only mode and blocks external peers', () => {
  const store = new SessionStore();
  const room = store.getOrCreateRoom('cam101');
  assert.equal(room.networkMode, 'local-only');
  assert.equal(room.remotePasswordConfigured, false);

  assert.equal(store.canJoinPeer('cam101', '192.168.1.25').allowed, true);
  const remoteCheck = store.canJoinPeer('cam101', '203.0.113.10');
  assert.equal(remoteCheck.allowed, false);
  if (!remoteCheck.allowed) {
    assert.equal(remoteCheck.requiresPassword, false);
  }
});

test('SessionStore requires a valid password before enabling remote access and enforces verification', () => {
  const store = new SessionStore();
  const badEnable = store.enableRemoteAccess('cam101', '123');
  assert.equal(badEnable.ok, false);

  const okEnable = store.enableRemoteAccess('cam101', 'cam-pass-99');
  assert.equal(okEnable.ok, true);

  const noPass = store.canJoinPeer('cam101', '203.0.113.10');
  assert.equal(noPass.allowed, false);
  if (!noPass.allowed) {
    assert.equal(noPass.requiresPassword, true);
  }

  const wrongPass = store.canJoinPeer('cam101', '203.0.113.10', 'wrong-pass');
  assert.equal(wrongPass.allowed, false);

  const validPass = store.canJoinPeer('cam101', '203.0.113.10', 'cam-pass-99');
  assert.equal(validPass.allowed, true);

  const reverted = store.disableRemoteAccess('cam101');
  assert.equal(reverted.networkMode, 'local-only');
  assert.equal(reverted.remotePasswordConfigured, false);
});

test('SessionStore handles phone disconnect gracefully as reconnecting when stream was active', () => {
  const store = new SessionStore();
  store.setPhonePresence('cam101', true);
  store.updateStreamState('cam101', {
    streamActive: true,
    connectionState: 'live',
    settings: { resolution: '1080p', frameRate: 60, micEnabled: true },
  });

  const disconnected = store.setPhonePresence('cam101', false);
  assert.equal(disconnected.phoneConnected, false);
  assert.equal(disconnected.streamActive, false);
  assert.equal(disconnected.connectionState, 'reconnecting');
});
