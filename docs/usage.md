# Usage

`mtp-web` reads, uploads and deletes objects (files and folders) on MTP
devices. It does not rename or move them.

The reader loads one complete object into memory as a `Uint8Array`. The writer
takes the whole file as one buffer. Large objects need that much free memory.

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

Electron reports a browser user agent that contains `Electron/`. Thus `mtp-web`
uses the `usb` package and not `navigator.usb`. The same code works in the main
process and in a renderer with Node integration.

If you use a sandboxed renderer without Node integration, pass a `USBDevice`
object from the renderer. Or forward the calls to the main process.

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

`uploadFile()` returns the object handle of the new file. Delete the file with:

```javascript
await mtp.deleteObject(handle);
```

`deleteObject()` removes the object immediately. There is no undo and no trash.
Ask the user before you delete.

Property lists read or write many metadata fields in one command:

```javascript
const { elements } = await mtp.getObjectPropertyList({ handle, depth: 0 });
const size = elements.find(
  entry => entry.propertyName === 'OBJECT_SIZE',
)?.value;
```

A read-only storage rejects an upload with `StoreReadOnly`. A full storage
rejects it with `StoreFull`. Both errors arrive as `MtpResponseError`.

## Find the vendor and product IDs

- On Linux, `lsusb` prints `ID vendor:product` for each device.
- On macOS, **System Information > USB** shows the vendor ID and product ID.
- On Windows, open **Device Manager > Portable Devices > Properties >
  Details**.

Android devices from one vendor can share IDs. If more than 1 device answers,
`getDevices()` returns all of them and the first match wins. Pass a `USBDevice`
object to select a specific device.
