# API

```javascript
import Mtp, {
  buildContainerPacket,
  decodeMtpString,
  MtpResponseError,
  parseContainerPacket,
} from 'mtp-web';
```

## Constructor

```javascript
const mtp = new Mtp(vendorId, productId, device, options);
```

| Parameter   | Type        | Required                    | Description                                                                                   |
| ----------- | ----------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `vendorId`  | `number`    | yes, unless `device` is set | USB vendor ID, for example `0x18d1`.                                                          |
| `productId` | `number`    | no                          | USB product ID. When `null`, any device from that vendor matches.                             |
| `device`    | `USBDevice` | no                          | Skip discovery and use this device. `vendorId` and `productId` must then be `null` or absent. |
| `options`   | `object`    | no                          | Resource limits. See the table below.                                                         |

| Option                 | Type      | Default     | Description                                                                |
| ---------------------- | --------- | ----------- | -------------------------------------------------------------------------- |
| `maxContainerLength`   | `number`  | `536870912` | Largest accepted inbound container in bytes. The default is 512 MiB.       |
| `readTimeoutMs`        | `number`  | `30000`     | Idle timeout for one USB read in milliseconds.                             |
| `transferDeadlineMs`   | `number`  | `300000`    | Total deadline for one command in milliseconds. The default is 5 minutes.  |
| `maxEventBlocks`       | `number`  | `100`       | Maximum consecutive event blocks before the command fails.                 |
| `logLevel`             | `string`  | `'silent'`  | `silent`, `error`, `warn`, `info` or `debug`. Logging is off by default.   |
| `logger`               | `object`  | `console`   | Custom `debug`, `info`, `warn` and `error` functions.                      |
| `writeChunkSize`       | `number`  | `512`       | USB OUT payload chunk size. Use `512` for the widest device compatibility. |
| `sendZeroLengthPacket` | `boolean` | `false`     | Send a zero-length packet when a data phase ends on a packet boundary.     |

An invalid limit throws `RangeError`.

The constructor returns immediately and opens the device in the background. Use
the `ready` promise or the `ready` event before the first call.

The Node.js entry imports the `usb` package and installs its WebUSB shim with
`setUsbTransport()`. The browser entry uses `navigator.usb` and never resolves
the native module. A caller that passes a `USBDevice` does not need a transport
for discovery.

The library does not authenticate the device. Any device that matches the
vendor and product ID can answer. Use a physical connection that you control.
Do not upload sensitive data to an untrusted device.

## Properties

