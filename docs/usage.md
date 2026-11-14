# Usage

`mtp-web` reads, uploads, deletes, moves and copies objects (files and folders)
on MTP devices. It does not provide a standalone rename command.

The reader loads one complete object into memory as a `Uint8Array`. The writer
accepts a whole buffer or an `AsyncIterable` of chunks. A whole-buffer upload
needs that much free memory. A streaming upload needs the declared size and
sends each chunk as it arrives.

## Device trust

`mtp-web` does not authenticate the device. A device can report any vendor and
product ID. Use a physical connection that you control. Confirm the device
before you upload or delete data.

## Limits

The library limits the resources that a broken or hostile device can consume.
The defaults are 512 MiB for one inbound container, 30 seconds for one idle
read, 5 minutes for one command and 100 consecutive event blocks. Pass the
limits to the constructor:

```javascript
const mtp = new Mtp(vendorId, productId, device, {
  maxContainerLength: 1024 * 1024 * 1024,
  readTimeoutMs: 30000,
  transferDeadlineMs: 300000,
  maxEventBlocks: 100,
});
```

Raise `maxContainerLength` for objects larger than 512 MiB. Raise
`transferDeadlineMs` for slow transfers. Do not raise the limits for an
untrusted device.

## Browser

WebUSB is available in Chromium-based browsers only: Chrome, Edge, Opera and
Brave. Firefox and Safari do not support it.

Two rules apply:

1. Serve the page from a secure context: `https://` or `http://localhost`.
   `http://192.168.x.x` is not a secure context.
2. Start `usb.requestDevice()` from a user gesture, for example a click. A page
   load cannot open the device picker.

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

```javascript
import Mtp from 'mtp-web';

button.addEventListener('click', async () => {
  // Opens the browser picker the first time. Later calls reuse the grant.
  const mtp = new Mtp(0x18d1, 0x4ee1);

  mtp.addEventListener('error', event => {
    console.error('MTP error:', event.error ?? event);
  });

  await mtp.ready;
  await mtp.openSession();

  const handles = await mtp.getObjectHandles();
  const objectHandle = Math.max(...handles);
  const fileName = await mtp.getFileName(objectHandle);
  const bytes = await mtp.getFile(objectHandle);

  await mtp.close();
});
```

If the page already has a `USBDevice` from `navigator.usb.getDevices()` or
`navigator.usb.requestDevice()`, pass it as the third argument. No picker opens
and the device is used as is.

```javascript
const [device] = await navigator.usb.getDevices();
const mtp = new Mtp(null, null, device);
```

## Node.js

```javascript
import Mtp from 'mtp-web';

const mtp = new Mtp(vendorId, productId);
await mtp.ready;

try {
  await mtp.openSession();
  const handles = await mtp.getObjectHandles();
  // ...
} finally {
  await mtp.close();
}
```

On Linux the device node needs write access. Add a udev rule for your vendor
and product ID. Or run the process as a user that can open the device node.

## Electron

Use the Node entry in the main process. It loads the `usb` package. The same
code works in a renderer with Node integration.

If you use a sandboxed renderer without Node integration, pass a `USBDevice`
object from the renderer. Or forward the calls to the main process. A renderer
build that honors the browser condition resolves the browser entry and uses
`navigator.usb`.

## Upload and delete

Writes go to one storage. List the storages and check the access capability
first:

```javascript
const storageIds = await mtp.getStorageIDs();
const [storageId] = storageIds;

const info = await mtp.getStorageInfo(storageId);
if (info.readOnly) {
  throw new Error(`${info.description} is read-only`);
}
```

Upload a file to the storage root. The root handle is `0xFFFFFFFF`.

```javascript
const data = new Uint8Array(await file.arrayBuffer());

const handle = await mtp.uploadFile({
  storageId,
  parentObjectHandle: 0xffffffff,
  filename: file.name,
  data,
});
```

For a large file, stream the chunks and declare the total size:

```javascript
await mtp.uploadFile({
  storageId,
  parentObjectHandle: 0xffffffff,
  filename: file.name,
  data: file.stream(), // AsyncIterable<Uint8Array>
  size: file.size,
  onProgress: sent => console.log(sent),
  signal: controller.signal,
});
```

`uploadFile()` returns the object handle of the new file. Delete the file with:

```javascript
await mtp.deleteObject(handle);
```

`deleteObject()` removes the object immediately. There is no undo and no trash.
Ask the user before you delete.

