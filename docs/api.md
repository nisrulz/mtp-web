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

| Option               | Type     | Default     | Description                                                               |
| -------------------- | -------- | ----------- | ------------------------------------------------------------------------- |
| `maxContainerLength` | `number` | `536870912` | Largest accepted inbound container in bytes. The default is 512 MiB.      |
| `readTimeoutMs`      | `number` | `30000`     | Idle timeout for one USB read in milliseconds.                            |
| `transferDeadlineMs` | `number` | `300000`    | Total deadline for one command in milliseconds. The default is 5 minutes. |
| `maxEventBlocks`     | `number` | `100`       | Maximum consecutive event blocks before the command fails.                |

An invalid limit throws `RangeError`.

The constructor returns immediately and opens the device in the background. Use
the `ready` promise or the `ready` event before the first call.

The `usb` package loads only when the constructor must find a device. A caller
that passes a `USBDevice` does not load the native module.

The library does not authenticate the device. Any device that matches the
vendor and product ID can answer. Use a physical connection that you control.
Do not upload sensitive data to an untrusted device.

## Properties

| Property        | Type                | Description                                                                                                |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ready`         | `Promise<Mtp>`      | Resolves with the instance when the device is open and the interface is claimed. Rejects on a setup error. |
| `state`         | `string`            | `initializing`, `open` or `closed`.                                                                        |
| `device`        | `USBDevice \| null` | The open device. `null` after `close()`.                                                                   |
| `usbconfig`     | `object \| null`    | Interface number, alternate setting, endpoint numbers and packet sizes in use.                             |
| `sessionOpen`   | `boolean`           | True after `openSession()` succeeds and before `closeSession()`.                                           |
| `transactionID` | `number`            | Next MTP transaction ID. `openSession()` sets it to 0.                                                     |
| `lastError`     | `Error \| null`     | The error that the last `error` event carried.                                                             |

## Methods

The MTP command methods send commands one at a time. A call that arrives during
another call waits for the first call to finish.

### `openSession()`

Opens an MTP session. If the device answers `SessionAlreadyOpen`, the method
closes the old session and tries one time more. A session that a crashed tab or
a closed terminal left open does not block the next run.

Returns the response container.

### `closeSession()`

Closes the MTP session. The USB device stays open. The method does nothing when
the device is not open. It accepts `SessionNotOpen`.

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
`BigInt`. It decodes strings from UTF-16LE.

### `sendObjectPropertyList(storageId, parentObjectHandle, format, entries, size?)`

Writes metadata for a new object. Use it before or instead of `uploadFile()`.
An item in `entries` has the shape `{ handle?, property, datatype, value }`.
The `size` argument is the 64-bit object size in bytes and defaults to `0`.
Pass a `BigInt` for a size above `Number.MAX_SAFE_INTEGER`. The method sends the
high and low 32-bit size parameters and sets every entry handle to `0`, as the
MTP specification requires. Returns the response container.

### `uploadFile(options)`

Uploads one object. The options are `storageId`, `parentObjectHandle`,
`filename`, `data` (`ArrayBuffer` or `Uint8Array`), `format`, `dateCreated` and
`dateModified`.

Returns `Promise<number>`: the object handle of the new file. A device can omit
the handle in the SendObjectInfo response. In this case, the method finds the
handle in the parent folder by file name.

The device rejects a read-only storage with `StoreReadOnly`. It rejects a full
storage with `StoreFull`.

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

| Field           | Description                                     |
| --------------- | ----------------------------------------------- |
| `name`          | `MtpResponseError`                              |
| `message`       | `MTP command failed: <code name>`               |
| `code`          | Response code name, for example `AccessDenied`. |
| `codeValue`     | Numeric response code, for example `0x200f`.    |
| `transactionID` | Transaction that failed.                        |

Common codes: `GeneralError` (`0x2002`), `SessionNotOpen` (`0x2003`),
`OperationNotSupported` (`0x2005`), `InvalidStorageID` (`0x2008`),
`InvalidObjectHandle` (`0x2009`), `StoreFull` (`0x200c`),
`StoreReadOnly` (`0x200e`), `AccessDenied` (`0x200f`),
`SessionAlreadyOpen` (`0x201e`).

A transport problem rejects with a plain `Error`. The causes are a USB status
other than `ok`, an unexpected transaction ID, a malformed container, or no data
for 30 seconds.

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
| `decodeObjectPropList(bytes)`                    | Decode a property list from `GetObjectPropList`.                                                            |
| `MtpResponseError`                               | Error class described above.                                                                                |
| `OBJECT_FORMAT`                                  | `{ UNDEFINED: 0x3000, ASSOCIATION: 0x3001 }`.                                                               |
| `STORAGE_ACCESS`                                 | `{ READ_WRITE: 0, READ_ONLY: 1, READ_ONLY_WITH_DELETE: 2 }`.                                                |
| `MTP_DATATYPE`                                   | Property list data type codes, for example `STRING` and `UINT32`.                                           |
| `OBJECT_PROPERTY`                                | Common object property codes, for example `FILE_NAME`, `OBJECT_SIZE`, `PARENT_OBJECT`.                      |

Container type values: `1` command, `2` data, `3` response, `4` event.