| Property           | Type                                        | Description                                                                                                |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ready`            | `Promise<Mtp>`                              | Resolves with the instance when the device is open and the interface is claimed. Rejects on a setup error. |
| `state`            | `string`                                    | `initializing`, `open` or `closed`.                                                                        |
| `device`           | `USBDevice \| null`                         | The open device. `null` after `close()`.                                                                   |
| `usbconfig`        | `object \| null`                            | Interface number, alternate setting, endpoint numbers and packet sizes in use.                             |
| `sessionOpen`      | `boolean`                                   | True after `openSession()` succeeds and before `closeSession()`.                                           |
| `transactionID`    | `number`                                    | Next MTP transaction ID. `openSession()` sets it to 0.                                                     |
| `lastError`        | `Error \| null`                             | The error that the last `error` event carried.                                                             |
| `transportHealthy` | `boolean`                                   | False after a USB or protocol failure desynchronizes the transport. Starts as `true`.                      |
| `partialOrder`     | `'hiFirst' \| 'loFirst' \| null`            | The offset order that `getPartial()` proved or cached.                                                     |
| `partialState`     | `'unknown' \| 'supported' \| 'unsupported'` | The result of the partial-read order negotiation.                                                          |

## Methods

The MTP command methods send commands one at a time. A call that arrives during
another call waits for the first call to finish.

### `isSupported(navigatorLike?)`

Returns `boolean`: true when the browser has `navigator.usb.requestDevice` and
`navigator.usb.getDevices`, and is not Firefox or Safari. Firefox and Safari
return false even when a WebUSB shim is present. `Mtp.isSupported()` runs the
same check. The optional argument is for tests and server-side checks.

### `openSession()`

Opens an MTP session. If the device answers `SessionAlreadyOpen`, the method
closes the old session and tries one time more. A session that a crashed tab or
a closed terminal left open does not block the next run.

Returns the response container.

### `closeSession()`

Closes the MTP session. The USB device stays open. The method does nothing when
the device is not open. The command sends no parameters. It accepts
`SessionNotOpen`.

### `getDeviceInfo()`

Returns `Promise<DeviceInfo>`: the PTP DeviceInfo dataset. The command works
before `openSession()`. The fields follow the PTP names: `StandardVersion`,
`VendorExtensionID`, `VendorExtensionVersion`, `VendorExtensionDescription`,
`FunctionalMode`, `OperationsSupported`, `EventsSupported`,
`DevicePropertiesSupported`, `CaptureFormats`, `ImageFormats`, `Manufacturer`,
`Model`, `DeviceVersion` and `SerialNumber`.

### Device properties

| Method                                          | Returns                         | Description                                                                           |
| ----------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| `getDevicePropDesc(property)`                   | `Promise<DevicePropDesc>`       | Reads the descriptor: data type, get/set flag, default value, current value and form. |
| `getDevicePropValue(property, datatype)`        | `Promise<unknown>`              | Reads one value when you know its data type.                                          |
| `setDevicePropValue(property, value, datatype)` | `Promise<Container>`            | Writes one value.                                                                     |
| `resetDevicePropValue(property)`                | `Promise<Container>`            | Restores the factory default.                                                         |
| `getDeviceProperty(property)`                   | `Promise<DevicePropertyResult>` | Reads the descriptor and the value in one call.                                       |
| `setDeviceProperty(property, value, datatype?)` | `Promise<Container>`            | Writes a value. Reads the data type from the descriptor when you omit it.             |

Use `DEVICE_PROPERTY` for common property codes, for example `BATTERY_LEVEL` and
`DEVICE_FRIENDLY_NAME`. A property descriptor has `dataType`, `getSet`,
`defaultValue`, `currentValue`, `formFlag` and `form`. The form is `range`,
`enumeration`, `dateTime`, `fixedLengthArray`, `regularExpression`, `byteArray`,
`longString` or `null`.

### `getObjectHandles(storageId?, format?, parent?)`

Returns `Promise<number[]>`: the object handles for one storage, format and
parent folder. The default values are all storages, all formats and the storage
root.

### `getStorageIDs()`

Returns `Promise<number[]>`: the storage IDs on the device. The result has no
names. Use `getStorageInfo()` for a name.

### `getStorageInfo(storageId)`

Returns a description of one storage.

| Field                | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `storageId`          | The storage ID from `getStorageIDs()`.                    |
| `storageType`        | MTP storage type code.                                    |
| `filesystemType`     | MTP filesystem type code.                                 |
| `accessCapability`   | `0` read-write, `1` read-only, `2` read-only with delete. |
| `readOnly`           | True unless `accessCapability` is read-write.             |
| `maxCapacity`        | Total size in bytes.                                      |
| `freeSpaceInBytes`   | Free space in bytes.                                      |
| `freeSpaceInObjects` | Free object slots.                                        |
| `description`        | Human-readable storage name.                              |
| `volumeLabel`        | Volume label. The value can be empty.                     |

### `getNumObjects(storageId, format?, parent?)`

Returns `Promise<number>`: the object count in a storage or folder.

### Storage and device control

| Method                                      | Description                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `formatStore(storageId, filesystemType?)`   | Formats a storage. This erases every object in the storage.                      |
| `resetDevice()`                             | Sends ResetDevice. The session ends. Create a new instance after reconnect.      |
| `selfTest()`                                | Runs the device self-test.                                                       |
| `setObjectProtection(objectHandle, status)` | Sets the write-protection flag. `0` is none, `1` is read-only.                   |
| `initiateCapture(storageId, format?)`       | Starts a still-image capture.                                                    |
| `initiateOpenCapture(storageId, format?)`   | Starts an open capture. End it with `terminateOpenCapture()`.                    |
| `terminateOpenCapture(transactionId)`       | Ends an open capture.                                                            |
| `powerDown()`                               | Powers down the device. The session ends. Create a new instance after reconnect. |

`formatStore()` and `setObjectProtection()` change the device. Confirm the
action with the user before you call them.

### `getObjectInfo(objectHandle)`

Returns the ObjectInfo dataset. The dataset has `handle`, `storageId`,
`format`, `protectionStatus`, `size`, `parent`, `associationType`,
`associationDescription`, `sequenceNumber`, `filename`, `dateCreated`,
`dateModified` and `keywords`. The dates are MTP date strings.

### `getObjectPropertyList(options?)`

Reads many properties in one command. The options are `handle` (`0xFFFFFFFF`
for every object), `format`, `property` (`0xFFFFFFFF` for every property) and
`depth`. The method sends the required group code `0`.

Returns `{ count, elements }`. Each element has `handle`, `property`,
`propertyName`, `datatype` and `value`. The method returns 64-bit values as
`BigInt`. It decodes strings from UTF-16LE. It decodes array data types as
JavaScript arrays.

### Object property descriptors and values

| Method                                                        | Returns                         | Description                                                                            |
| ------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `getObjectPropsSupported(format)`                             | `Promise<number[]>`             | Lists the property codes that one object format supports.                              |
| `getObjectPropDesc(property, format)`                         | `Promise<ObjectPropDesc>`       | Reads the descriptor, including the data type and form.                                |
| `getObjectPropValue(objectHandle, property, datatype)`        | `Promise<unknown>`              | Reads one value when you know its data type.                                           |
| `setObjectPropValue(objectHandle, property, value, datatype)` | `Promise<Container>`            | Writes one value.                                                                      |
| `getObjectProperty(objectHandle, property, format?)`          | `Promise<ObjectPropertyResult>` | Reads the descriptor and the value. Reads the format from ObjectInfo when you omit it. |
| `setObjectProperty(objectHandle, property, value, options?)`  | `Promise<Container>`            | Writes a value. The options are `datatype` and `format`.                               |
| `setObjectPropertyList(entries)`                              | `Promise<Container>`            | Writes several property values in one command.                                         |

An object property descriptor has `objectPropertyCode`, `dataType`, `getSet`,
`defaultValue`, `groupCode`, `formFlag` and `form`.

### Object references

`getObjectReferences(objectHandle)` returns `Promise<number[]>`: the handles
that one object references. `setObjectReferences(objectHandle, handles)`
replaces the list and returns the response container.

### Move and copy

`moveObject(objectHandle, storageId, parentObjectHandle?)` moves one object.
`copyObject(objectHandle, storageId, parentObjectHandle?)` copies one object.
Both return the response container. Pass `0` for the storage root parent.

### `sendObjectPropertyList(storageId, parentObjectHandle, format, entries, size?)`

Writes metadata for a new object. Use it before or instead of `uploadFile()`.
An item in `entries` has the shape `{ handle?, property, datatype, value }`.
The `size` argument is the 64-bit object size in bytes and defaults to `0`.
Pass a `BigInt` for a size above `Number.MAX_SAFE_INTEGER`. The method sends the
high and low 32-bit size parameters and sets every entry handle to `0`, as the
MTP specification requires. Returns the response container.

### `uploadFile(options)`

Uploads one object. The options are `storageId`, `parentObjectHandle`,
`filename`, `data`, `format`, `dateCreated`, `dateModified`, `size`,
`onProgress` and `signal`.

`data` accepts a `Uint8Array`, an `ArrayBuffer`, or an `AsyncIterable` of
`Uint8Array` chunks. The method derives the size from a byte buffer. An
`AsyncIterable` needs an explicit `size`.

The ObjectInfo size field is 32 bits. `uploadFile()` rejects a larger object
before it sends data.

The method sends the data-container header and the first payload bytes in one
USB transfer. It writes 512-byte OUT chunks by default. Set `writeChunkSize` to
change the chunk size. Some devices need a zero-length packet at an aligned
boundary; set `sendZeroLengthPacket: true` for those devices.

The method calls `onProgress(sent)` after each chunk with the total bytes sent.

If the folder already contains the file name, the device rejects
`SendObjectInfo` with `GeneralError`. The method retries with `name (2).ext`,
then `name (3).ext`, up to 10 names. It returns the object handle. Call
`getObjectInfo(handle)` to read the final file name.
It checks `signal` between chunks and throws an `AbortError`. An upload cannot
stop cleanly after the data phase starts. An abort at that point marks the
transport unhealthy.

Returns `Promise<number>`: the object handle of the new file. A device can omit
the handle in the SendObjectInfo response. In this case, the method finds the
handle in the parent folder by file name.

The device rejects a read-only storage with `StoreReadOnly`. It rejects a full
storage with `StoreFull`.

### `getThumb(objectHandle)`

Returns `Promise<Uint8Array>`: the thumbnail for one object. A zero-byte
thumbnail is valid and returns an empty array.

### `getPartial(objectHandle, offset, length, order?)`

Returns `Promise<Uint8Array>`: part of one object with GetPartialObject64. The
`offset` is a non-negative safe integer and is split into high and low 32-bit
words. `length` must fit in an unsigned 32-bit value. `order` is `'hiFirst'` or
`'loFirst'`. The method uses the cached order, then `'loFirst'`.

A `ParameterNotSupported` or `InvalidParameter` response retries one time with
the other order. The working order is cached in `partialOrder` and
`partialState` becomes `supported`. If both orders fail, the method sets
`partialState` to `unsupported` and throws the last error. It does not fall back
to `getFile()`.

### `getPartialObject(objectHandle, offset, length)`

Returns `Promise<Uint8Array>`: part of one object with the 32-bit
GetPartialObject command. Use `getPartial()` when the offset can exceed 4 GiB.
The parameters must fit in an unsigned 32-bit value.

### `isTransportHealthy()`

Returns `boolean`: the value of `transportHealthy`. A USB timeout or error, an
unexpected USB status, a malformed container, or a transaction ID mismatch sets
the value to false. After that, every command rejects with the
transport-out-of-sync error.

### `setLogLevel(level)`

Sets the log threshold: `silent`, `error`, `warn`, `info` or `debug`. The
default is `silent`.

### `getLogLevel()`

Returns the current log threshold.

### `recover()`

Reopens the USB transport and starts a new MTP session. Use it after a
transport failure when the same `USBDevice` is still connected. It clears the
buffered bytes and resets the transaction ID. It rejects with a clear error when
the device is gone. Create a new `Mtp` instance when the device was
disconnected.

### `resetUsbDevice()`

Resets the USB device directly. Use it after a stalled bulk transfer when the
phone no longer accepts data. The MTP session ends and the transport becomes
unhealthy. Unplug and reconnect the phone before the next attempt.

### `readEvent(timeoutMs?)`

Returns `Promise<Container>`: one MTP event container. `timeoutMs` defaults to
`transferDeadlineMs`. Use this method only when the device is expected to send
an event. WebUSB cannot cancel a pending read, so a timeout marks the transport
unhealthy. Use `recover()` after a timeout.

### `deleteObject(objectHandle)`

Deletes one object, or one folder and its contents. Returns the response
container. You cannot undo this operation.

### `getFileName(handle)`

Returns `Promise<string>`: the object file name for one handle. The method
decodes the name from the MTP UTF-16LE string. It returns `''` for an empty or
zero-length name.

### `getFile(handle, fileName?)`

Returns `Promise<Uint8Array>`: the complete object. The method keeps the second
argument for compatibility and does not use it.

### `close()`

Closes the session, releases the interface and closes the device. It is safe to
call when the device is gone. It waits for a command that is already running.
Calling it again returns the same promise. It emits `close` one time.

## Events

| Event   | Detail                                  | When                                                                         |
| ------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `ready` | none                                    | The device is open, the configuration is selected, the interface is claimed. |
| `error` | `ErrorEvent` with `error` and `message` | Setup fails, or `ready` rejects.                                             |
| `close` | none                                    | `close()` completes.                                                         |

`error` is an `ErrorEvent` where the runtime supplies one.

## Errors

A response code other than `OK` rejects with `MtpResponseError`:

| Field           | Description                                              |
| --------------- | -------------------------------------------------------- |
| `name`          | `MtpResponseError`                                       |
| `message`       | `MTP command <operation> failed: <code name> (0x<code>)` |
| `operation`     | Operation name, for example `DeleteObject`, or `null`.   |
| `code`          | Response code name, for example `AccessDenied`.          |
| `codeValue`     | Numeric response code, for example `0x200f`.             |
| `transactionID` | Transaction that failed.                                 |

Common codes: `GeneralError` (`0x2002`), `SessionNotOpen` (`0x2003`),
`OperationNotSupported` (`0x2005`), `InvalidStorageID` (`0x2008`),
`InvalidObjectHandle` (`0x2009`), `StoreFull` (`0x200c`),
`StoreReadOnly` (`0x200e`), `AccessDenied` (`0x200f`),
`SessionAlreadyOpen` (`0x201e`).

A transport problem rejects with a plain `Error`. The causes are a USB status
other than `ok`, an unexpected transaction ID, a malformed container, or no data
for 30 seconds. These failures set `transportHealthy` to false. Every later
command rejects with the transport-out-of-sync error until you create a new
`Mtp` instance.

## Exported helpers

These are pure functions. They need no device. Tests and tools that speak MTP
directly can use them.

| Export                                           | Description                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `buildContainerPacket(transactionId, container)` | Build an `ArrayBuffer` for one container. `container` is `{ type, code, payload? }`.                        |
| `parseContainerPacket(view, length?)`            | Parse a `DataView` into `{ type, typeValue, code, codeValue, transactionID, length, payload, parameters }`. |
| `decodeMtpString(bytes)`                         | Decode an MTP string. Accepts `Uint8Array` or `ArrayBuffer`.                                                |
| `encodeMtpString(value)`                         | Encode an MTP string.                                                                                       |
| `encodeMtpDate(date?)`                           | Format a `Date` as an MTP date string in UTC.                                                               |
| `encodeObjectInfo(info)`                         | Encode an ObjectInfo dataset for `SendObjectInfo`.                                                          |
| `decodeObjectInfo(bytes)`                        | Decode an ObjectInfo dataset.                                                                               |
| `encodeObjectPropList(entries)`                  | Encode a property list for `SendObjectPropList`. Supports 128-bit values as `BigInt`.                       |
| `decodeObjectPropList(bytes)`                    | Decode a property list from `GetObjectPropList`. Supports array data types.                                 |
| `decodeDeviceInfo(bytes)`                        | Decode a PTP DeviceInfo dataset.                                                                            |
| `decodeDevicePropDesc(bytes)`                    | Decode a DevicePropDesc dataset.                                                                            |
| `decodeObjectPropDesc(bytes)`                    | Decode an ObjectPropDesc dataset.                                                                           |
| `decodePropertyValueData(bytes, datatype)`       | Decode one property value from a response payload.                                                          |
| `setUsbTransport(transport)`                     | Install a WebUSB transport for device discovery. The Node.js entry uses this for `usb.webusb`.              |
| `MtpResponseError`                               | Error class described above.                                                                                |
| `OBJECT_FORMAT`                                  | `{ UNDEFINED: 0x3000, ASSOCIATION: 0x3001 }`.                                                               |
| `STORAGE_ACCESS`                                 | `{ READ_WRITE: 0, READ_ONLY: 1, READ_ONLY_WITH_DELETE: 2 }`.                                                |
| `MTP_DATATYPE`                                   | Property data type codes, including array types and `STRING`.                                               |
| `OBJECT_PROPERTY`                                | Common object property codes, for example `FILE_NAME`, `OBJECT_SIZE`, `PARENT_OBJECT`.                      |
| `DEVICE_PROPERTY`                                | Common device property codes, for example `BATTERY_LEVEL` and `DEVICE_FRIENDLY_NAME`.                       |
| `PROPERTY_FORM`                                  | Property descriptor form codes, for example `RANGE` and `ENUMERATION`.                                      |
| `PROPERTY_GET_SET`                               | `{ GET: 0, GET_SET: 1 }`.                                                                                   |
| `OBJECT_PROTECTION`                              | `{ NONE: 0, READ_ONLY: 1 }`.                                                                                |
| `EVENT_CODE`                                     | Common event codes, for example `OBJECT_ADDED` and `STORE_REMOVED`.                                         |

Container type values: `1` command, `2` data, `3` response, `4` event.

## TypeScript

The package includes `src/mtp.d.ts`. The declarations cover the class,
constructor options, events, properties, methods and exported helpers. The
public result and option types are:

| Type                       | Shape                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeviceInfo`               | The PTP DeviceInfo fields, for example `Manufacturer`, `Model` and `SerialNumber`.                                                                |
| `PartialOrder`             | `'hiFirst'` or `'loFirst'`.                                                                                                                       |
| `PartialState`             | `'unknown'`, `'supported'` or `'unsupported'`.                                                                                                    |
| `UploadOptions`            | Upload fields, including `data`, `size`, `onProgress` and `signal`.                                                                               |
| `UploadData`               | `Uint8Array`, `ArrayBuffer` or `AsyncIterable<Uint8Array>`.                                                                                       |
| `StorageInfo`              | The `getStorageInfo()` result.                                                                                                                    |
| `ObjectInfo`               | The `getObjectInfo()` result.                                                                                                                     |
| `PropListResult`           | The `getObjectPropertyList()` result with `count` and `elements`.                                                                                 |
| `PropertyForm`             | A property form: range, enumeration, date, array, string or `null`.                                                                               |
| `DevicePropDesc`           | A device property descriptor.                                                                                                                     |
| `ObjectPropDesc`           | An object property descriptor.                                                                                                                    |
| `DevicePropertyResult`     | `getDeviceProperty()` returns `descriptor` and `value`.                                                                                           |
| `ObjectPropertyResult`     | `getObjectProperty()` returns `descriptor` and `value`.                                                                                           |
| `SetObjectPropertyOptions` | `datatype` and `format` for `setObjectProperty()`.                                                                                                |
| `Container`                | A parsed MTP container.                                                                                                                           |
| `MtpLogLevel`              | `'silent'`, `'error'`, `'warn'`, `'info'` or `'debug'`.                                                                                           |
| `MtpLogger`                | Optional `debug`, `info`, `warn` and `error` functions.                                                                                           |
| `NavigatorLike`            | `userAgent` and `usb` shape accepted by `isSupported()`.                                                                                          |
| `MtpOptions`               | `maxContainerLength`, `readTimeoutMs`, `transferDeadlineMs`, `maxEventBlocks`, `logLevel`, `logger`, `writeChunkSize` and `sendZeroLengthPacket`. |
| `UsbDevice`                | A minimal structural WebUSB device. A real `USBDevice` fits this type.                                                                            |
| `UsbTransport`             | `getDevices()` and `requestDevice()`. The `usb` shim fits this type.                                                                              |

The declarations need TypeScript 5 or newer and the `ES2022` and `DOM` libs.
