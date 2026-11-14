# Troubleshooting

## The device is not found

- Confirm the phone is unlocked and set to **File Transfer / MTP**. Charging
  mode hides the device.
- Check the vendor and product IDs. Use `lsusb` on Linux, **System Information >
  USB** on macOS, and **Device Manager** on Windows.
- Use a data cable. A charge-only cable cannot transfer data.
- In the browser, the first call opens a picker. If the user cancels, the
  promise rejects and no device is granted.
- Another page can hold the grant. Revoke it in the browser site settings.

## `Unable to claim the MTP interface`

Another process owns the interface. Close these programs and try again:

- Photos and Image Capture on macOS
- Android File Transfer and OpenMTP
- `adb` (`adb kill-server`)
- Another tab or window of the same page
- Another Electron or Node process that opened the device

The library selects the configuration that contains the MTP interface. It tries
each MTP alternate setting. It resets the device one time after a claim failure.
On macOS the system can keep the device after a crash. Unplug the device and
connect it again.

## `Only the Android Debug Bridge (ADB) interface is available`

The device exposes the ADB interface but no MTP interface. The library does not
send MTP commands to ADB. Disable USB debugging or close `adb`, then reconnect
the device. Select **File Transfer / MTP** on the phone.

## `USB transfer failed with status "stall"`

The reader clears the halt and tries one time more. A second failure means the
device rejects the request. Check that the object still exists and that the
device is still in MTP mode.

## `Timed out waiting for data from the MTP device`

The device accepts the command and stops answering. This problem occurs with a
busy or stopped device. Unplug the device, connect it again, and run the command
again. The read timeout is 30 seconds of idle time.

## `The MTP transport is out of sync after a failed transfer`

A read or write failed or timed out. A late reply can now arrive during the next
command. The library rejects commands after this error instead of reading the
wrong container. The failure sets `transportHealthy` to false. Check it with
`isTransportHealthy()`.

Use `recover()` when the device is still connected. It closes and opens the USB
transport, clears the buffered bytes, resets the transaction ID and starts a new
session. When the device was disconnected, close the `Mtp` instance and create a
new one.

## Partial reads fail with `ParameterNotSupported` or `InvalidParameter`

`getPartial()` tries the low offset word first. If the device rejects that
order, the method retries once with the high word first. The working order is
cached in `partialOrder`. `partialState` becomes `supported`.

If both orders fail, `partialState` becomes `unsupported` and the method throws
the last error. The library does not fall back to `getFile()`. Use `getFile()`
in your application when `partialState` is `unsupported`.

## A thumbnail is empty

A zero-byte thumbnail is valid. `getThumb()` returns an empty `Uint8Array`. Check
`thumbnail.byteLength` before you decode it. Do not treat an empty result as a
transfer failure.

## A browser build tries to load `usb.darwin-arm64`

The bundler resolved the Node entry. Import `mtp-web` with a bundler that
supports the `exports` field. Do not alias the package to `src/node.js`. The
browser condition resolves `src/mtp.js`, which has no native import. The default
`src/node.js` entry is for Node.js only.

## `Timed out while claiming the MTP interface` or `Timed out while opening the MTP device`

The device did not answer the setup request within 15 seconds. Close the
programs that use the device. Unplug the device and connect it again.

## `WebUSB is not available in this environment.`

- The page is not in a Chromium-based browser, or WebUSB is disabled.
- The page is not a secure context. Use `https://` or `http://localhost`.
- In Node.js, the package must resolve the `node` entry. Node ESM imports do
  this through the `exports` map. The entry installs `usb.webusb`.
- In Electron, use the Node entry in the main process. A sandboxed renderer
  without Node integration must pass a `USBDevice` object.

## `Invalid MTP container length`

The device sends a header with an impossible length. The stream is out of sync
after a failed transfer or a disconnect. Call `recover()` when the device is
still connected. Close the device and start a new `Mtp` instance after a
disconnect.

## `MTP container length ... exceeds the limit`

The device declared a container larger than `maxContainerLength`. The default
is 512 MiB. Raise the option for a legitimate large object. Disconnect an
untrusted device.

