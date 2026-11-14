import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('usb 3.x exposes the WebUSB shim used by the library', async () => {
  const { version } = require('usb/package.json');
  const usb = await import('usb');

  assert.equal(
    version,
    '3.3.0',
    'The usb version changed. Run the hardware smoke test and review this test.',
  );
  assert.ok(usb.webusb instanceof usb.WebUSB);
  assert.equal(typeof usb.webusb.getDevices, 'function');
  assert.equal(typeof usb.webusb.requestDevice, 'function');
});

test('the WebUSB shim keeps the methods that the library calls', async () => {
  const { WebUSB } = await import('usb');
  const shim = new WebUSB({ allowAllDevices: true });

  for (const method of [
    'getDevices',
    'requestDevice',
    'addEventListener',
    'removeEventListener',
  ]) {
    assert.equal(typeof shim[method], 'function', `usb.WebUSB.${method}`);
  }
});