The upload sends the data-container header and the first payload bytes in one
USB transfer. It uses 512-byte OUT chunks by default. Set `writeChunkSize` to
change the chunk size. Some devices need a zero-length packet at an aligned
boundary; set `sendZeroLengthPacket: true` for those devices.

If the folder already contains the file name, the device rejects
`SendObjectInfo` with `GeneralError`. `uploadFile()` retries with
`name (2).ext`, then `name (3).ext`, up to 10 names. The returned object handle
is the new file. Call `getObjectInfo(handle)` to read the final file name.

An upload cannot stop cleanly after the data phase starts. An abort before the
data phase throws `AbortError`. An abort after that point also marks the
transport unhealthy.

Property lists read or write many metadata fields in one command.

A read-only storage rejects an upload with `StoreReadOnly`. A full storage
rejects it with `StoreFull`. Both errors arrive as `MtpResponseError`.

## Properties

`getObjectProperty()` reads the descriptor and the value. Use it when you do
not know the data type.

```javascript
const { descriptor, value } = await mtp.getObjectProperty(
  handle,
  0xdc04, // object size
);
console.log(descriptor.dataType, value);

await mtp.setObjectProperty(handle, 0xdc04, 2048);
```

Property lists read or write many metadata fields in one command:

```javascript
const { elements } = await mtp.getObjectPropertyList({ handle, depth: 0 });
const size = elements.find(
  entry => entry.propertyName === 'OBJECT_SIZE',
)?.value;
```

Device properties use the same pattern:

```javascript
const { value: battery } = await mtp.getDeviceProperty(0x5001);
```

`getObjectPropsSupported(format)` lists the object properties for a format.
`getObjectPropDesc()` and `getDevicePropDesc()` return the full descriptor.
`setObjectPropertyList()` writes several values in one command.

## Move, copy and references

```javascript
await mtp.moveObject(handle, storageId, 0); // 0 is the storage root
await mtp.copyObject(handle, storageId, folderHandle);

const referenced = await mtp.getObjectReferences(handle);
await mtp.setObjectReferences(handle, [...referenced, otherHandle]);
```

## Device information

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

## Partial reads and thumbnails

```javascript
const bytes = await mtp.getPartial(handle, offset, length);
```

GetPartialObject64 devices disagree about the order of the offset words. The
method tries `hiFirst` first. A `ParameterNotSupported` or `InvalidParameter`
response retries with `loFirst`. The working order is cached in
`mtp.partialOrder`. `mtp.partialState` is `unknown`, `supported` or
`unsupported`. Pass `'hiFirst'` or `'loFirst'` to force the first attempt.

The method throws if both orders fail. It does not fall back to `getFile()`.

`getThumb(handle)` returns a `Uint8Array`. A zero-byte result is valid and
returns an empty array.

## Transport health and recovery

```javascript
if (!mtp.isTransportHealthy()) {
  await mtp.recover(); // The same USBDevice must still be connected.
}
```

`transportHealthy` starts as `true`. A USB timeout or error, an unexpected USB
status, a malformed container, or a transaction ID mismatch sets it to `false`.
After that, every command rejects with the transport-out-of-sync error.

Call `recover()` to reopen the USB transport and start a new session. Create a
new `Mtp` instance when the device was disconnected. If a bulk transfer stalls
and the phone no longer accepts data, call `resetUsbDevice()`, unplug the cable
and reconnect the phone.

## Events

```javascript
const event = await mtp.readEvent();
console.log(event.code, event.parameters);
```

The device sends events at any time. `readEvent()` returns one event container.
A timeout marks the transport unhealthy because WebUSB cannot cancel a pending
read. Call `recover()` after a timeout.

## Logging

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

## TypeScript

The package includes hand-written declarations for the class, options, events,
results and helpers. The declarations cover `DeviceInfo`, `PartialOrder`,
`PartialState`, `UploadOptions`, `DevicePropDesc`, `ObjectPropDesc`,
`PropertyForm` and the upload result.

```typescript
import Mtp, { type DeviceInfo, type UploadOptions } from 'mtp-web';
```

## Find the vendor and product IDs

- On Linux, `lsusb` prints `ID vendor:product` for each device.
- On macOS, **System Information > USB** shows the vendor ID and product ID.
- On Windows, open **Device Manager > Portable Devices > Properties >
  Details**.

Android devices from one vendor can share IDs. If more than 1 device answers,
`getDevices()` returns all of them and the first match wins. Pass a `USBDevice`
object to select a specific device.