## `MTP transfer deadline exceeded`

A command did not finish within `transferDeadlineMs`. The default is 5 minutes.
Raise the option for a slow transfer. Call `recover()` when the device is still
connected. Reconnect a device that stopped answering.

## `Too many event blocks from the MTP device`

The device sent more event blocks than `maxEventBlocks` without a data or
response block. The default is 100. Reconnect the device. Do not raise the limit
for an untrusted device.

## The `usb` module fails to install or load

`usb` 3 supplies prebuilt binaries for macOS, Linux and Windows on x64 and
arm64. On another platform, or after a Node upgrade, rebuild it:

```bash
make rebuild
```

The library does not support a Node version below 18.

## An upload stops with `AbortError` or `Upload ended after ... bytes`

An `AbortSignal` stops the upload between chunks. An abort before the data phase
throws `AbortError` and keeps the transport healthy. An abort after the data
phase starts also throws `AbortError`, but the device still waits for the
declared number of bytes. The transport becomes unhealthy. Reconnect and create
a new `Mtp` instance.

A streaming source must yield exactly `size` bytes. A short source throws before
the final response and marks the transport unhealthy. Check the source length
before you start the upload.

## An upload stalls after the last byte

Some devices wait for the end of the USB transfer instead of the MTP container
length. The library sends a zero-length packet when the file size is a multiple
of the endpoint packet size. This packet ends the data phase. If the upload still
stalls, the device may be busy. Call `recover()` and try again. Do not change the
file size to work around the problem.

## `OperationNotSupported` from a property or control command

The device does not implement the command. Read `OperationsSupported` from
`getDeviceInfo()` before you call a command. A phone usually supports object
properties and references but can omit device properties, capture and
`formatStore()`.

## `readEvent()` times out

The device did not send an event before the timeout. WebUSB cannot cancel the
pending read, so the transport is now out of sync. Call `recover()` before the
next command. Use `readEvent()` only when the device is expected to send an
event.

## `Timed out waiting for the MTP device to accept data`

The phone's bulk OUT endpoint stopped accepting bytes. The library sends the
data-container header and the first payload bytes in one transfer and uses
512-byte chunks. If the timeout still occurs, the device is stalled. The library
clears the OUT halt. Call `resetUsbDevice()`, unplug the USB cable, reconnect the
phone and connect again. Enable `logLevel: 'debug'` to see the last successful
USB write and MTP command.

## The phone stays stuck after a failed upload

A pending WebUSB transfer cannot be cancelled. A page refresh does not always
release the phone's endpoint. Call `resetUsbDevice()`, unplug the USB cable,
reconnect the phone, then connect again. The demo shows these steps in its
**Connection log** panel.

## Upload fails for a file above 4 GiB

The SendObjectInfo ObjectInfo size field is 32 bits. `uploadFile()` rejects a
larger file before it sends data. Split the file, or use a tool that supports a
64-bit object size.

## Upload fails with `StoreReadOnly`

The storage does not accept writes. Call `getStorageInfo(storageId)` first and
check `readOnly`. A phone can have a read-only internal storage and a writable
SD card. Select the writable storage.

## Upload fails with `StoreFull`

The storage has no free space. Check `freeSpaceInBytes` from
`getStorageInfo()` and the size of the file.

## `Uploaded object "name" was not found in the parent folder.`

The device does not return the new object handle in the SendObjectInfo
response. The follow-up listing does not show the file either. The device can
reject the object. Or it can list the new file only after a reconnect. Check the
parent handle and the storage ID. Then list the folder again.

## Delete fails with `AccessDenied` or `ObjectWriteProtected`

The object or the storage is write-protected. Read the storage access capability
with `getStorageInfo()`. A read-only-with-delete storage permits deletes. A
read-only storage does not.

## No device on Linux

The device node needs write access. Add a udev rule for your vendor and product
ID. Then reload the rules:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/99-mtp-web.rules
sudo udevadm control --reload-rules
```

Adjust the vendor ID. Connect the device again after the rules load. The
`uaccess` tag grants access to the active local user. Do not use `MODE="0666"`.
It grants access to every local user.
