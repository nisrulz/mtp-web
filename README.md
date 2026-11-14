# mtp-web

Read and write files on MTP devices over USB. Use the browser (WebUSB),
Node.js or Electron. No drivers, no Android File Transfer, no ADB.

> This fork is maintained by [Nishant Srivastava](https://github.com/nisrulz).
> The original project is [webmtp](https://github.com/tidepool-org/webmtp) by the
> Tidepool Project.

Try the [browser demo](https://nisrulz.github.io/mtp-web/). It needs a Chromium
browser and a phone in **File Transfer / MTP** mode.

## Requirements

- **Browser:** a Chromium-based browser with WebUSB. Serve the page from HTTPS
  or `localhost`.
- **Node.js:** version 18 or newer.
- **Development:** Node.js 22.12 or newer and Yarn 1.22.
- **Device:** unlock the device and set it to **File Transfer / MTP**. Do not
  use charging mode.

## Device trust

`mtp-web` does not authenticate the device. Any device that matches the vendor
and product ID can answer. Use a physical connection that you control. Do not
upload sensitive data to an untrusted device.

## Install

```bash
npm install mtp-web
```

## Quick start

### Node.js

```javascript
import Mtp from 'mtp-web';

const mtp = new Mtp(vendorId, productId);

mtp.addEventListener('error', event => {
  console.error('MTP error:', event.error ?? event);
});

try {
  await mtp.ready;
  await mtp.openSession();

  const [storageId] = await mtp.getStorageIDs();
  const handles = await mtp.getObjectHandles(storageId, 0, 0xffffffff);

  const objectHandle = Math.max(...handles);
  const fileName = await mtp.getFileName(objectHandle);
  const bytes = await mtp.getFile(objectHandle);

  console.log(fileName, bytes.byteLength);
} finally {
  await mtp.close();
}
```

Top-level `await` needs an ES module. If you do not use an ES module, put the
calls in an `async` function.

### Browser

The browser opens a device picker. The code must start from a user gesture, for
example a click. Serve the page from HTTPS or `localhost`.

```html
<script type="module">
  import Mtp from 'https://cdn.jsdelivr.net/npm/mtp-web@0.1.0/src/mtp.js';

  document.querySelector('#connect').addEventListener('click', async () => {
    const mtp = new Mtp(vendorId, productId);
    await mtp.ready;
    await mtp.openSession();

    // Read, then call mtp.close().
  });
</script>
```

Pin the package version in the URL. Change the version when you upgrade.

### Upload a file

Check the storage first. A read-only storage rejects the upload.

```javascript
const [storageId] = await mtp.getStorageIDs();
const storage = await mtp.getStorageInfo(storageId);
if (storage.readOnly) {
  throw new Error(`${storage.description} is read-only`);
}

const handle = await mtp.uploadFile({
  storageId,
  parentObjectHandle: 0xffffffff, // storage root
  filename: 'notes.txt',
  data: new TextEncoder().encode('hello from mtp-web'),
});

await mtp.deleteObject(handle); // no undo, no trash
```

The writer takes the whole file as one `ArrayBuffer` or `Uint8Array`.

## Development

```bash
make install
make check
```

`make help` lists every target. Open `_site/index.html` directly in Chromium.
`make e2e` runs the physical-device suite. `make pages` prepares the GitHub
Pages demo. The [Development](docs/development.md) guide covers the checks and
the E2E suite.

## Documentation

| Guide                                      | Contents                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| [Usage](docs/usage.md)                     | Browser, Node.js, Electron, existing `USBDevice` objects   |
| [API](docs/api.md)                         | Constructor, methods, events, errors                       |
| [Troubleshooting](docs/troubleshooting.md) | Missing device, busy interface, timeout, read-only storage |
| [Development](docs/development.md)         | Tests, demo, layout, publish steps                         |

## License

BSD-2-Clause. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This software is a fork of [webmtp](https://github.com/tidepool-org/webmtp),
Copyright (c) 2020, Tidepool Project. The original copyright notice and license
conditions apply to the original code.
