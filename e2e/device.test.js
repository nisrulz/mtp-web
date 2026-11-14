import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import puppeteer from 'puppeteer';

import { startServer } from './server.js';

const VENDOR_ID = parseHex(process.env.E2E_VENDOR_ID, 0x04e8);
const PRODUCT_ID = parseHex(process.env.E2E_PRODUCT_ID, null);
const DEVICE_NAME = (process.env.E2E_DEVICE_NAME ?? 'samsung').toLowerCase();
const HEADLESS = process.env.E2E_HEADLESS === '1';
const REQUIRE_WRITE = process.env.E2E_REQUIRE_WRITE === '1';
const PROMPT_TIMEOUT = Number(process.env.E2E_TIMEOUT_MS ?? 30000);
const OPERATION_TIMEOUT = Number(
  process.env.E2E_OPERATION_TIMEOUT_MS ?? 120000,
);
const ARTIFACT_DIR = new URL('./artifacts/', import.meta.url);
const MAX_READ_BYTES = 2 * 1024 * 1024;

let browser;
let page;
let cdp;
let server;
let baseUrl;
let createdHandles = [];
const pageLogs = [];

function parseHex(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  return Number.parseInt(value.replace(/^0x/i, ''), 16);
}

function guard(message) {
  return (
    `\n\n${message}\n\nCheck these items:\n` +
    '- Unlock the device.\n' +
    '- Set the USB mode to File Transfer / MTP.\n' +
    '- Close Android File Transfer, OpenMTP, Smart Switch and adb.\n' +
    '- Connect a data cable. A charge-only cable cannot transfer data.\n'
  );
}

function call(method, argument) {
  return page.evaluate(
    (name, value) => window.e2e[name](value),
    method,
    argument,
  );
}

async function upload(storageId, filename, data) {
  const handle = await call('upload', {
    storageId,
    parentObjectHandle: 0xffffffff,
    filename,
    dataBase64: data.toString('base64'),
  });

  assert.equal(Number.isInteger(handle), true, 'uploadFile returns a handle');
  createdHandles.push(handle);
  return handle;
}

async function deleteCreated() {
  for (const handle of [...createdHandles].reverse()) {
    try {
      await call('remove', handle);
      createdHandles = createdHandles.filter(candidate => candidate !== handle);
    } catch {
      // The device may already be gone or the handle may already be deleted.
    }
  }
}

