import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaConstraints,
  buildPairingUrl,
  formatDuration,
  isLocalNetworkHost,
  mapCameraError,
  truncateWsCloseReason,
  validateRemotePassword,
} from './streamConfig';

test('buildMediaConstraints omits microphone permission when micEnabled is false', () => {
  const constraints = buildMediaConstraints({
    facing: 'environment',
    resolution: '1080p',
    frameRate: 60,
    micEnabled: false,
  });

  assert.equal(constraints.audio, false);
  assert.deepEqual(constraints.video, {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60, max: 60 },
  });
});

test('buildMediaConstraints enables echo-cancelled audio when micEnabled is true', () => {
  const constraints = buildMediaConstraints({
    facing: 'user',
    resolution: '720p',
    frameRate: 30,
    micEnabled: true,
  });

  assert.deepEqual(constraints.audio, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});

test('isLocalNetworkHost identifies RFC1918 LAN and loopback hosts accurately', () => {
  assert.equal(isLocalNetworkHost('127.0.0.1'), true);
  assert.equal(isLocalNetworkHost('::ffff:192.168.1.42'), true);
  assert.equal(isLocalNetworkHost('10.0.0.15'), true);
  assert.equal(isLocalNetworkHost('172.16.5.4'), true);
  assert.equal(isLocalNetworkHost('172.31.255.1'), true);
  assert.equal(isLocalNetworkHost('my-phone.local'), true);
  assert.equal(isLocalNetworkHost('172.32.0.1'), false);
  assert.equal(isLocalNetworkHost('8.8.8.8'), false);
  assert.equal(isLocalNetworkHost('example.com'), false);
});

test('validateRemotePassword enforces minimum security criteria', () => {
  assert.equal(validateRemotePassword('').valid, false);
  assert.equal(validateRemotePassword('abc').valid, false);
  assert.equal(validateRemotePassword('  secret  ').valid, false);
  assert.equal(validateRemotePassword('studio99').valid, true);
});

test('buildPairingUrl constructs phone and OBS feed URLs cleanly', () => {
  assert.equal(
    buildPairingUrl('http://192.168.1.10:3000/', 'cam42', 'phone'),
    'http://192.168.1.10:3000/?mode=phone&room=cam42',
  );
  assert.equal(
    buildPairingUrl('http://192.168.1.10:3000', 'cam42', 'feed'),
    'http://192.168.1.10:3000/?mode=feed&room=cam42',
  );
});

test('formatDuration and mapCameraError handle edge cases', () => {
  assert.equal(formatDuration(65), '01:05');
  assert.equal(formatDuration(3661), '01:01:01');
  assert.match(mapCameraError({ name: 'NotAllowedError' }), /permission was denied/i);
  assert.match(mapCameraError({ name: 'OverconstrainedError' }), /720p/i);
});

test('truncateWsCloseReason guarantees WebSocket close reason never exceeds 123 UTF-8 bytes', () => {
  const longReason =
    'This room is locked to Local Wi-Fi Only. Enable Remote Access with a password on the host to connect from outside the local network.';
  const truncated = truncateWsCloseReason(longReason);
  assert.ok(new TextEncoder().encode(truncated).length <= 123);

  const emojiReason = '🔒 '.repeat(60);
  const truncatedEmoji = truncateWsCloseReason(emojiReason);
  assert.ok(new TextEncoder().encode(truncatedEmoji).length <= 123);
});
