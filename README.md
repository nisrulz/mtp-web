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
- **Node.js:** version 18 or newer. The Node entry uses the `usb` package.
- **Development:** Node.js 22.12 or newer and Yarn 1.22.
- **Device:** unlock the device and set it to **File Transfer / MTP**. Do not
  use charging mode.

## Entry points

The package has one specifier and two entries:

- Node.js resolves the `node` condition to `src/node.js`, which loads the `usb`
  package and installs its WebUSB shim.
- A browser bundler resolves the `browser` condition to `src/mtp.js`. That file
  has no native import. It uses `navigator.usb`.

Use a bundler that supports the `exports` field, for example Vite, Rollup,
webpack 5 or esbuild.

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

Check support before you connect:

```javascript
import { isSupported } from 'mtp-web';

if (!isSupported()) {
  throw new Error('Use Chrome or Edge on a desktop computer.');
}
```

`isSupported()` returns false in Firefox and Safari, even when a WebUSB shim is
present. It also returns false when `navigator.usb.requestDevice` or
`navigator.usb.getDevices` is missing. `Mtp.isSupported()` runs the same check.

With a bundler, import the package normally. The bundler selects the browser
entry and does not resolve the native `usb` module:

```javascript
import Mtp from 'mtp-web';

document.querySelector('#connect').addEventListener('click', async () => {
  const mtp = new Mtp(vendorId, productId);
  await mtp.ready;
  await mtp.openSession();

  // Read, then call mtp.close().
});
```

For a script tag without a bundler, import the browser entry directly:

```html
<script type="module">
  import Mtp from 'https://cdn.jsdelivr.net/npm/mtp-web@0.1.0/src/mtp.js';

  // The same code as above.
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

`data` accepts a `Uint8Array`, an `ArrayBuffer`, or an `AsyncIterable` of
`Uint8Array` chunks. Add `size` for an `AsyncIterable`. Pass `onProgress` to
follow the number of bytes sent.

```javascript
await mtp.uploadFile({
  storageId,
  parentObjectHandle: 0xffffffff,
  filename: 'video.mp4',
  data: file.stream(), // AsyncIterable<Uint8Array>
  size: file.size,
  onProgress: sent => console.log(sent),
  signal: controller.signal,
});
```

The upload cannot stop cleanly after the data phase starts. An abort before the
data phase throws `AbortError`. An abort after that point also marks the
transport unhealthy.

The library sends the data-container header and the first payload bytes in one
USB transfer. It uses 512-byte OUT chunks by default. Some devices need a
zero-length packet at an aligned boundary; set `sendZeroLengthPacket: true` for
those devices.

If the folder already contains the file name, the device rejects
`SendObjectInfo` with `GeneralError`. `uploadFile()` retries with
`name (2).ext`, then `name (3).ext`, up to 10 names. It returns the object
handle. Call `getObjectInfo(handle)` to read the final file name.

### Read and write properties

Use a descriptor when you do not know the data type. The high-level method reads
the descriptor and the value.

```javascript
const { descriptor, value } = await mtp.getObjectProperty(
  handle,
  0xdc04, // object size
);
console.log(descriptor.dataType, value);

await mtp.setObjectProperty(handle, 0xdc04, 2048);
```

Device properties use the same pattern:

```javascript
const { value: battery } = await mtp.getDeviceProperty(0x5001);
```

`getObjectPropsSupported(format)` lists the object properties for a format.
`getObjectPropDesc()` and `getDevicePropDesc()` return the full descriptor.
`setObjectPropertyList()` writes several values in one command.

### Move, copy and references

```javascript
await mtp.moveObject(handle, storageId, 0); // 0 is the storage root
await mtp.copyObject(handle, storageId, folderHandle);

const referenced = await mtp.getObjectReferences(handle);
await mtp.setObjectReferences(handle, [...referenced, otherHandle]);
```

### Read device information

`getDeviceInfo()` works before `openSession()`.

```javascript
const info = await mtp.getDeviceInfo();
console.log(info.Manufacturer, info.Model, info.SerialNumber);
```

The fields follow the PTP names: `StandardVersion`, `VendorExtensionID`,
`VendorExtensionVersion`, `VendorExtensionDescription`, `FunctionalMode`,
`OperationsSupported`, `EventsSupported`, `DevicePropertiesSupported`,
`CaptureFormats`, `ImageFormats`, `Manufacturer`, `Model`, `DeviceVersion` and
`SerialNumber`.

### Read part of a file

```javascript
const bytes = await mtp.getPartial(handle, offset, length);
```

GetPartialObject64 devices disagree about the order of the offset words. The
method tries `hiFirst` first. A `ParameterNotSupported` or `InvalidParameter`
response retries with `loFirst`. The working order is cached in
`mtp.partialOrder`. `mtp.partialState` is `unknown`, `supported` or
`unsupported`. Pass `'hiFirst'` or `'loFirst'` to force the first attempt.

The method throws if both orders fail. It does not fall back to `getFile()`.

### Read a thumbnail

```javascript
const thumbnail = await mtp.getThumb(handle);
```

The result is a `Uint8Array`. A zero-byte result is valid and returns an empty
array.

### Check transport health

```javascript
if (!mtp.isTransportHealthy()) {
  await mtp.recover(); // The same USBDevice must still be connected.
}
```

`transportHealthy` starts as `true`. A USB timeout or error, an unexpected USB
status, a malformed container, or a transaction ID mismatch sets it to `false`.
After that, every command rejects with the transport-out-of-sync error. Call
`recover()` to reopen the USB transport and start a new session. Create a new
`Mtp` instance when the device was disconnected.

### Read events

```javascript
const event = await mtp.readEvent();
console.log(event.code, event.parameters);
```

The device sends events at any time. `readEvent()` returns one event container.
A timeout marks the transport unhealthy because WebUSB cannot cancel a pending
read. Call `recover()` after a timeout.

### Logging

The library logs at `silent`, `error`, `warn`, `info` or `debug`. The default is
`silent`, so logging is off until you enable it.

```javascript
const mtp = new Mtp(vendorId, productId, device, {
  logLevel: 'debug',
  logger: {
    debug: (message, context) => console.debug(message, context),
    info: (message, context) => console.info(message, context),
    warn: (message, context) => console.warn(message, context),
    error: (message, context) => console.error(message, context),
  },
});

mtp.setLogLevel('info');
console.log(mtp.getLogLevel());
```

A custom logger can omit a level. The library then stays silent at that level.
Use `debug` to see USB writes, MTP commands and responses.

### `resetUsbDevice()`

Resets the USB device directly. Use it after a stalled bulk transfer when the
phone no longer accepts data. The MTP session ends. Unplug and reconnect the
phone before the next attempt.

### TypeScript

The package includes hand-written declarations for the class, options, events,
results and helpers. The declarations cover `DeviceInfo`, `PartialOrder`,
`PartialState`, `UploadOptions`, `DevicePropDesc`, `ObjectPropDesc`,
`PropertyForm` and the upload result.

```typescript
import Mtp, { type DeviceInfo, type UploadOptions } from 'mtp-web';
```

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