async function readExistingObject(storageId) {
  const handles = await call('handles', {
    storageId,
    parent: 0xffffffff,
  });

  const objects = [];
  for (const handle of handles.slice(0, 20)) {
    const info = await call('info', handle);
    if (info.format !== 0x3001) {
      objects.push(info);
    }
  }

  return objects.sort((left, right) => left.size - right.size)[0];
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForState(timeout = OPERATION_TIMEOUT) {
  const deadline = Date.now() + timeout;

  for (;;) {
    const state = await page.evaluate(
      () => window.e2e?.state ?? { status: 'loading', error: null },
    );

    if (state.status === 'connected' || state.status === 'failed') {
      return state;
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the device to open.');
    }

    await sleep(100);
  }
}

async function waitForPromptDevices(event) {
  if (event.devices.length > 0) {
    return event;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cdp.off('DeviceAccess.deviceRequestPrompted', onPrompt);
      reject(new Error('The WebUSB prompt did not list a device.'));
    }, PROMPT_TIMEOUT);

    function onPrompt(next) {
      if (next.id === event.id && next.devices.length > 0) {
        clearTimeout(timer);
        cdp.off('DeviceAccess.deviceRequestPrompted', onPrompt);
        resolve(next);
      }
    }

    cdp.on('DeviceAccess.deviceRequestPrompted', onPrompt);
  });
}
before(async () => {
  const started = await startServer();
  server = started.server;
  baseUrl = `http://127.0.0.1:${started.port}`;

  browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--enable-features=WebUSB'],
    defaultViewport: { width: 1280, height: 800 },
  });

  page = await browser.newPage();
  page.setDefaultTimeout(PROMPT_TIMEOUT);
  cdp = await page.createCDPSession();
  await cdp.send('DeviceAccess.enable').catch(() => {});
  page.on('console', message => {
    pageLogs.push(`[${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', error => {
    pageLogs.push(`[pageerror] ${error.message}`);
  });

  await page.goto(`${baseUrl}/e2e/fixture.html`, { waitUntil: 'load' });
  await page.evaluate(config => window.e2e.configure(config), {
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
  });
});

after(async () => {
  if (page) {
    await page.evaluate(() => window.e2e.close()).catch(() => {});
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (server) {
    await new Promise(resolvePromise => server.close(resolvePromise));
  }
});

test(
  'physical Samsung device over WebUSB',
  { timeout: OPERATION_TIMEOUT },
  async t => {
    let failure;
    let connected = false;

    try {
      await t.test('connects through WebUSB', async () => {
        let promptEvent = null;
        const onPrompt = event => {
          promptEvent = event;
        };
        cdp.on('DeviceAccess.deviceRequestPrompted', onPrompt);

        await page.click('#connect');
        let state = await page.evaluate(
          () => window.e2e?.state ?? { status: 'loading', error: null },
        );
        const deadline = Date.now() + OPERATION_TIMEOUT;

        while (
          !promptEvent &&
          state.status !== 'connected' &&
          state.status !== 'failed'
        ) {
          if (Date.now() > deadline) {
            throw new Error(
              'Timed out waiting for the WebUSB prompt or the device.' +
                guard('Chrome must list the Samsung device in the picker.'),
            );
          }
          await sleep(100);
          state = await page.evaluate(
            () => window.e2e?.state ?? { status: 'loading', error: null },
          );
        }

        cdp.off('DeviceAccess.deviceRequestPrompted', onPrompt);

        if (promptEvent && state.status !== 'connected') {
          const prompt = await waitForPromptDevices(promptEvent);
          const names = prompt.devices.map(device => device.name);
          t.diagnostic(`Device prompt: ${names.join(', ') || '(empty)'}`);

          const device =
            prompt.devices.find(candidate =>
              candidate.name.toLowerCase().includes(DEVICE_NAME),
            ) ?? prompt.devices[0];

          if (!device) {
            throw new Error(
              'The WebUSB prompt did not list a matching device.' +
                guard(`Expected a device name that contains "${DEVICE_NAME}".`),
            );
          }

          await cdp.send('DeviceAccess.selectPrompt', {
            id: prompt.id,
            deviceId: device.id,
          });
          state = await waitForState();
        }

        if (state.status !== 'connected') {
          throw new Error(
            `The browser could not open the device: ${state.error}` +
              guard('The MTP interface must be free and the phone unlocked.'),
          );
        }

        t.diagnostic(
          `Connected: ${state.device.productName} ` +
            `(${state.device.vendorId.toString(16)}:` +
            `${state.device.productId.toString(16)})`,
        );
        connected = true;
      });

      if (!connected) {
        return;
      }

      const { ids, infos } = await call('storages');
      assert.ok(ids.length > 0, 'the device reports at least one storage');

      const writable = infos.find(info => info.accessCapability === 1);
      const storage = writable ?? infos[0];
      const storageId = storage.storageId;

      if (!writable) {
        const message =
          'The storage is read-only. Unlock the phone to run the ' +
          'upload and delete tests. Set E2E_REQUIRE_WRITE=1 to fail instead.';
        t.diagnostic(message);
        if (REQUIRE_WRITE) {
          assert.fail(guard(message));
        }
      }

      t.diagnostic(
        `Storage: ${storage.description || storage.volumeLabel} ` +
          `(${storageId}), ${storage.freeSpaceInBytes} bytes free, ` +
          `${writable ? 'read-write' : 'read-only'}`,
      );

      await t.test('reads the storage listing', async () => {
        const handles = await call('handles', {
          storageId,
          parent: 0xffffffff,
        });
        const count = await call('count', {
          storageId,
          parent: 0xffffffff,
        });

        assert.equal(Array.isArray(handles), true);
        assert.equal(typeof count, 'number');
        assert.ok(count >= handles.length);
      });

      await t.test('reads an existing object', async t => {
        const object = await readExistingObject(storageId);

        if (!object) {
          t.skip('The storage has no object to read.');
          return;
        }

        assert.equal(await call('fileName', object.handle), object.filename);

        const properties = await call('properties', object.handle);
        assert.equal(Array.isArray(properties.elements), true);

        if (object.size > 0 && object.size <= MAX_READ_BYTES) {
          const downloaded = Buffer.from(
            await call('download', object.handle),
            'base64',
          );
          assert.equal(downloaded.length, object.size);
        }
      });

      const prefix = `mtp-web-e2e-${Date.now()}`;
      const writableTest = !writable ? 'No read-write storage.' : false;
      let countBefore = 0;

      if (writable) {
        countBefore = await call('count', {
          storageId,
          parent: 0xffffffff,
        });
      }

      await t.test(
        'uploads and downloads a small file',
        { skip: writableTest },
        async () => {
          const name = `${prefix}-small.txt`;
          const data = randomBytes(2048);
          const handle = await upload(storageId, name, data);

          assert.equal(await call('fileName', handle), name);

          const info = await call('info', handle);
          assert.equal(info.filename, name);
          assert.equal(info.size, data.length);

          const downloaded = Buffer.from(
            await call('download', handle),
            'base64',
          );
          assert.deepEqual(downloaded, data);

          const handles = await call('handles', {
            storageId,
            parent: 0xffffffff,
          });
          assert.ok(handles.includes(handle));

          const countAfter = await call('count', {
            storageId,
            parent: 0xffffffff,
          });
          assert.ok(countAfter > countBefore);

          const properties = await call('properties', handle);
          assert.equal(Array.isArray(properties.elements), true);

          if (properties.elements.length > 0) {
            const fileName = properties.elements.find(
              element => element.property === 0xdc07,
            );
            const objectSize = properties.elements.find(
              element => element.property === 0xdc04,
            );

            if (fileName) {
              assert.equal(fileName.value, name);
            }
            if (objectSize) {
              assert.equal(Number(objectSize.value), data.length);
            }
          }
        },
      );

      await t.test(
        'uploads a file that spans several USB chunks',
        { skip: writableTest },
        async () => {
          const name = `${prefix}-chunked.bin`;
          const data = randomBytes(64 * 1024 * 2 + 123);
          const handle = await upload(storageId, name, data);

          const info = await call('info', handle);
          assert.equal(info.size, data.length);

          const downloaded = Buffer.from(
            await call('download', handle),
            'base64',
          );
          assert.deepEqual(downloaded, data);
        },
      );

      await t.test(
        'uploads and downloads an empty file',
        { skip: writableTest },
        async () => {
          const name = `${prefix}-empty.bin`;
          const handle = await upload(storageId, name, Buffer.alloc(0));

          const info = await call('info', handle);
          assert.equal(info.size, 0);

          const downloaded = Buffer.from(
            await call('download', handle),
            'base64',
          );
          assert.equal(downloaded.length, 0);
        },
      );

      await t.test(
        'uploads and reads a non-ASCII filename',
        { skip: writableTest },
        async () => {
          const name = `${prefix}-café-中.txt`;
          const data = Buffer.from('hello from mtp-web e2e');
          const handle = await upload(storageId, name, data);

          assert.equal(await call('fileName', handle), name);

          const downloaded = Buffer.from(
            await call('download', handle),
            'base64',
          );
          assert.deepEqual(downloaded, data);
        },
      );

      await t.test(
        'deletes only the objects that this run created',
        { skip: writableTest },
        async () => {
          const deleted = [...createdHandles];

          for (const handle of deleted) {
            await call('remove', handle);
            createdHandles = createdHandles.filter(
              candidate => candidate !== handle,
            );
            await assert.rejects(
              () => call('info', handle),
              /MTP command failed|InvalidObjectHandle/i,
            );
          }

          const handles = await call('handles', {
            storageId,
            parent: 0xffffffff,
          });

          for (const handle of deleted) {
            assert.equal(handles.includes(handle), false);
          }
        },
      );

      await t.test('closes the session and the device', async () => {
        await call('close');
        const state = await page.evaluate(() => window.e2e.state);
        assert.equal(state.status, 'closed');
      });
    } catch (error) {
      failure = error;
    } finally {
      if (createdHandles.length > 0) {
        await deleteCreated();
      }

      if (failure) {
        await mkdir(ARTIFACT_DIR, { recursive: true });
        const path = new URL(
          `failure-${new Date().toISOString().replaceAll(':', '-')}.png`,
          ARTIFACT_DIR,
        );
        await page.screenshot({ path }).catch(() => {});
        if (pageLogs.length > 0) {
          t.diagnostic(`Page log:\n${pageLogs.join('\n')}`);
        }
      }
    }

    if (failure) {
      throw failure;
    }
  },
);
