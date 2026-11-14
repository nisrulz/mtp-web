let usbTransport = null;

/**
 * Set the WebUSB transport used to discover a device. The Node.js entry sets
 * the `usb` shim here. Pass `null` to clear it.
 * @param {{
 *   getDevices: () => Promise<USBDevice[]>,
 *   requestDevice: (options: {
 *     filters: Array<{vendorId: number, productId?: number}>
 *   }) => Promise<USBDevice>
 * }|null} transport
 */
export function setUsbTransport(transport) {
  usbTransport = transport ?? null;
}

/**
 * @typedef {object} NavigatorLike
 * @property {string} [userAgent]
 * @property {{requestDevice?: unknown, getDevices?: unknown}|null} [usb]
 */

const FIREFOX_USER_AGENT = /\b(?:Firefox|FxiOS)\//i;
const SAFARI_USER_AGENT = /\bSafari\//i;
const CHROMIUM_USER_AGENT = /\b(?:Chrome|Chromium|Edg|OPR)\//i;

function isFirefoxOrSafari(userAgent) {
  if (FIREFOX_USER_AGENT.test(userAgent)) {
    return true;
  }
  return (
    SAFARI_USER_AGENT.test(userAgent) && !CHROMIUM_USER_AGENT.test(userAgent)
  );
}

/**
 * Returns true when this browser can use WebUSB for MTP. Firefox and Safari do
 * not implement WebUSB, so they return false.
 * @param {NavigatorLike} [navigatorLike]
 * @returns {boolean}
 */
export function isSupported(navigatorLike = globalThis.navigator) {
  if (!navigatorLike) {
    return false;
  }

  if (isFirefoxOrSafari(navigatorLike.userAgent ?? '')) {
    return false;
  }

  const usb = navigatorLike.usb;
  return Boolean(
    usb &&
    typeof usb.requestDevice === 'function' &&
    typeof usb.getDevices === 'function',
  );
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const TYPE = [
  'undefined',
  'Command Block',
  'Data Block',
  'Response Block',
  'Event Block',
];

const COMMAND_BLOCK = 1;
const DATA_BLOCK = 2;
const RESPONSE_BLOCK = 3;
const EVENT_BLOCK = 4;

// Give up instead of hanging forever if the device stops answering.
const DEFAULT_READ_TIMEOUT_MS = 30000;
const DEFAULT_TRANSFER_DEADLINE_MS = 300000;
const DEFAULT_MAX_CONTAINER_LENGTH = 512 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BLOCKS = 100;

// Setup and write operations need their own bound. A read has the transfer
// deadline, but opening, claiming or writing can hang without one.
const SETUP_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 10000;
const USB_CLASS_STILL_IMAGE = 0x06;
const USB_CLASS_VENDOR = 0xff;
const USB_SUBCLASS_ADB = 0x42;
const TRANSPORT_OUT_OF_SYNC =
  'The MTP transport is out of sync after a failed transfer. ' +
  'Reconnect the device before you send another command.';

const CODE = {
  GET_DEVICE_INFO: { value: 0x1001, name: 'GetDeviceInfo' },
  OPEN_SESSION: { value: 0x1002, name: 'OpenSession' },
  CLOSE_SESSION: { value: 0x1003, name: 'CloseSession' },
  GET_STORAGE_IDS: { value: 0x1004, name: 'GetStorageIDs' },
  GET_STORAGE_INFO: { value: 0x1005, name: 'GetStorageInfo' },
  GET_NUM_OBJECTS: { value: 0x1006, name: 'GetNumObjects' },
  GET_OBJECT_HANDLES: { value: 0x1007, name: 'GetObjectHandles' },
  GET_OBJECT_INFO: { value: 0x1008, name: 'GetObjectInfo' },
  GET_OBJECT: { value: 0x1009, name: 'GetObject' },
  GET_THUMB: { value: 0x100a, name: 'GetThumb' },
  DELETE_OBJECT: { value: 0x100b, name: 'DeleteObject' },
  SEND_OBJECT_INFO: { value: 0x100c, name: 'SendObjectInfo' },
  SEND_OBJECT: { value: 0x100d, name: 'SendObject' },
  INITIATE_CAPTURE: { value: 0x100e, name: 'InitiateCapture' },
  FORMAT_STORE: { value: 0x100f, name: 'FormatStore' },
  RESET_DEVICE: { value: 0x1010, name: 'ResetDevice' },
  SELF_TEST: { value: 0x1011, name: 'SelfTest' },
  SET_OBJECT_PROTECTION: { value: 0x1012, name: 'SetObjectProtection' },
  POWER_DOWN: { value: 0x1013, name: 'PowerDown' },
  GET_DEVICE_PROP_DESC: { value: 0x1014, name: 'GetDevicePropDesc' },
  GET_DEVICE_PROP_VALUE: { value: 0x1015, name: 'GetDevicePropValue' },
  SET_DEVICE_PROP_VALUE: { value: 0x1016, name: 'SetDevicePropValue' },
  RESET_DEVICE_PROP_VALUE: { value: 0x1017, name: 'ResetDevicePropValue' },
  TERMINATE_OPEN_CAPTURE: { value: 0x1018, name: 'TerminateOpenCapture' },
  MOVE_OBJECT: { value: 0x1019, name: 'MoveObject' },
  COPY_OBJECT: { value: 0x101a, name: 'CopyObject' },
  GET_PARTIAL_OBJECT: { value: 0x101b, name: 'GetPartialObject' },
  INITIATE_OPEN_CAPTURE: { value: 0x101c, name: 'InitiateOpenCapture' },
  GET_PARTIAL_OBJECT_64: { value: 0x95c1, name: 'GetPartialObject64' },
  GET_OBJECT_PROPS_SUPPORTED: {
    value: 0x9801,
    name: 'GetObjectPropsSupported',
  },
  GET_OBJECT_PROP_DESC: { value: 0x9802, name: 'GetObjectPropDesc' },
  GET_OBJECT_PROP_VALUE: { value: 0x9803, name: 'GetObjectPropValue' },
  SET_OBJECT_PROP_VALUE: { value: 0x9804, name: 'SetObjectPropValue' },
  GET_OBJECT_PROP_LIST: { value: 0x9805, name: 'GetObjectPropList' },
  SET_OBJECT_PROP_LIST: { value: 0x9806, name: 'SetObjectPropList' },
  SEND_OBJECT_PROP_LIST: { value: 0x9808, name: 'SendObjectPropList' },
  GET_OBJECT_REFERENCES: { value: 0x9810, name: 'GetObjectReferences' },
  SET_OBJECT_REFERENCES: { value: 0x9811, name: 'SetObjectReferences' },
  OBJECT_FILE_NAME: { value: 0xdc07, name: 'Object file name' },
  OK: { value: 0x2001, name: 'OK' },
  GENERAL_ERROR: { value: 0x2002, name: 'GeneralError' },
  SESSION_NOT_OPEN: { value: 0x2003, name: 'SessionNotOpen' },
  INVALID_TRANSACTION_ID: { value: 0x2004, name: 'InvalidTransactionID' },
  OPERATION_NOT_SUPPORTED: { value: 0x2005, name: 'OperationNotSupported' },
  PARAMETER_NOT_SUPPORTED: { value: 0x2006, name: 'ParameterNotSupported' },
  INCOMPLETE_TRANSFER: { value: 0x2007, name: 'IncompleteTransfer' },
  INVALID_STORAGE_ID: { value: 0x2008, name: 'InvalidStorageID' },
  INVALID_OBJECT_HANDLE: { value: 0x2009, name: 'InvalidObjectHandle' },
  STORE_FULL: { value: 0x200c, name: 'StoreFull' },
  OBJECT_WRITE_PROTECTED: { value: 0x200d, name: 'ObjectWriteProtected' },
  STORE_READ_ONLY: { value: 0x200e, name: 'StoreReadOnly' },
  ACCESS_DENIED: { value: 0x200f, name: 'AccessDenied' },
  INVALID_PARENT_OBJECT: { value: 0x201a, name: 'InvalidParentObject' },
  INVALID_PARAMETER: { value: 0x201d, name: 'Invalid parameter' },
  SESSION_ALREADY_OPEN: { value: 0x201e, name: 'SessionAlreadyOpen' },
  TRANSACTION_CANCELLED: { value: 0x201f, name: 'TransactionCancelled' },
};

const EVENT = {
  UNDEFINED: { value: 0x4000, name: 'UndefinedEvent' },
  CANCEL_TRANSACTION: { value: 0x4001, name: 'CancelTransaction' },
  OBJECT_ADDED: { value: 0x4002, name: 'ObjectAdded' },
  OBJECT_REMOVED: { value: 0x4003, name: 'ObjectRemoved' },
  STORE_ADDED: { value: 0x4004, name: 'StoreAdded' },
  STORE_REMOVED: { value: 0x4005, name: 'StoreRemoved' },
  DEVICE_PROP_CHANGED: { value: 0x4006, name: 'DevicePropChanged' },
  OBJECT_INFO_CHANGED: { value: 0x4007, name: 'ObjectInfoChanged' },
  DEVICE_INFO_CHANGED: { value: 0x4008, name: 'DeviceInfoChanged' },
  REQUEST_OBJECT_TRANSFER: { value: 0x4009, name: 'RequestObjectTransfer' },
  STORE_FULL: { value: 0x400a, name: 'StoreFullEvent' },
  DEVICE_RESET: { value: 0x400b, name: 'DeviceReset' },
  STORAGE_INFO_CHANGED: { value: 0x400c, name: 'StorageInfoChanged' },
  CAPTURE_COMPLETE: { value: 0x400d, name: 'CaptureComplete' },
  UNREPORTED_STATUS: { value: 0x400e, name: 'UnreportedStatus' },
  OBJECT_PROP_CHANGED: { value: 0xc801, name: 'ObjectPropChanged' },
  OBJECT_PROP_DESC_CHANGED: {
    value: 0xc802,
    name: 'ObjectPropDescChanged',
  },
  OBJECT_REFERENCES_CHANGED: {
    value: 0xc803,
    name: 'ObjectReferencesChanged',
  },
};

/** Event codes used by MTP event containers. */
export const EVENT_CODE = Object.fromEntries(
  Object.entries(EVENT).map(([key, entry]) => [key, entry.value]),
);

/** Standard MTP device property codes. */
export const DEVICE_PROPERTY = {
  UNDEFINED: 0x5000,
  BATTERY_LEVEL: 0x5001,
  FUNCTIONAL_MODE: 0x5002,
  IMAGE_SIZE: 0x5003,
  COMPRESSION_SETTING: 0x5004,
  WHITE_BALANCE: 0x5005,
  RGB_GAIN: 0x5006,
  F_NUMBER: 0x5007,
  FOCAL_LENGTH: 0x5008,
  FOCUS_DISTANCE: 0x5009,
  FOCUS_MODE: 0x500a,
  EXPOSURE_METERING_MODE: 0x500b,
  FLASH_MODE: 0x500c,
  EXPOSURE_TIME: 0x500d,
  EXPOSURE_PROGRAM_MODE: 0x500e,
  EXPOSURE_INDEX: 0x500f,
  EXPOSURE_BIAS_COMPENSATION: 0x5010,
  DATE_TIME: 0x5011,
  CAPTURE_DELAY: 0x5012,
  STILL_CAPTURE_MODE: 0x5013,
  CONTRAST: 0x5014,
  SHARPNESS: 0x5015,
  DIGITAL_ZOOM: 0x5016,
  EFFECT_MODE: 0x5017,
  BURST_NUMBER: 0x5018,
  BURST_INTERVAL: 0x5019,
  TIMELAPSE_NUMBER: 0x501a,
  TIMELAPSE_INTERVAL: 0x501b,
  FOCUS_METERING_MODE: 0x501c,
  UPLOAD_URL: 0x501d,
  ARTIST: 0x501e,
  COPYRIGHT_INFO: 0x501f,
  SYNCHRONIZATION_PARTNER: 0xd401,
  DEVICE_FRIENDLY_NAME: 0xd402,
  VOLUME: 0xd403,
  SUPPORTED_FORMATS_ORDERED: 0xd404,
  DEVICE_ICON: 0xd405,
  SESSION_INITIATOR_VERSION_INFO: 0xd406,
  PERCEIVED_DEVICE_TYPE: 0xd407,
  PLAYBACK_RATE: 0xd410,
  PLAYBACK_OBJECT: 0xd411,
  PLAYBACK_CONTAINER_INDEX: 0xd412,
  PLAYBACK_POSITION: 0xd413,
};

/** Property descriptor form flags. */
export const PROPERTY_FORM = {
  NONE: 0x00,
  RANGE: 0x01,
  ENUMERATION: 0x02,
  DATE_TIME: 0x03,
  FIXED_LENGTH_ARRAY: 0x04,
  REGULAR_EXPRESSION: 0x05,
  BYTE_ARRAY: 0x06,
  LONG_STRING: 0x07,
};

/** Property descriptor get/set values. */
export const PROPERTY_GET_SET = {
  GET: 0,
  GET_SET: 1,
};

/** Object protection status values for SetObjectProtection. */
export const OBJECT_PROTECTION = {
  NONE: 0,
  READ_ONLY: 1,
};

/** Object format codes used by MTP. */
export const OBJECT_FORMAT = {
  UNDEFINED: 0x3000,
  ASSOCIATION: 0x3001,
};

/** Storage access capability values from GetStorageInfo. */
export const STORAGE_ACCESS = {
  READ_WRITE: 0x00,
  READ_ONLY: 0x01,
  READ_ONLY_WITH_DELETE: 0x02,
};

/** Object property codes for property lists and GetObjectPropValue. */
export const OBJECT_PROPERTY = {
  STORAGE_ID: 0xdc01,
  OBJECT_FORMAT: 0xdc02,
  PROTECTION_STATUS: 0xdc03,
  OBJECT_SIZE: 0xdc04,
  ASSOCIATION_TYPE: 0xdc05,
  ASSOCIATION_DESCRIPTION: 0xdc06,
  FILE_NAME: 0xdc07,
  DATE_CREATED: 0xdc08,
  DATE_MODIFIED: 0xdc09,
  PARENT_OBJECT: 0xdc0b,
  PERSISTENT_UID: 0xdc41,
  NAME: 0xdc44,
};

/** MTP property list data types. */
export const MTP_DATATYPE = {
  NONE: 0x0000,
  INT8: 0x0001,
  UINT8: 0x0002,
  INT16: 0x0003,
  UINT16: 0x0004,
  INT32: 0x0005,
  UINT32: 0x0006,
  INT64: 0x0007,
  UINT64: 0x0008,
  INT128: 0x0009,
  UINT128: 0x000a,
  AINT8: 0x4001,
  AUINT8: 0x4002,
  AINT16: 0x4003,
  AUINT16: 0x4004,
  AINT32: 0x4005,
  AUINT32: 0x4006,
  AINT64: 0x4007,
  AUINT64: 0x4008,
  AINT128: 0x4009,
  AUINT128: 0x400a,
  STRING: 0xffff,
};

const DATATYPE_ARRAY_MASK = 0x4000;

function isArrayDatatype(datatype) {
  return (
    datatype !== MTP_DATATYPE.STRING && (datatype & DATATYPE_ARRAY_MASK) !== 0
  );
}

/** Response code to human-readable name (or a hex fallback). */
function findName(list, value) {
  for (const key in list) {
    if (list[key].value === value) {
      return list[key].name;
    }
  }
  return `Unknown (0x${value.toString(16)})`;
}

function operationLabel(operation) {
  return operation == null ? '' : ` for ${findName(CODE, operation)}`;
}

const LOG_LEVELS = Object.freeze({
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
});
const DEFAULT_LOG_LEVEL = 'silent';

function normalizeLogLevel(value) {
  const level = value ?? DEFAULT_LOG_LEVEL;
  if (!(level in LOG_LEVELS)) {
    throw new RangeError(
      `logLevel must be one of ${Object.keys(LOG_LEVELS).join(', ')}.`,
    );
  }
  return level;
}

function createLogger(custom) {
  if (custom) {
    return {
      debug: custom.debug?.bind(custom),
      info: custom.info?.bind(custom),
      warn: custom.warn?.bind(custom),
      error: custom.error?.bind(custom),
    };
  }
  if (typeof globalThis.console === 'undefined') {
    return {};
  }

  const target = globalThis.console;
  return {
    debug: target.debug?.bind(target) ?? target.log?.bind(target),
    info: target.info?.bind(target) ?? target.log?.bind(target),
    warn: target.warn?.bind(target),
    error: target.error?.bind(target),
  };
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function writeContainerHeader(view, length, type, code, transactionId) {
  view.setUint32(0, length, true);
  view.setUint16(4, type, true);
  view.setUint16(6, code, true);
  view.setUint32(8, transactionId >>> 0, true);
}

/**
 * Build an MTP container. Exported as a pure function so it can be tested
 * without a USB device.
 * @param {number} transactionId
 * @param {{type: number, code: number, payload?: number[]}} container
 * @returns {ArrayBuffer}
 */
export function buildContainerPacket(transactionId, container) {
  const payload = container.payload ?? [];
  const packetLength = 12 + payload.length * 4;
  const buf = new ArrayBuffer(packetLength);
  const bytes = new DataView(buf);

  writeContainerHeader(
    bytes,
    packetLength,
    container.type,
    container.code,
    transactionId,
  );

  payload.forEach((element, index) => {
    bytes.setUint32(12 + index * 4, element >>> 0, true);
  });

  return buf;
}

/**
 * Parse an MTP container from a DataView. `length` should be the container
 * length from the header; the view may contain additional bytes beyond it.
 * @param {DataView} bytes
 * @param {number} [length]
 */
export function parseContainerPacket(bytes, length) {
  if (!(bytes instanceof DataView)) {
    throw new TypeError('parseContainerPacket expects a DataView');
  }
  if (bytes.byteLength < 12) {
    throw new RangeError(
      `MTP container is too short: ${bytes.byteLength} bytes`,
    );
  }

  const containerLength = bytes.getUint32(0, true);
  if (containerLength < 12) {
    throw new RangeError(`Invalid MTP container length: ${containerLength}`);
  }

  const end = Math.min(
    length ?? containerLength,
    containerLength,
    bytes.byteLength,
  );
  const typeValue = bytes.getUint16(4, true);
  const codeValue = bytes.getUint16(6, true);
  const parameters = [];

  for (let offset = 12; offset + 4 <= end; offset += 4) {
    parameters.push(bytes.getUint32(offset, true));
  }

  return {
    type: TYPE[typeValue] ?? `Unknown (${typeValue})`,
    typeValue,
    code: findName(typeValue === EVENT_BLOCK ? EVENT : CODE, codeValue),
    codeValue,
    transactionID: bytes.getUint32(8, true),
    length: containerLength,
    payload: bytes.buffer.slice(bytes.byteOffset + 12, bytes.byteOffset + end),
    parameters,
  };
}

/**
 * Decode an MTP string (1-byte count including the NUL terminator, followed
 * by UTF-16LE code units).
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {string}
 */
export function decodeMtpString(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) {
    return '';
  }

  const declared = bytes[0];
  if (declared === 0) {
    return '';
  }

  // The count includes the terminating NUL, which is not part of the value.
  const available = Math.floor((bytes.byteLength - 1) / 2);
  const chars = Math.min(Math.max(declared - 1, 0), available);
  if (chars === 0) {
    return '';
  }

  return new TextDecoder('utf-16le').decode(bytes.subarray(1, 1 + chars * 2));
}

const MAX_STRING_LENGTH = 254;
const DEFAULT_WRITE_CHUNK_SIZE = 512;

function normalizeBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Expected an ArrayBuffer or a typed array.');
}

function isAsyncIterable(value) {
  return value != null && typeof value[Symbol.asyncIterator] === 'function';
}

function readUploadSize(size) {
  if (!Number.isInteger(size) || size < 0) {
    throw new RangeError('size must be a non-negative integer.');
  }
  return size;
}

function normalizeUploadSource(data, size) {
  if (isAsyncIterable(data)) {
    if (size == null) {
      throw new TypeError('size is required for an AsyncIterable upload.');
    }
    return { size: readUploadSize(size), iterable: data };
  }

  const bytes = normalizeBytes(data);
  const totalSize = size == null ? bytes.byteLength : readUploadSize(size);

  if (totalSize !== bytes.byteLength) {
    throw new RangeError('size must equal the data length.');
  }

  return { size: totalSize, bytes };
}

function positiveInteger(value, fallback, name) {
  if (value == null) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function readUint16(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer.`);
  }
  return value;
}

function readUint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer.`);
  }
  return value;
}

function readMtpStringAt(bytes, offset) {
  if (offset >= bytes.byteLength) {
    return { text: '', offset };
  }

  const declared = bytes[offset];
  if (declared === 0) {
    return { text: '', offset: offset + 1 };
  }

  const available = Math.floor((bytes.byteLength - offset - 1) / 2);
  const chars = Math.min(declared - 1, available);
  const text =
    chars > 0
      ? new TextDecoder('utf-16le').decode(
          bytes.subarray(offset + 1, offset + 1 + chars * 2),
        )
      : '';

  return { text, offset: offset + 1 + declared * 2 };
}

function readCountedArray(bytes, view, offset, width) {
  if (offset + 4 > bytes.byteLength) {
    throw new RangeError('The DeviceInfo dataset is too short.');
  }

  const count = view.getUint32(offset, true);
  offset += 4;

  const available = Math.floor((bytes.byteLength - offset) / width);
  if (count > available) {
    throw new RangeError('The DeviceInfo dataset is too short.');
  }

  const values = [];

  for (let index = 0; index < count; index += 1) {
    values.push(
      width === 4
        ? view.getUint32(offset + index * 4, true)
        : view.getUint16(offset + index * 2, true),
    );
  }

  return { values, offset: offset + count * width };
}

/**
 * Decode a PTP DeviceInfo dataset.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {object}
 */
export function decodeDeviceInfo(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 8) {
    throw new RangeError(
      `The DeviceInfo dataset is too short: ${bytes.byteLength} bytes`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const standardVersion = view.getUint16(offset, true);
  offset += 2;
  const vendorExtensionID = view.getUint32(offset, true);
  offset += 4;
  const vendorExtensionVersion = view.getUint16(offset, true);
  offset += 2;

  const description = readMtpStringAt(bytes, offset);
  offset = description.offset;

  if (offset + 2 > bytes.byteLength) {
    throw new RangeError('The DeviceInfo dataset is too short.');
  }

  const functionalMode = view.getUint16(offset, true);
  offset += 2;

  const operations = readCountedArray(bytes, view, offset, 2);
  offset = operations.offset;
  const events = readCountedArray(bytes, view, offset, 2);
  offset = events.offset;
  const properties = readCountedArray(bytes, view, offset, 2);
  offset = properties.offset;
  const captureFormats = readCountedArray(bytes, view, offset, 2);
  offset = captureFormats.offset;
  const imageFormats = readCountedArray(bytes, view, offset, 2);

  offset = imageFormats.offset;

  const manufacturer = readMtpStringAt(bytes, offset);
  offset = manufacturer.offset;
  const model = readMtpStringAt(bytes, offset);
  offset = model.offset;
  const deviceVersion = readMtpStringAt(bytes, offset);
  offset = deviceVersion.offset;
  const serialNumber = readMtpStringAt(bytes, offset);

  return {
    StandardVersion: standardVersion,
    VendorExtensionID: vendorExtensionID,
    VendorExtensionVersion: vendorExtensionVersion,
    VendorExtensionDescription: description.text,
    FunctionalMode: functionalMode,
    OperationsSupported: operations.values,
    EventsSupported: events.values,
    DevicePropertiesSupported: properties.values,
    CaptureFormats: captureFormats.values,
    ImageFormats: imageFormats.values,
    Manufacturer: manufacturer.text,
    Model: model.text,
    DeviceVersion: deviceVersion.text,
    SerialNumber: serialNumber.text,
  };
}

/**
 * Encode an MTP string: 1-byte count (value length plus the NUL), then
 * UTF-16LE code units, then a 2-byte NUL.
 * @param {string} value
 * @returns {Uint8Array}
 */
export function encodeMtpString(value) {
  const text = String(value ?? '');
  if (text.length > MAX_STRING_LENGTH) {
    throw new RangeError(
      `MTP strings are limited to ${MAX_STRING_LENGTH} characters`,
    );
  }
  if (text.length === 0) {
    return new Uint8Array([0]);
  }

  const out = new Uint8Array(1 + (text.length + 1) * 2);
  out[0] = text.length + 1;
  const view = new DataView(out.buffer, 1, text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return out;
}

/**
 * Format a Date as an MTP date string: YYYYMMDDThhmmss in UTC.
 * @param {Date} [date]
 * @returns {string}
 */
export function encodeMtpDate(date = new Date()) {
  const iso = date.toISOString();
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    'T' +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19)
  );
}

/**
 * Encode an ObjectInfo dataset for SendObjectInfo.
 * @param {object} [info]
 * @param {string} [info.filename]
 * @param {number} [info.storageId]
 * @param {number} [info.parent] Parent object handle.
 * @param {number} [info.format] Object format code.
 * @param {number} [info.size] Object size in bytes.
 * @param {number} [info.protectionStatus]
 * @param {number} [info.associationType]
 * @param {number} [info.associationDescription]
 * @param {number} [info.sequenceNumber]
 * @param {string} [info.dateCreated] MTP date string.
 * @param {string} [info.dateModified] MTP date string.
 * @param {string} [info.keywords]
 * @returns {Uint8Array}
 */
export function encodeObjectInfo(info = {}) {
  const filename = encodeMtpString(info.filename ?? '');
  const dateCreated = encodeMtpString(info.dateCreated ?? '');
  const dateModified = encodeMtpString(info.dateModified ?? '');
  const keywords = encodeMtpString(info.keywords ?? '');
  const storageId = readUint32(info.storageId ?? 0, 'storageId');
  const format = readUint16(info.format ?? OBJECT_FORMAT.UNDEFINED, 'format');
  const protectionStatus = readUint16(
    info.protectionStatus ?? 0,
    'protectionStatus',
  );
  const parent = readUint32(info.parent ?? 0, 'parent');
  const associationType = readUint16(
    info.associationType ?? 0,
    'associationType',
  );
  const associationDescription = readUint32(
    info.associationDescription ?? 0,
    'associationDescription',
  );
  const sequenceNumber = readUint32(info.sequenceNumber ?? 0, 'sequenceNumber');

  const fixed = 52;
  const objectSize = info.size ?? 0;
  if (
    !Number.isInteger(objectSize) ||
    objectSize < 0 ||
    objectSize > 0xffffffff
  ) {
    throw new RangeError(
      'ObjectInfo size must fit in an unsigned 32-bit value.',
    );
  }

  const out = new Uint8Array(
    fixed +
      filename.byteLength +
      dateCreated.byteLength +
      dateModified.byteLength +
      keywords.byteLength,
  );
  const view = new DataView(out.buffer);

  let offset = 0;
  view.setUint32(offset, storageId, true);
  offset += 4;
  view.setUint16(offset, format, true);
  offset += 2;
  view.setUint16(offset, protectionStatus, true);
  offset += 2;
  view.setUint32(offset, objectSize, true);
  offset += 4;
  // Thumbnail format, size, width and height (14 bytes).
  offset += 14;
  // Image width, height and bit depth (12 bytes).
  offset += 12;
  view.setUint32(offset, parent, true);
  offset += 4;
  view.setUint16(offset, associationType, true);
  offset += 2;
  view.setUint32(offset, associationDescription, true);
  offset += 4;
  view.setUint32(offset, sequenceNumber, true);
  offset += 4;

  out.set(filename, offset);
  offset += filename.byteLength;
  out.set(dateCreated, offset);
  offset += dateCreated.byteLength;
  out.set(dateModified, offset);
  offset += dateModified.byteLength;
  out.set(keywords, offset);

  return out;
}

/**
 * Decode an ObjectInfo dataset.
 * @param {ArrayBuffer|Uint8Array} input
 */
export function decodeObjectInfo(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 52) {
    throw new RangeError(`ObjectInfo is too short: ${bytes.byteLength} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = {
    storageId: view.getUint32(0, true),
    format: view.getUint16(4, true),
    protectionStatus: view.getUint16(6, true),
    size: view.getUint32(8, true),
    parent: view.getUint32(38, true),
    associationType: view.getUint16(42, true),
    associationDescription: view.getUint32(44, true),
    sequenceNumber: view.getUint32(48, true),
  };

  let offset = 52;
  let next;

  next = readMtpStringAt(bytes, offset);
  result.filename = next.text;
  offset = next.offset;

  next = readMtpStringAt(bytes, offset);
  result.dateCreated = next.text;
  offset = next.offset;

  next = readMtpStringAt(bytes, offset);
  result.dateModified = next.text;
  offset = next.offset;

  next = readMtpStringAt(bytes, offset);
  result.keywords = next.text;

  return result;
}

function propertyName(code) {
  for (const key in OBJECT_PROPERTY) {
    if (OBJECT_PROPERTY[key] === code) {
      return key;
    }
  }
  return null;
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }

  return out;
}

function encodePropertyValue(datatype, value) {
  if (isArrayDatatype(datatype)) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
      throw new TypeError('Array property values must be an array.');
    }

    const baseType = datatype & ~DATATYPE_ARRAY_MASK;
    const values = Array.isArray(value)
      ? value
      : Array.from(/** @type {any} */ (value));
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, values.length, true);

    return concatUint8Arrays([
      count,
      ...values.map(item => encodePropertyValue(baseType, item)),
    ]);
  }

  const out = new Uint8Array(16);
  const view = new DataView(out.buffer);

  switch (datatype) {
    case MTP_DATATYPE.NONE:
      return new Uint8Array(0);
    case MTP_DATATYPE.INT8:
      view.setInt8(0, Number(value));
      return out.subarray(0, 1);
    case MTP_DATATYPE.UINT8:
      view.setUint8(0, Number(value));
      return out.subarray(0, 1);
    case MTP_DATATYPE.INT16:
      view.setInt16(0, Number(value), true);
      return out.subarray(0, 2);
    case MTP_DATATYPE.UINT16:
      view.setUint16(0, Number(value), true);
      return out.subarray(0, 2);
    case MTP_DATATYPE.INT32:
      view.setInt32(0, Number(value), true);
      return out.subarray(0, 4);
    case MTP_DATATYPE.UINT32:
      view.setUint32(0, Number(value) >>> 0, true);
      return out.subarray(0, 4);
    case MTP_DATATYPE.INT64:
      view.setBigInt64(0, BigInt(value), true);
      return out.subarray(0, 8);
    case MTP_DATATYPE.UINT64:
      view.setBigUint64(0, BigInt(value), true);
      return out.subarray(0, 8);
    case MTP_DATATYPE.INT128:
    case MTP_DATATYPE.UINT128: {
      let number = BigInt(value);
      const limit = 1n << 128n;

      if (datatype === MTP_DATATYPE.INT128) {
        if (number < -(1n << 127n) || number >= 1n << 127n) {
          throw new RangeError('INT128 value is out of range.');
        }
        number = number < 0n ? number + limit : number;
      } else if (number < 0n || number >= limit) {
        throw new RangeError('UINT128 value is out of range.');
      }

      for (let index = 0; index < 16; index += 1) {
        out[index] = Number(number & 0xffn);
        number >>= 8n;
      }
      return out;
    }
    case MTP_DATATYPE.STRING:
      return encodeMtpString(String(value ?? ''));
    default:
      throw new RangeError(
        `Unsupported MTP data type 0x${datatype.toString(16)}`,
      );
  }
}

function decodePropertyValue(bytes, view, offset, datatype) {
  if (isArrayDatatype(datatype)) {
    if (offset + 4 > bytes.byteLength) {
      throw new RangeError('An array property value is missing its count.');
    }

    const count = view.getUint32(offset, true);
    offset += 4;
    const baseType = datatype & ~DATATYPE_ARRAY_MASK;

    if (baseType === MTP_DATATYPE.NONE) {
      throw new RangeError('An array property value needs a scalar data type.');
    }
    if (count > bytes.byteLength) {
      throw new RangeError(
        `Array property count ${count} exceeds the ${bytes.byteLength}-byte payload.`,
      );
    }

    const values = [];
    for (let index = 0; index < count; index += 1) {
      const decoded = decodePropertyValue(bytes, view, offset, baseType);
      values.push(decoded.value);
      offset = decoded.offset;
    }

    return { value: values, offset };
  }

  switch (datatype) {
    case MTP_DATATYPE.NONE:
      return { value: null, offset };
    case MTP_DATATYPE.INT8:
      return { value: view.getInt8(offset), offset: offset + 1 };
    case MTP_DATATYPE.UINT8:
      return { value: view.getUint8(offset), offset: offset + 1 };
    case MTP_DATATYPE.INT16:
      return { value: view.getInt16(offset, true), offset: offset + 2 };
    case MTP_DATATYPE.UINT16:
      return { value: view.getUint16(offset, true), offset: offset + 2 };
    case MTP_DATATYPE.INT32:
      return { value: view.getInt32(offset, true), offset: offset + 4 };
    case MTP_DATATYPE.UINT32:
      return { value: view.getUint32(offset, true), offset: offset + 4 };
    case MTP_DATATYPE.INT64:
      return { value: view.getBigInt64(offset, true), offset: offset + 8 };
    case MTP_DATATYPE.UINT64:
      return { value: view.getBigUint64(offset, true), offset: offset + 8 };
    case MTP_DATATYPE.INT128:
    case MTP_DATATYPE.UINT128:
      if (offset + 16 > bytes.byteLength) {
        throw new RangeError('The 128-bit property value is truncated.');
      }
      return {
        value: bytes.slice(offset, offset + 16),
        offset: offset + 16,
      };
    case MTP_DATATYPE.STRING: {
      const { text, offset: nextOffset } = readMtpStringAt(bytes, offset);
      return { value: text, offset: nextOffset };
    }
    default:
      throw new RangeError(
        `Unsupported MTP data type 0x${datatype.toString(16)}`,
      );
  }
}

/**
 * @typedef {object} PropertyDescriptor
 * @property {number} dataType
 * @property {number} getSet
 * @property {any} defaultValue
 * @property {number} formFlag
 * @property {object|null} form
 */

/**
 * @typedef {PropertyDescriptor & {
 *   devicePropertyCode: number,
 *   currentValue: any
 * }} DevicePropDesc
 */

/**
 * @typedef {PropertyDescriptor & {
 *   objectPropertyCode: number,
 *   groupCode: number
 * }} ObjectPropDesc
 */

/**
 * Decode a single property value payload. Trailing bytes are ignored because
 * some devices pad the dataset.
 * @param {ArrayBuffer|Uint8Array} input
 * @param {number} datatype
 * @returns {any}
 */
export function decodePropertyValueData(input, datatype) {
  const bytes = normalizeBytes(input);

  if (bytes.byteLength === 0) {
    if (datatype === MTP_DATATYPE.NONE) {
      return null;
    }
    if (datatype === MTP_DATATYPE.STRING) {
      return '';
    }
    throw new RangeError('The property value is empty.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return decodePropertyValue(bytes, view, 0, datatype).value;
}

function readPropertyForm(bytes, view, offset, datatype, formFlag) {
  switch (formFlag) {
    case PROPERTY_FORM.NONE:
      return { form: null, offset };

    case PROPERTY_FORM.RANGE: {
      const min = decodePropertyValue(bytes, view, offset, datatype);
      const max = decodePropertyValue(bytes, view, min.offset, datatype);
      const step = decodePropertyValue(bytes, view, max.offset, datatype);

      return {
        form: {
          type: 'range',
          min: min.value,
          max: max.value,
          step: step.value,
        },
        offset: step.offset,
      };
    }

    case PROPERTY_FORM.ENUMERATION: {
      if (offset + 2 > bytes.byteLength) {
        throw new RangeError('The property form is missing its value count.');
      }

      const count = view.getUint16(offset, true);
      offset += 2;

      if (count > bytes.byteLength) {
        throw new RangeError(
          `Property form count ${count} exceeds the ${bytes.byteLength}-byte payload.`,
        );
      }

      const values = [];
      for (let index = 0; index < count; index += 1) {
        const decoded = decodePropertyValue(bytes, view, offset, datatype);
        values.push(decoded.value);
        offset = decoded.offset;
      }

      return { form: { type: 'enumeration', values }, offset };
    }

    case PROPERTY_FORM.DATE_TIME:
    case PROPERTY_FORM.REGULAR_EXPRESSION: {
      if (offset >= bytes.byteLength) {
        throw new RangeError('The property form is missing its string value.');
      }

      const { text, offset: nextOffset } = readMtpStringAt(bytes, offset);
      return {
        form: {
          type:
            formFlag === PROPERTY_FORM.DATE_TIME
              ? 'dateTime'
              : 'regularExpression',
          value: text,
        },
        offset: nextOffset,
      };
    }

    case PROPERTY_FORM.FIXED_LENGTH_ARRAY:
    case PROPERTY_FORM.BYTE_ARRAY: {
      if (offset + 2 > bytes.byteLength) {
        throw new RangeError('The property form is missing its value count.');
      }

      const count = view.getUint16(offset, true);
      return {
        form: {
          type:
            formFlag === PROPERTY_FORM.FIXED_LENGTH_ARRAY
              ? 'fixedLengthArray'
              : 'byteArray',
          count,
        },
        offset: offset + 2,
      };
    }

    case PROPERTY_FORM.LONG_STRING:
      return { form: { type: 'longString' }, offset };

    default:
      return { form: null, offset };
  }
}

/**
 * Decode a DevicePropDesc dataset.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {DevicePropDesc}
 */
export function decodeDevicePropDesc(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 5) {
    throw new RangeError(
      `DevicePropDesc is too short: ${bytes.byteLength} bytes`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const devicePropertyCode = view.getUint16(offset, true);
  offset += 2;
  const dataType = view.getUint16(offset, true);
  offset += 2;
  const getSet = view.getUint8(offset);
  offset += 1;

  const defaultValue = decodePropertyValue(bytes, view, offset, dataType);
  offset = defaultValue.offset;

  if (dataType === MTP_DATATYPE.STRING && offset >= bytes.byteLength) {
    return {
      devicePropertyCode,
      dataType,
      getSet,
      defaultValue: defaultValue.value,
      currentValue: null,
      formFlag: PROPERTY_FORM.NONE,
      form: null,
    };
  }

  const currentValue = decodePropertyValue(bytes, view, offset, dataType);
  offset = currentValue.offset;

  let formFlag = PROPERTY_FORM.NONE;
  if (offset < bytes.byteLength) {
    formFlag = view.getUint8(offset);
    offset += 1;
  }

  const { form } = readPropertyForm(bytes, view, offset, dataType, formFlag);

  return {
    devicePropertyCode,
    dataType,
    getSet,
    defaultValue: defaultValue.value,
    currentValue: currentValue.value,
    formFlag,
    form,
  };
}

/**
 * Decode an ObjectPropDesc dataset.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {ObjectPropDesc}
 */
export function decodeObjectPropDesc(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 5) {
    throw new RangeError(
      `ObjectPropDesc is too short: ${bytes.byteLength} bytes`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const objectPropertyCode = view.getUint16(offset, true);
  offset += 2;
  const dataType = view.getUint16(offset, true);
  offset += 2;
  const getSet = view.getUint8(offset);
  offset += 1;

  const defaultValue = decodePropertyValue(bytes, view, offset, dataType);
  offset = defaultValue.offset;

  if (offset + 4 > bytes.byteLength) {
    throw new RangeError('ObjectPropDesc is missing its group code.');
  }

  const groupCode = view.getUint32(offset, true);
  offset += 4;

  let formFlag = PROPERTY_FORM.NONE;
  if (offset < bytes.byteLength) {
    formFlag = view.getUint8(offset);
    offset += 1;
  }

  const { form } = readPropertyForm(bytes, view, offset, dataType, formFlag);

  return {
    objectPropertyCode,
    dataType,
    getSet,
    defaultValue: defaultValue.value,
    groupCode,
    formFlag,
    form,
  };
}

/** Decode a data payload that holds a uint32 count and that many uint16s. */
function decodeUint16List(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 4) {
    return [];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const available = Math.floor((bytes.byteLength - 4) / 2);
  const out = [];

  for (let i = 0; i < Math.min(count, available); i += 1) {
    out.push(view.getUint16(4 + i * 2, true));
  }

  return out;
}

/** Encode a uint32 count followed by that many uint32s. */
function encodeUint32List(values) {
  if (!Array.isArray(values)) {
    throw new TypeError('values must be an array of unsigned 32-bit integers.');
  }

  const out = new Uint8Array(4 + values.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, values.length, true);

  values.forEach((value, index) => {
    view.setUint32(4 + index * 4, readUint32(value, `values[${index}]`), true);
  });

  return out;
}

/**
 * Encode a property list for SendObjectPropList.
 * @param {Array<{handle?: number, property: number, datatype: number, value: any}>} entries
 * @returns {Uint8Array}
 */
export function encodeObjectPropList(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array.');
  }

  const parts = entries.map(entry => {
    const datatype = readUint16(
      entry.datatype ?? MTP_DATATYPE.UINT32,
      'datatype',
    );
    const head = new Uint8Array(8);
    const view = new DataView(head.buffer);
    view.setUint32(0, readUint32(entry.handle ?? 0, 'handle'), true);
    view.setUint16(4, readUint16(entry.property, 'property'), true);
    view.setUint16(6, datatype, true);
    return [head, encodePropertyValue(datatype, entry.value)];
  });

  const total =
    4 +
    parts.reduce(
      (sum, [head, value]) => sum + head.byteLength + value.byteLength,
      0,
    );
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, entries.length, true);

  let offset = 4;
  for (const [head, value] of parts) {
    out.set(head, offset);
    offset += head.byteLength;
    out.set(value, offset);
    offset += value.byteLength;
  }

  return out;
}

/**
 * Decode a property list from GetObjectPropList.
 * @param {ArrayBuffer|Uint8Array} input
 */
export function decodeObjectPropList(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 4) {
    throw new RangeError(
      `Property list is too short: ${bytes.byteLength} bytes`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const elements = [];
  let offset = 4;

  for (let i = 0; i < count; i += 1) {
    if (offset + 8 > bytes.byteLength) {
      break;
    }
    const handle = view.getUint32(offset, true);
    offset += 4;
    const property = view.getUint16(offset, true);
    offset += 2;
    const datatype = view.getUint16(offset, true);
    offset += 2;

    const decoded = decodePropertyValue(bytes, view, offset, datatype);
    offset = decoded.offset;

    elements.push({
      handle,
      property,
      propertyName: propertyName(property),
      datatype,
      value: decoded.value,
    });
  }

  return { count, elements };
}

/** Decode a data payload that holds a uint32 count and that many uint32s. */
function decodeUint32List(input) {
  const bytes = normalizeBytes(input);
  if (bytes.byteLength < 4) {
    return [];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  const available = Math.floor((bytes.byteLength - 4) / 4);
  const out = [];

  for (let i = 0; i < Math.min(count, available); i += 1) {
    out.push(view.getUint32(4 + i * 4, true));
  }

  return out;
}

/**
 * @typedef {object} MtpResponse
 * @property {string} code
 * @property {number} codeValue
 * @property {number} transactionID
 * @property {number[]} [parameters]
 */

/** Error thrown when the device answers with a non-OK response code. */
export class MtpResponseError extends Error {
  /**
   * @param {MtpResponse} response Parsed response container.
   * @param {number} [operation] Operation code that caused the response.
   */
  constructor(response, operation) {
    const operationName = operation == null ? null : findName(CODE, operation);
    const codeValue = Number(response.codeValue ?? 0);
    const codeSuffix = Number.isFinite(codeValue)
      ? ` (0x${codeValue.toString(16).padStart(4, '0')})`
      : '';
    const prefix = operationName
      ? `MTP command ${operationName} failed`
      : 'MTP command failed';

    super(`${prefix}: ${response.code ?? 'Unknown response'}${codeSuffix}`);
    this.name = 'MtpResponseError';
    this.code = response.code;
    this.codeValue = response.codeValue;
    this.transactionID = response.transactionID;
    this.operation = operationName;
  }
}

function isPartialOrderError(error) {
  return (
    error instanceof MtpResponseError &&
    (error.codeValue === CODE.PARAMETER_NOT_SUPPORTED.value ||
      error.codeValue === CODE.INVALID_PARAMETER.value)
  );
}

function isGeneralError(error) {
  return (
    error instanceof MtpResponseError &&
    error.codeValue === CODE.GENERAL_ERROR.value
  );
}

const MAX_FILENAME_LENGTH = 255;
const MAX_UPLOAD_NAME_ATTEMPTS = 10;

function splitFilename(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return { base: filename, extension: '' };
  }
  return {
    base: filename.slice(0, dot),
    extension: filename.slice(dot),
  };
}

function numberedFilename(filename, number) {
  const { base, extension } = splitFilename(filename);
  const suffix = ` (${number})`;
  const baseLength = Math.max(
    0,
    MAX_FILENAME_LENGTH - extension.length - suffix.length,
  );
  return `${base.slice(0, baseLength)}${suffix}${extension}`;
}

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('The upload was aborted.', 'AbortError');
  }

  const error = new Error('The upload was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * @typedef {object} MtpLogger
 * @property {(message: string, context?: object) => void} [debug]
 * @property {(message: string, context?: object) => void} [info]
 * @property {(message: string, context?: object) => void} [warn]
 * @property {(message: string, context?: object) => void} [error]
 */

/**
 * @typedef {object} MtpOptions
 * @property {number} [maxContainerLength] Largest accepted inbound container.
 * @property {number} [readTimeoutMs] Idle read timeout.
 * @property {number} [transferDeadlineMs] Total read deadline.
 * @property {number} [maxEventBlocks] Consecutive event blocks allowed.
 * @property {'silent'|'error'|'warn'|'info'|'debug'} [logLevel] Log threshold.
 *   Default `silent`.
 * @property {MtpLogger} [logger] Custom log sink.
 * @property {number} [writeChunkSize] USB OUT payload chunk size. Default 512.
 * @property {boolean} [sendZeroLengthPacket] End aligned data phases with a ZLP.
 */

/**
 * @typedef {object} UploadStreamOptions
 * @property {AbortSignal} [signal]
 * @property {(sent: number) => void} [onProgress]
 */

export default class Mtp extends EventTarget {
  /**
   * Returns true when this browser can use WebUSB for MTP.
   * @param {NavigatorLike} [navigatorLike]
   * @returns {boolean}
   */
  static isSupported(navigatorLike = globalThis.navigator) {
    return isSupported(navigatorLike);
  }

  /**
   * @param {number} vendorId
   * @param {number} productId
   * @param {USBDevice} [device]
   * @param {MtpOptions} [options]
   */
  constructor(vendorId, productId, device, options = {}) {
    super();
    const settings = options ?? {};
    this.maxContainerLength = positiveInteger(
      settings.maxContainerLength,
      DEFAULT_MAX_CONTAINER_LENGTH,
      'maxContainerLength',
    );
    if (this.maxContainerLength < 12) {
      throw new RangeError('maxContainerLength must be at least 12 bytes.');
    }
    this.readTimeoutMs = positiveInteger(
      settings.readTimeoutMs,
      DEFAULT_READ_TIMEOUT_MS,
      'readTimeoutMs',
    );
    this.transferDeadlineMs = positiveInteger(
      settings.transferDeadlineMs,
      DEFAULT_TRANSFER_DEADLINE_MS,
      'transferDeadlineMs',
    );
    this.maxEventBlocks = positiveInteger(
      settings.maxEventBlocks,
      DEFAULT_MAX_EVENT_BLOCKS,
      'maxEventBlocks',
    );
    this.logLevel = normalizeLogLevel(settings.logLevel);
    this.logger = createLogger(settings.logger);
    this.writeChunkSize = positiveInteger(
      settings.writeChunkSize,
      DEFAULT_WRITE_CHUNK_SIZE,
      'writeChunkSize',
    );
    if (this.writeChunkSize < 13) {
      throw new RangeError('writeChunkSize must be at least 13 bytes.');
    }
    this.sendZeroLengthPacket = Boolean(settings.sendZeroLengthPacket);
    this.state = 'initializing';
    this.transactionID = 0;
    this.device = device ?? null;
    this.usbconfig = null;
    this.sessionOpen = false;
    this.lastError = null;

    // Commands share one transaction stream and one receive buffer. Run them
    // one at a time so two callers cannot interleave transaction IDs.
    this._operationQueue = Promise.resolve();
    this._closing = false;
    this._closePromise = null;
    this._recovering = false;
    this._recoveryPromise = null;
    this.transportHealthy = true;
    this.partialOrder = null;
    this.partialState = 'unknown';

    // Incoming bytes are buffered here because a single USB transfer can
    // contain more than one MTP container (or half of one).
    this._rxBuffer = new Uint8Array(0);
    this._rxLength = 0;

    // Attach the rejection handler immediately: consumers use the `error`
    // event, but `ready` stays awaitable for anyone who prefers promises.
    this.ready = this._initialize(vendorId, productId);
    this.ready.catch(error => this._emitError(error));
  }

  async _initialize(vendorId, productId) {
    // The Node.js entry sets the `usb` shim through setUsbTransport(). The
    // browser entry reads WebUSB from the global scope.
    if (this.device == null) {
      const transport = usbTransport ?? globalThis.navigator?.usb;

      if (!transport) {
        throw new Error('WebUSB is not available in this environment.');
      }

      const devices = await transport.getDevices();
      this.device =
        devices.find(
          candidate =>
            (vendorId == null || candidate.vendorId === vendorId) &&
            (productId == null || candidate.productId === productId),
        ) ?? null;

      if (this.device == null) {
        if (vendorId == null) {
          throw new Error(
            'No device available. Pass a USBDevice or a vendorId/productId.',
          );
        }
        const filter = { vendorId };
        if (productId != null) {
          filter.productId = productId;
        }
        this.device = await transport.requestDevice({ filters: [filter] });
      }
    }

    if (this.device == null) {
      throw new Error('No device available.');
    }

    await this._openDevice();

    this.state = 'open';
    this.dispatchEvent(new Event('ready'));
    return this;
  }

  async _openDevice() {
    this.usbconfig = null;

    // Chromium can report a device as opened while its interface is still
    // claimed by the previous page. Closing first makes reopening reliable.
    if (this.device.opened) {
      await withTimeout(
        this.device.close(),
        SETUP_TIMEOUT_MS,
        'Timed out while closing the MTP device.',
      );
    }
    await withTimeout(
      this.device.open(),
      SETUP_TIMEOUT_MS,
      'Timed out while opening the MTP device.',
    );

    let configuration = await this._selectConfiguration();
    let claimError = await this._claimInterfaces(
      this._findBulkInterfaces(configuration),
    );

    // A stale owner can leave the interface claimed after the device reports
    // that it is open. Reset once and try again before giving up.
    if (this.usbconfig == null && typeof this.device.reset === 'function') {
      try {
        await withTimeout(
          this.device.reset(),
          SETUP_TIMEOUT_MS,
          'Timed out while resetting the MTP device.',
        );
        if (!this.device.opened) {
          await withTimeout(
            this.device.open(),
            SETUP_TIMEOUT_MS,
            'Timed out while reopening the MTP device.',
          );
        }
        configuration = await this._selectConfiguration();
        await this._claimInterfaces(this._findBulkInterfaces(configuration));
      } catch (error) {
        claimError ??= error;
      }
    }

    if (this.usbconfig == null) {
      throw new Error(
        'Unable to claim the MTP interface. Close Photos, Image Capture, ' +
          'Android File Transfer, or ADB, then reconnect the device.',
        { cause: claimError },
      );
    }

    // Kept for backwards compatibility with anyone inspecting device.usbconfig.
    try {
      const deviceWithConfig = /** @type {USBDevice & {usbconfig?: object}} */ (
        this.device
      );
      deviceWithConfig.usbconfig = this.usbconfig;
    } catch {
      // Some WebUSB implementations expose non-extensible device objects.
    }
  }

  /**
   * Reopen the USB transport and start a new MTP session after a transport
   * failure. The same USBDevice must still be connected.
   * @returns {Promise<this>}
   */
  async recover() {
    if (this._recovering) {
      throw new Error('The MTP connection is already recovering.');
    }
    if (this._closing || this.state === 'closed') {
      throw new Error('The MTP instance is closed. Create a new Mtp instance.');
    }
    if (!this.device) {
      throw new Error('The MTP device is not available. Connect it again.');
    }

    this._recovering = true;
    const recovery = this._recoverTransport();
    this._recoveryPromise = recovery;

    try {
      return await recovery;
    } finally {
      this._recovering = false;
      this._recoveryPromise = null;
    }
  }

  async _recoverTransport() {
    await this._operationQueue.catch(() => {});

    if (this._closing) {
      throw new Error('The MTP instance is closing.');
    }

    this.transportHealthy = false;
    this.sessionOpen = false;
    this._resetReader();
    this.transactionID = 0;
    this.partialOrder = null;
    this.partialState = 'unknown';
    this.lastError = null;

    try {
      await this._openDevice();
      this.transportHealthy = true;
      this.state = 'open';
      await this._openSessionDirect();
      return this;
    } catch (error) {
      this.transportHealthy = false;
      throw new Error(
        `Could not recover the MTP connection: ${error.message}`,
        { cause: error },
      );
    }
  }

  /**
   * Reset the USB device directly. Use this after a stalled bulk transfer when
   * the device no longer accepts data. It ends the MTP session.
   */
  async resetUsbDevice() {
    if (!this.device || typeof this.device.reset !== 'function') {
      throw new Error('USB reset is not available for this device.');
    }

    this._log('warn', 'resetting USB device');
    try {
      await withTimeout(
        this.device.reset(),
        SETUP_TIMEOUT_MS,
        'Timed out while resetting the USB device.',
      );
    } catch (error) {
      this._log('error', 'USB device reset failed', { error });
      throw error;
    }

    this.sessionOpen = false;
    this.transportHealthy = false;
    this._resetReader();
    this._log('info', 'USB device reset complete');
  }

  async _selectConfiguration() {
    const current = this.device.configuration;
    const configurations = this.device.configurations ?? [];
    let target = current;

    if (!this._hasMtpInterface(current)) {
      target =
        configurations.find(configuration =>
          this._hasMtpInterface(configuration),
        ) ??
        current ??
        configurations[0];
    }

    if (target == null) {
      await withTimeout(
        this.device.selectConfiguration(
          configurations[0]?.configurationValue ?? 1,
        ),
        SETUP_TIMEOUT_MS,
        'Timed out while selecting the MTP configuration.',
      );
      return this.device.configuration;
    }

    if (
      current == null ||
      target.configurationValue !== current.configurationValue
    ) {
      await withTimeout(
        this.device.selectConfiguration(target.configurationValue),
        SETUP_TIMEOUT_MS,
        'Timed out while selecting the MTP configuration.',
      );
    }

    return this.device.configuration ?? target;
  }

  _hasMtpInterface(configuration) {
    if (configuration == null) {
      return false;
    }

    return (configuration.interfaces ?? []).some(iface =>
      this._alternates(iface).some(
        alternate => alternate.interfaceClass === USB_CLASS_STILL_IMAGE,
      ),
    );
  }

  _alternates(iface) {
    if (iface.alternates?.length) {
      return iface.alternates;
    }
    return iface.alternate ? [iface.alternate] : [];
  }

  /**
   * Choose the best interface for MTP: every still-image candidate first, then
   * a vendor-specific bulk interface. ADB is never a valid fallback.
   */
  _findBulkInterfaces(configuration) {
    if (configuration == null) {
      throw new Error('The USB device has no active configuration.');
    }

    const mtp = [];
    const fallback = [];
    let sawAdb = false;

    for (const iface of configuration.interfaces ?? []) {
      for (const alternate of this._alternates(iface)) {
        const endpoints = alternate.endpoints ?? [];
        const epOut = endpoints.find(
          ep => ep.direction === 'out' && ep.type === 'bulk',
        );
        const epIn = endpoints.find(
          ep => ep.direction === 'in' && ep.type === 'bulk',
        );

        if (!epOut || !epIn) {
          continue;
        }

        const isAdb =
          alternate.interfaceClass === USB_CLASS_VENDOR &&
          alternate.interfaceSubclass === USB_SUBCLASS_ADB;
        if (isAdb) {
          sawAdb = true;
          continue;
        }

        const candidate = {
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alternate.alternateSetting ?? 0,
          outEPnum: epOut.endpointNumber,
          inEPnum: epIn.endpointNumber,
          outPacketSize: epOut.packetSize || 512,
          inPacketSize: epIn.packetSize || 512,
        };

        const isMtp =
          alternate.interfaceClass === USB_CLASS_STILL_IMAGE &&
          alternate.interfaceSubclass === 1 &&
          alternate.interfaceProtocol === 1;

        if (isMtp) {
          mtp.push(candidate);
        } else {
          fallback.push(candidate);
        }
      }
    }

    if (mtp.length > 0) {
      return mtp;
    }

    if (fallback.length > 0) {
      console.warn(
        'The device does not report the standard MTP interface. ' +
          `Using vendor-specific interface ${fallback[0].interfaceNumber}. ` +
          'Confirm that this is the correct device.',
      );
      return fallback;
    }

    if (sawAdb) {
      throw new Error(
        'Only the Android Debug Bridge (ADB) interface is available. ' +
          'Disable USB debugging or close ADB, then reconnect the device.',
      );
    }

    throw new Error(
      'Could not find a usable USB interface with bulk IN/OUT endpoints.',
    );
  }

  async _claimInterfaces(candidates) {
    let lastError = null;

    for (const candidate of candidates) {
      try {
        await withTimeout(
          this.device.claimInterface(candidate.interfaceNumber),
          SETUP_TIMEOUT_MS,
          'Timed out while claiming the MTP interface.',
        );

        if (candidate.alternateSetting !== 0) {
          await withTimeout(
            this.device.selectAlternateInterface(
              candidate.interfaceNumber,
              candidate.alternateSetting,
            ),
            SETUP_TIMEOUT_MS,
            'Timed out while selecting the MTP alternate interface.',
          );
        }

        this.usbconfig = candidate;
        return null;
      } catch (error) {
        lastError = error;
        await this.device
          .releaseInterface(candidate.interfaceNumber)
          .catch(() => {});
      }
    }

    return lastError;
  }

  _emitError(error) {
    this.lastError = error;
    const message = error?.message ?? String(error);

    let event;
    if (typeof ErrorEvent === 'function') {
      event = new ErrorEvent('error', { error, message });
    } else if (typeof CustomEvent === 'function') {
      event = new CustomEvent('error', { detail: error });
    } else {
      // Very old runtimes without CustomEvent still get the event type.
      event = new Event('error');
    }

    this.dispatchEvent(event);
  }

  getName(list, idx) {
    return findName(list, idx);
  }

  /** True until a USB or protocol failure desynchronizes the transport. */
  isTransportHealthy() {
    return this.transportHealthy;
  }

  _log(level, message, context) {
    if (LOG_LEVELS[level] > LOG_LEVELS[this.logLevel]) {
      return;
    }
    const write = this.logger[level];
    if (write) {
      write(`[mtp-web] ${message}`, context);
    }
  }

  setLogLevel(level) {
    this.logLevel = normalizeLogLevel(level);
  }

  getLogLevel() {
    return this.logLevel;
  }

  /**
   * Build a container and advance the transaction ID.
   * @param {{type: number, code: number, payload?: number[]}} container
   */
  buildContainerPacket(container) {
    const packet = buildContainerPacket(this.transactionID, container);
    this.transactionID = (this.transactionID + 1) >>> 0;
    return packet;
  }

  parseContainerPacket(bytes, length) {
    return parseContainerPacket(bytes, length);
  }

  _append(chunk) {
    const needed = this._rxLength + chunk.byteLength;
    if (needed > this._rxBuffer.byteLength) {
      let capacity = Math.max(this._rxBuffer.byteLength, 1024);
      while (capacity < needed) {
        capacity *= 2;
      }
      const next = new Uint8Array(capacity);
      next.set(this._rxBuffer.subarray(0, this._rxLength));
      this._rxBuffer = next;
    }
    this._rxBuffer.set(chunk, this._rxLength);
    this._rxLength = needed;
  }

  _take(count) {
    const out = this._rxBuffer.slice(0, count);
    const remaining = this._rxLength - count;

    if (remaining === 0) {
      // Release the buffer's capacity; a large read should not pin memory
      // for the rest of the session.
      this._resetReader();
    } else {
      this._rxBuffer.copyWithin(0, count, this._rxLength);
      this._rxLength = remaining;
    }

    return out;
  }

  _resetReader() {
    this._rxBuffer = new Uint8Array(0);
    this._rxLength = 0;
  }

  async _readExactly(count, deadline = Date.now() + this.transferDeadlineMs) {
    if (!this.usbconfig) {
      throw new Error('The MTP device is not ready.');
    }

    let idleRounds = 0;

    while (this._rxLength < count) {
      if (Date.now() >= deadline) {
        this.transportHealthy = false;
        this._log('error', 'usb read deadline exceeded', {
          endpoint: this.usbconfig.inEPnum,
          wanted: count,
          buffered: this._rxLength,
        });
        throw new Error('MTP transfer deadline exceeded.');
      }

      let result;
      try {
        result = await withTimeout(
          Promise.resolve().then(() =>
            this.device.transferIn(
              this.usbconfig.inEPnum,
              this.usbconfig.inPacketSize,
            ),
          ),
          this.readTimeoutMs,
          'Timed out waiting for data from the MTP device.',
        );
      } catch (error) {
        this.transportHealthy = false;
        this._log('error', 'usb read failed', {
          endpoint: this.usbconfig.inEPnum,
          wanted: count,
          error,
        });
        await this._clearHalt('in', this.usbconfig.inEPnum, error);
        throw error;
      }

      if (result?.status && result.status !== 'ok') {
        this.transportHealthy = false;
        this._log('error', 'usb read status', {
          endpoint: this.usbconfig.inEPnum,
          status: result.status,
        });
        if (result.status === 'stall') {
          await this._clearHalt('in', this.usbconfig.inEPnum);
        }
        throw new Error(`USB transfer failed with status "${result.status}".`);
      }

      if (result?.data && result.data.byteLength > 0) {
        this._log('debug', 'usb read', {
          endpoint: this.usbconfig.inEPnum,
          bytes: result.data.byteLength,
        });
        this._append(toUint8Array(result.data));
        idleRounds = 0;
        continue;
      }

      // An empty packet is normal while the device is still preparing data,
      // but a device that never answers should not hang the caller forever.
      idleRounds += 1;
      if (idleRounds * 10 >= this.readTimeoutMs) {
        this.transportHealthy = false;
        throw new Error('Timed out waiting for data from the MTP device.');
      }
      await delay(10);
    }
  }

  /** Read exactly one complete MTP container. */
  async read(deadline = Date.now() + this.transferDeadlineMs) {
    await this._readExactly(12, deadline);

    const header = new DataView(
      this._rxBuffer.buffer,
      this._rxBuffer.byteOffset,
      12,
    );
    const containerLength = header.getUint32(0, true);

    if (containerLength < 12) {
      this.transportHealthy = false;
      throw new Error(`Invalid MTP container length: ${containerLength}`);
    }
    if (containerLength > this.maxContainerLength) {
      this.transportHealthy = false;
      throw new RangeError(
        `MTP container length ${containerLength} exceeds the limit of ` +
          `${this.maxContainerLength} bytes.`,
      );
    }

    await this._readExactly(containerLength, deadline);

    const bytes = this._take(containerLength);
    try {
      return parseContainerPacket(
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        containerLength,
      );
    } catch (error) {
      this.transportHealthy = false;
      throw error;
    }
  }

  _countEventBlock(count) {
    const next = count + 1;
    if (next > this.maxEventBlocks) {
      this.transportHealthy = false;
      throw new Error(
        `Too many event blocks from the MTP device ` +
          `(limit ${this.maxEventBlocks}).`,
      );
    }
    return next;
  }

  /**
   * Read until the data phase of the current operation arrives. Event blocks
   * are ignored; an error response is turned into an exception instead of
   * being silently skipped (which used to leave the stream out of sync). A
   * device may answer OK without a data phase when the dataset is empty, so an
   * OK response is returned to the caller as the whole result.
   */
  async readData(deadline = Date.now() + this.transferDeadlineMs, operation) {
    let eventBlocks = 0;

    for (;;) {
      const container = await this.read(deadline);

      if (container.typeValue === EVENT_BLOCK) {
        eventBlocks = this._countEventBlock(eventBlocks);
        continue;
      }
      if (container.typeValue === DATA_BLOCK) {
        return container;
      }
      if (container.typeValue === RESPONSE_BLOCK) {
        if (container.codeValue !== CODE.OK.value) {
          throw new MtpResponseError(container, operation);
        }
        return container;
      }

      this.transportHealthy = false;
      throw new Error(
        `Unexpected MTP container${operationLabel(operation)}: ${container.type}`,
      );
    }
  }

  async _readResponse(
    transactionID,
    deadline = Date.now() + this.transferDeadlineMs,
    operation,
  ) {
    let eventBlocks = 0;

    for (;;) {
      const container = await this.read(deadline);

      if (container.typeValue === EVENT_BLOCK) {
        eventBlocks = this._countEventBlock(eventBlocks);
        continue;
      }
      if (container.typeValue !== RESPONSE_BLOCK) {
        this.transportHealthy = false;
        throw new Error(
          `Expected a response block, received ${container.type}` +
            `${operationLabel(operation)}.`,
        );
      }
      if (container.transactionID !== transactionID) {
        this.transportHealthy = false;
        throw new Error(
          `Unexpected transaction ID ${container.transactionID} ` +
            `(expected ${transactionID})${operationLabel(operation)}.`,
        );
      }
      return container;
    }
  }

  /**
   * Read one MTP event container. The device sends events at any time. A
   * timeout desynchronizes the transport because WebUSB cannot cancel a pending
   * transfer, so use this only when the device is expected to send an event.
   * @param {number} [timeoutMs]
   */
  async readEvent(timeoutMs = this.transferDeadlineMs) {
    const timeout = positiveInteger(
      timeoutMs,
      this.transferDeadlineMs,
      'timeoutMs',
    );

    return this._enqueue(async () => {
      const container = await this.read(Date.now() + timeout);
      if (container.typeValue !== EVENT_BLOCK) {
        this.transportHealthy = false;
        throw new Error(`Expected an MTP event, received ${container.type}.`);
      }
      return container;
    });
  }

  _enqueue(operation) {
    if (this._closing) {
      return Promise.reject(new Error('The MTP device is closing.'));
    }
    if (!this.transportHealthy) {
      return Promise.reject(new Error(TRANSPORT_OUT_OF_SYNC));
    }

    const run = this._operationQueue.then(() => {
      if (!this.transportHealthy) {
        throw new Error(TRANSPORT_OUT_OF_SYNC);
      }
      return operation();
    });

    this._operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Send a command and consume its data (optional) and response phases.
   */
  async _execute(container, options = {}) {
    return this._enqueue(() => this._executeDirect(container, options));
  }

  async _executeDirect(
    container,
    { expectData = false, sendData = null, acceptCodes = [] } = {},
  ) {
    const transactionID = this.transactionID;
    this._log('debug', 'command', {
      code: findName(CODE, container.code),
      transactionID,
      parameters: container.payload ?? [],
      expectsData: expectData,
      sendDataBytes: sendData == null ? 0 : normalizeBytes(sendData).byteLength,
    });

    await this.write(this.buildContainerPacket(container));

    if (sendData != null) {
      await this._writeDataContainer(
        container.code,
        transactionID,
        normalizeBytes(sendData),
      );
    }

    // Start the response deadline after the request and its data have gone out.
    // A large property list must not consume the time reserved for the reply.
    const deadline = Date.now() + this.transferDeadlineMs;
    let received = null;
    if (expectData) {
      received = await this.readData(deadline, container.code);
      if (received.transactionID !== transactionID) {
        this.transportHealthy = false;
        throw new Error(
          received.typeValue === DATA_BLOCK
            ? `Unexpected data-block transaction ID ${received.transactionID} ` +
                `(expected ${transactionID}).`
            : `Unexpected transaction ID ${received.transactionID} ` +
                `(expected ${transactionID}).`,
        );
      }
    }

    const response =
      received?.typeValue === RESPONSE_BLOCK
        ? received
        : await this._readResponse(transactionID, deadline, container.code);
    const data = received?.typeValue === DATA_BLOCK ? received : null;
    this._log('debug', 'response', {
      code: response.code,
      codeValue: response.codeValue,
      transactionID: response.transactionID,
    });
    const accepted =
      response.codeValue === CODE.OK.value ||
      acceptCodes.includes(response.codeValue);

    if (!accepted) {
      this._log('error', 'command failed', {
        code: findName(CODE, container.code),
        response: response.code,
        responseCode: response.codeValue,
      });
      throw new MtpResponseError(response, container.code);
    }

    return { data, response };
  }

  _command(code, payload = []) {
    return { type: COMMAND_BLOCK, code: code.value, payload };
  }

  async _executeForData(code, payload = []) {
    const { data } = await this._execute(this._command(code, payload), {
      expectData: true,
    });
    return data ? data.payload : new ArrayBuffer(0);
  }

  async _executeForDataDirect(code, payload = []) {
    const { data } = await this._executeDirect(this._command(code, payload), {
      expectData: true,
    });
    return data ? data.payload : new ArrayBuffer(0);
  }

  async _executeForResponse(code, payload = [], options = {}) {
    const { response } = await this._execute(
      this._command(code, payload),
      options,
    );
    return response;
  }

  async write(buffer) {
    if (!this.usbconfig) {
      throw new Error('The MTP device is not ready.');
    }

    const bytes = normalizeBytes(buffer);
    let offset = 0;
    this._log('debug', 'usb write', {
      endpoint: this.usbconfig.outEPnum,
      bytes: bytes.byteLength,
    });

    while (offset < bytes.byteLength) {
      const remaining = bytes.byteLength - offset;
      let result;

      try {
        result = await withTimeout(
          Promise.resolve().then(() =>
            this.device.transferOut(
              this.usbconfig.outEPnum,
              /** @type {BufferSource} */ (bytes.subarray(offset)),
            ),
          ),
          WRITE_TIMEOUT_MS,
          'Timed out waiting for the MTP device to accept data.',
        );
      } catch (error) {
        this.transportHealthy = false;
        this._log('error', 'usb write failed', {
          endpoint: this.usbconfig.outEPnum,
          bytes: remaining,
          error,
        });
        await this._clearHalt('out', this.usbconfig.outEPnum, error);
        throw error;
      }

      if (result?.status && result.status !== 'ok') {
        this.transportHealthy = false;
        this._log('error', 'usb write status', {
          endpoint: this.usbconfig.outEPnum,
          status: result.status,
        });
        if (result.status === 'stall') {
          await this._clearHalt('out', this.usbconfig.outEPnum);
        }
        throw new Error(`USB transfer failed with status "${result.status}".`);
      }

      const written = result?.bytesWritten ?? remaining;
      if (!(written > 0)) {
        this.transportHealthy = false;
        throw new Error('USB write stalled before the buffer was complete.');
      }

      offset += Math.min(written, remaining);
    }

    return { status: 'ok', bytesWritten: bytes.byteLength };
  }

  _dataContainerHeader(code, transactionID, payloadLength) {
    const header = new Uint8Array(12);
    writeContainerHeader(
      new DataView(header.buffer),
      12 + payloadLength,
      DATA_BLOCK,
      code,
      transactionID,
    );
    return header;
  }

  /**
   * Write one data container. The header and the first payload bytes go out in
   * one transfer. Some devices treat a header-only short transfer as the end of
   * the data phase and then reject the payload.
   * @param {number} code
   * @param {number} transactionID
   * @param {Uint8Array} bytes
   * @param {UploadStreamOptions} [options]
   */
  async _writeDataContainer(
    code,
    transactionID,
    bytes,
    { signal, onProgress } = {},
  ) {
    const header = this._dataContainerHeader(
      code,
      transactionID,
      bytes.byteLength,
    );
    let sent = 0;

    if (bytes.byteLength === 0) {
      await this.write(header);
    } else {
      const firstLength = Math.min(bytes.byteLength, this.writeChunkSize - 12);
      if (signal?.aborted) {
        throw createAbortError();
      }

      const first = new Uint8Array(12 + firstLength);
      first.set(header, 0);
      first.set(bytes.subarray(0, firstLength), 12);
      await this.write(first);
      sent = firstLength;
      onProgress?.(sent);

      while (sent < bytes.byteLength) {
        if (signal?.aborted) {
          throw createAbortError();
        }

        const end = Math.min(sent + this.writeChunkSize, bytes.byteLength);
        await this.write(bytes.subarray(sent, end));
        sent = end;
        onProgress?.(sent);
      }
    }

    await this._endDataPhase(12 + bytes.byteLength);
    return sent;
  }

  /**
   * @param {number} code
   * @param {number} transactionID
   * @param {AsyncIterable<Uint8Array>} iterable
   * @param {number} size
   * @param {UploadStreamOptions} [options]
   */
  async _writeDataContainerIterable(
    code,
    transactionID,
    iterable,
    size,
    { signal, onProgress } = {},
  ) {
    const header = this._dataContainerHeader(code, transactionID, size);
    const iterator = iterable[Symbol.asyncIterator]();
    let sent = 0;
    let headerSent = false;

    for (;;) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const { value, done } = await iterator.next();
      if (done) {
        break;
      }

      let chunk = normalizeBytes(value);
      if (chunk.byteLength === 0) {
        continue;
      }
      if (sent + chunk.byteLength > size) {
        throw new RangeError(
          `Upload data exceeds the declared size of ${size} bytes.`,
        );
      }

      if (!headerSent) {
        const firstLength = Math.min(
          chunk.byteLength,
          this.writeChunkSize - 12,
        );
        const first = new Uint8Array(12 + firstLength);
        first.set(header, 0);
        first.set(chunk.subarray(0, firstLength), 12);
        await this.write(first);
        headerSent = true;
        sent = firstLength;
        onProgress?.(sent);
        chunk = chunk.subarray(firstLength);
      }

      while (chunk.byteLength > 0) {
        if (signal?.aborted) {
          throw createAbortError();
        }

        const length = Math.min(chunk.byteLength, this.writeChunkSize);
        await this.write(chunk.subarray(0, length));
        sent += length;
        onProgress?.(sent);
        chunk = chunk.subarray(length);
      }
    }

    if (!headerSent) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      await this.write(header);
    }
    if (sent === size) {
      await this._endDataPhase(12 + size);
    }

    return sent;
  }

  /**
   * A data phase that ends on an exact packet boundary needs a zero-length
   * packet. Without it some devices keep waiting for more bytes and never send
   * the response. The container length is not enough for those devices.
   */
  async _endDataPhase(dataPhaseLength) {
    const packetSize = this.usbconfig?.outPacketSize || 512;
    if (
      this.sendZeroLengthPacket &&
      dataPhaseLength > 0 &&
      dataPhaseLength % packetSize === 0
    ) {
      await this._writeZeroLengthPacket();
    }
  }

  async _writeZeroLengthPacket() {
    if (!this.usbconfig) {
      throw new Error('The MTP device is not ready.');
    }

    let result;
    try {
      result = await withTimeout(
        Promise.resolve().then(() =>
          this.device.transferOut(this.usbconfig.outEPnum, new Uint8Array(0)),
        ),
        WRITE_TIMEOUT_MS,
        'Timed out while ending the MTP data phase.',
      );
    } catch (error) {
      this._log('warn', 'zero-length packet failed; waiting for the response', {
        endpoint: this.usbconfig.outEPnum,
        error,
      });
      await this._clearHalt('out', this.usbconfig.outEPnum, error);
      return false;
    }

    if (result?.status && result.status !== 'ok') {
      this._log('warn', 'zero-length packet returned a non-ok status', {
        endpoint: this.usbconfig.outEPnum,
        status: result.status,
      });
      return false;
    }

    this._log('debug', 'zero-length packet sent', {
      endpoint: this.usbconfig.outEPnum,
    });
    return true;
  }

  async _clearHalt(direction, endpointNumber, error) {
    if (!this.device?.clearHalt) {
      return;
    }
    this._log('debug', 'clearing endpoint halt', {
      direction,
      endpointNumber,
      error,
    });
    await this.device.clearHalt(direction, endpointNumber).catch(clearError => {
      this._log('warn', 'could not clear endpoint halt', {
        direction,
        endpointNumber,
        error: clearError,
      });
    });
  }

  async openSession() {
    return this._enqueue(() => this._openSessionDirect());
  }

  async _openSessionDirect() {
    // OpenSession is required to use transaction ID 0.
    this.transactionID = 0;

    let { response } = await this._executeDirect(
      this._command(CODE.OPEN_SESSION, [1]),
      { acceptCodes: [CODE.SESSION_ALREADY_OPEN.value] },
    );

    if (response.codeValue === CODE.SESSION_ALREADY_OPEN.value) {
      // A previous session was never closed (crashed tab, stale connection).
      await this._closeSessionDirect();
      this.transactionID = 0;
      ({ response } = await this._executeDirect(
        this._command(CODE.OPEN_SESSION, [1]),
      ));
    }

    this.sessionOpen = true;
    return response;
  }

  async closeSession() {
    return this._enqueue(() => this._closeSessionDirect());
  }

  async _closeSessionDirect() {
    if (!this.device || this.state !== 'open') {
      this.sessionOpen = false;
      return;
    }

    await this._executeDirect(this._command(CODE.CLOSE_SESSION), {
      acceptCodes: [CODE.SESSION_NOT_OPEN.value],
    });
    this.sessionOpen = false;
  }

  /**
   * Read the PTP DeviceInfo dataset. The device permits this command before
   * a session starts.
   * @returns {Promise<object>}
   */
  async getDeviceInfo() {
    return decodeDeviceInfo(await this._executeForData(CODE.GET_DEVICE_INFO));
  }

  /**
   * Read the thumbnail for one object.
   * @param {number} objectHandle
   * @returns {Promise<Uint8Array>} Empty when the device has no thumbnail.
   */
  async getThumb(objectHandle) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const payload = await this._executeForData(CODE.GET_THUMB, [handle]);

    return new Uint8Array(payload);
  }

  /**
   * Read the descriptor for one device property.
   * @param {number} property Device property code.
   * @returns {Promise<DevicePropDesc>}
   */
  async getDevicePropDesc(property) {
    return this._getDevicePropDescDirect(readUint16(property, 'property'));
  }

  async _getDevicePropDescDirect(property) {
    return decodeDevicePropDesc(
      await this._executeForDataDirect(CODE.GET_DEVICE_PROP_DESC, [property]),
    );
  }

  /**
   * Read one device property when the caller already knows its data type.
   * Use getDeviceProperty() when the data type is unknown.
   * @param {number} property Device property code.
   * @param {number} datatype
   */
  async getDevicePropValue(property, datatype) {
    const propertyCode = readUint16(property, 'property');
    const dataType = readUint16(datatype, 'datatype');
    const payload = await this._executeForData(CODE.GET_DEVICE_PROP_VALUE, [
      propertyCode,
    ]);

    return decodePropertyValueData(payload, dataType);
  }

  /**
   * Write one device property when the caller already knows its data type.
   * @param {number} property Device property code.
   * @param {any} value
   * @param {number} datatype
   */
  async setDevicePropValue(property, value, datatype) {
    return this._executeForResponse(
      CODE.SET_DEVICE_PROP_VALUE,
      [readUint16(property, 'property')],
      {
        sendData: encodePropertyValue(readUint16(datatype, 'datatype'), value),
      },
    );
  }

  /** Restore one device property to its factory default. */
  async resetDevicePropValue(property) {
    return this._executeForResponse(CODE.RESET_DEVICE_PROP_VALUE, [
      readUint16(property, 'property'),
    ]);
  }

  /**
   * Read one device property with its descriptor.
   * @param {number} property Device property code.
   * @returns {Promise<{descriptor: DevicePropDesc, value: any}>}
   */
  async getDeviceProperty(property) {
    return this._enqueue(() => this._getDevicePropertyDirect(property));
  }

  async _getDevicePropertyDirect(property) {
    const propertyCode = readUint16(property, 'property');
    const descriptor = await this._getDevicePropDescDirect(propertyCode);
    const payload = await this._executeForDataDirect(
      CODE.GET_DEVICE_PROP_VALUE,
      [propertyCode],
    );

    return {
      descriptor,
      value: decodePropertyValueData(payload, descriptor.dataType),
    };
  }

  /**
   * Write one device property and read its data type from the descriptor when
   * the caller does not supply one.
   * @param {number} property Device property code.
   * @param {any} value
   * @param {number} [datatype]
   */
  async setDeviceProperty(property, value, datatype) {
    return this._enqueue(() =>
      this._setDevicePropertyDirect(property, value, datatype),
    );
  }

  async _setDevicePropertyDirect(property, value, datatype) {
    const propertyCode = readUint16(property, 'property');
    const dataType =
      datatype == null
        ? (await this._getDevicePropDescDirect(propertyCode)).dataType
        : readUint16(datatype, 'datatype');
    const { response } = await this._executeDirect(
      this._command(CODE.SET_DEVICE_PROP_VALUE, [propertyCode]),
      { sendData: encodePropertyValue(dataType, value) },
    );

    return response;
  }

  /**
   * Read part of one object with GetPartialObject64. Devices disagree about
   * the order of the 64-bit offset words, so the first parameter error retries
   * with the other order and caches the one that works.
   * @param {number} objectHandle
   * @param {number} offset
   * @param {number} length
   * @param {'hiFirst'|'loFirst'} [order]
   * @returns {Promise<Uint8Array>}
   */
  async getPartial(objectHandle, offset, length, order) {
    return this._enqueue(() =>
      this._getPartialDirect(objectHandle, offset, length, order),
    );
  }

  async _getPartialDirect(objectHandle, offset, length, order) {
    readUint32(objectHandle, 'objectHandle');
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('offset must be a non-negative safe integer.');
    }
    if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
      throw new RangeError('length must be an unsigned 32-bit integer.');
    }
    if (order != null && order !== 'hiFirst' && order !== 'loFirst') {
      throw new TypeError('order must be "hiFirst" or "loFirst".');
    }

    const firstOrder = order ?? this.partialOrder ?? 'loFirst';
    const secondOrder = firstOrder === 'hiFirst' ? 'loFirst' : 'hiFirst';

    try {
      const bytes = await this._requestPartial(
        objectHandle,
        offset,
        length,
        firstOrder,
      );
      this.partialOrder = firstOrder;
      this.partialState = 'supported';
      return bytes;
    } catch (error) {
      if (!isPartialOrderError(error)) {
        throw error;
      }

      try {
        const bytes = await this._requestPartial(
          objectHandle,
          offset,
          length,
          secondOrder,
        );
        this.partialOrder = secondOrder;
        this.partialState = 'supported';
        return bytes;
      } catch (lastError) {
        this.partialOrder = null;
        this.partialState = 'unsupported';
        throw lastError;
      }
    }
  }

  async _requestPartial(objectHandle, offset, length, order) {
    const high = Math.floor(offset / 2 ** 32);
    const low = offset % 2 ** 32;
    const offsetWords = order === 'hiFirst' ? [high, low] : [low, high];

    const { data } = await this._executeDirect(
      this._command(CODE.GET_PARTIAL_OBJECT_64, [
        objectHandle,
        ...offsetWords,
        length,
      ]),
      { expectData: true },
    );

    return new Uint8Array(data.payload);
  }

  /**
   * Read part of one object with the 32-bit GetPartialObject command.
   * Use getPartial() when the offset can exceed 4 GiB.
   * @param {number} objectHandle
   * @param {number} offset
   * @param {number} length
   * @returns {Promise<Uint8Array>}
   */
  async getPartialObject(objectHandle, offset, length) {
    const payload = await this._executeForData(CODE.GET_PARTIAL_OBJECT, [
      readUint32(objectHandle, 'objectHandle'),
      readUint32(offset, 'offset'),
      readUint32(length, 'length'),
    ]);

    return new Uint8Array(payload);
  }

  /**
   * List object handles on the device.
   * @param {number} [storageId] `0xFFFFFFFF` for all storages.
   * @param {number} [format] Object format code, `0` for all formats.
   * @param {number} [parent] Parent object handle, `0xFFFFFFFF` for the root.
   * @returns {Promise<number[]>}
   */
  async getObjectHandles(
    storageId = 0xffffffff,
    format = 0,
    parent = 0xffffffff,
  ) {
    const payload = await this._executeForData(CODE.GET_OBJECT_HANDLES, [
      readUint32(storageId, 'storageId'),
      readUint32(format, 'format'),
      readUint32(parent, 'parent'),
    ]);

    return decodeUint32List(payload);
  }

  async getFileName(objectHandle) {
    return this._enqueue(() => this._getFileNameDirect(objectHandle));
  }

  async _getFileNameDirect(objectHandle) {
    const handle = readUint32(objectHandle, 'objectHandle');

    return decodeMtpString(
      await this._executeForDataDirect(CODE.GET_OBJECT_PROP_VALUE, [
        handle,
        CODE.OBJECT_FILE_NAME.value,
      ]),
    );
  }

  async getFile(objectHandle, _filename) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const payload = await this._executeForData(CODE.GET_OBJECT, [handle]);

    return new Uint8Array(payload);
  }

  /**
   * List the storage IDs on the device.
   * @returns {Promise<number[]>}
   */
  async getStorageIDs() {
    return decodeUint32List(await this._executeForData(CODE.GET_STORAGE_IDS));
  }

  /**
   * Describe one storage.
   * @param {number} storageId
   * @returns {Promise<object>}
   */
  async getStorageInfo(storageId) {
    const id = readUint32(storageId, 'storageId');
    const payload = await this._executeForData(CODE.GET_STORAGE_INFO, [id]);
    const bytes = normalizeBytes(payload);
    if (bytes.byteLength < 26) {
      throw new RangeError(
        `StorageInfo is too short: ${bytes.byteLength} bytes`,
      );
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;

    const storageType = view.getUint16(offset, true);
    offset += 2;
    const filesystemType = view.getUint16(offset, true);
    offset += 2;
    const accessCapability = view.getUint16(offset, true);
    offset += 2;
    const maxCapacity = Number(view.getBigUint64(offset, true));
    offset += 8;
    const freeSpaceInBytes = Number(view.getBigUint64(offset, true));
    offset += 8;
    const freeSpaceInObjects = view.getUint32(offset, true);
    offset += 4;

    const description = readMtpStringAt(bytes, offset);
    offset = description.offset;
    const volumeLabel = readMtpStringAt(bytes, offset);

    return {
      storageId: id,
      storageType,
      filesystemType,
      accessCapability,
      readOnly: accessCapability !== STORAGE_ACCESS.READ_WRITE,
      maxCapacity,
      freeSpaceInBytes,
      freeSpaceInObjects,
      description: description.text,
      volumeLabel: volumeLabel.text,
    };
  }

  /**
   * Format a storage. Every object in the storage is erased.
   * @param {number} storageId
   * @param {number} [filesystemType] `0` for the device default.
   */
  async formatStore(storageId, filesystemType = 0) {
    return this._executeForResponse(CODE.FORMAT_STORE, [
      readUint32(storageId, 'storageId'),
      readUint16(filesystemType, 'filesystemType'),
    ]);
  }

  /**
   * Reset the device with the MTP ResetDevice command. The session ends and a
   * new Mtp instance is required after the device reconnects.
   */
  async resetDevice() {
    const response = await this._executeForResponse(CODE.RESET_DEVICE);
    this.sessionOpen = false;
    this.transportHealthy = false;
    return response;
  }

  /** Run the device self-test. */
  async selfTest() {
    return this._executeForResponse(CODE.SELF_TEST);
  }

  /**
   * Set or clear the write-protection flag on one object.
   * @param {number} objectHandle
   * @param {number} protectionStatus `0` for none, `1` for read-only.
   */
  async setObjectProtection(objectHandle, protectionStatus) {
    return this._executeForResponse(CODE.SET_OBJECT_PROTECTION, [
      readUint32(objectHandle, 'objectHandle'),
      readUint16(protectionStatus, 'protectionStatus'),
    ]);
  }

  /**
   * Start a still-image capture.
   * @param {number} storageId
   * @param {number} [format] Object format code.
   */
  async initiateCapture(storageId, format = 0) {
    return this._executeForResponse(CODE.INITIATE_CAPTURE, [
      readUint32(storageId, 'storageId'),
      readUint16(format, 'format'),
    ]);
  }

  /**
   * Start an open capture. End it with terminateOpenCapture().
   * @param {number} storageId
   * @param {number} [format] Object format code.
   */
  async initiateOpenCapture(storageId, format = 0) {
    return this._executeForResponse(CODE.INITIATE_OPEN_CAPTURE, [
      readUint32(storageId, 'storageId'),
      readUint16(format, 'format'),
    ]);
  }

  /**
   * End an open capture.
   * @param {number} transactionId
   */
  async terminateOpenCapture(transactionId) {
    return this._executeForResponse(CODE.TERMINATE_OPEN_CAPTURE, [
      readUint32(transactionId, 'transactionId'),
    ]);
  }

  /** Power down the device. The session ends and a new instance is required. */
  async powerDown() {
    const response = await this._executeForResponse(CODE.POWER_DOWN);
    this.sessionOpen = false;
    this.transportHealthy = false;
    return response;
  }

  /**
   * Count the objects in a storage or folder.
   * @param {number} storageId
   * @param {number} [format]
   * @param {number} [parent]
   * @returns {Promise<number>}
   */
  async getNumObjects(storageId, format = 0, parent = 0xffffffff) {
    const response = await this._executeForResponse(CODE.GET_NUM_OBJECTS, [
      readUint32(storageId, 'storageId'),
      readUint32(format, 'format'),
      readUint32(parent, 'parent'),
    ]);

    return response.parameters?.[0] ?? 0;
  }

  /**
   * Read the ObjectInfo dataset for one object.
   * @param {number} objectHandle
   * @returns {Promise<object>}
   */
  async getObjectInfo(objectHandle) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const payload = await this._executeForData(CODE.GET_OBJECT_INFO, [handle]);

    return { handle, ...decodeObjectInfo(payload) };
  }

  /**
   * Delete one object, or one folder and its contents.
   * @param {number} objectHandle
   * @returns {Promise<object>} The response container.
   */
  async deleteObject(objectHandle) {
    return this._executeForResponse(CODE.DELETE_OBJECT, [
      readUint32(objectHandle, 'objectHandle'),
    ]);
  }

  /**
   * Read object properties in one command.
   * @param {object} [options]
   * @param {number} [options.handle] `0xFFFFFFFF` for every object.
   * @param {number} [options.format] Object format code, `0` for all.
   * @param {number} [options.property] Property code, `0xFFFFFFFF` for all.
   * @param {number} [options.depth] `0` for the object only, `1` for one level.
   * @returns {Promise<{count: number, elements: Array<object>}>}
   */
  async getObjectPropertyList({
    handle = 0xffffffff,
    format = 0,
    property = 0xffffffff,
    depth = 0,
  } = {}) {
    const payload = await this._executeForData(CODE.GET_OBJECT_PROP_LIST, [
      readUint32(handle, 'handle'),
      readUint32(format, 'format'),
      readUint32(property, 'property'),
      0,
      readUint32(depth, 'depth'),
    ]);

    return decodeObjectPropList(payload);
  }

  /**
   * List the object property codes that one format supports.
   * @param {number} format Object format code.
   * @returns {Promise<number[]>}
   */
  async getObjectPropsSupported(format) {
    const payload = await this._executeForData(
      CODE.GET_OBJECT_PROPS_SUPPORTED,
      [readUint16(format, 'format')],
    );

    return decodeUint16List(payload);
  }

  /**
   * Read the descriptor for one object property.
   * @param {number} property Property code.
   * @param {number} format Object format code.
   * @returns {Promise<ObjectPropDesc>}
   */
  async getObjectPropDesc(property, format) {
    return this._getObjectPropDescDirect(
      readUint16(property, 'property'),
      readUint16(format, 'format'),
    );
  }

  async _getObjectPropDescDirect(property, format) {
    return decodeObjectPropDesc(
      await this._executeForDataDirect(CODE.GET_OBJECT_PROP_DESC, [
        property,
        format,
      ]),
    );
  }

  async _getObjectFormatDirect(objectHandle) {
    const payload = await this._executeForDataDirect(CODE.GET_OBJECT_INFO, [
      objectHandle,
    ]);
    return decodeObjectInfo(payload).format;
  }

  /**
   * Read one object property when the caller already knows its data type.
   * Use getObjectProperty() when the data type is unknown.
   * @param {number} objectHandle
   * @param {number} property
   * @param {number} datatype
   */
  async getObjectPropValue(objectHandle, property, datatype) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const propertyCode = readUint16(property, 'property');
    const dataType = readUint16(datatype, 'datatype');
    const payload = await this._executeForData(CODE.GET_OBJECT_PROP_VALUE, [
      handle,
      propertyCode,
    ]);

    return decodePropertyValueData(payload, dataType);
  }

  /**
   * Write one object property when the caller already knows its data type.
   * @param {number} objectHandle
   * @param {number} property
   * @param {any} value
   * @param {number} datatype
   */
  async setObjectPropValue(objectHandle, property, value, datatype) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const propertyCode = readUint16(property, 'property');
    const dataType = readUint16(datatype, 'datatype');

    return this._executeForResponse(
      CODE.SET_OBJECT_PROP_VALUE,
      [handle, propertyCode],
      { sendData: encodePropertyValue(dataType, value) },
    );
  }

  /**
   * Read one object property with its descriptor.
   * @param {number} objectHandle
   * @param {number} property
   * @param {number} [format] Object format code. Read from ObjectInfo when
   *   omitted.
   * @returns {Promise<{descriptor: ObjectPropDesc, value: any}>}
   */
  async getObjectProperty(objectHandle, property, format) {
    return this._enqueue(() =>
      this._getObjectPropertyDirect(objectHandle, property, format),
    );
  }

  async _getObjectPropertyDirect(objectHandle, property, format) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const propertyCode = readUint16(property, 'property');
    const objectFormat =
      format == null
        ? await this._getObjectFormatDirect(handle)
        : readUint16(format, 'format');
    const descriptor = await this._getObjectPropDescDirect(
      propertyCode,
      objectFormat,
    );
    const payload = await this._executeForDataDirect(
      CODE.GET_OBJECT_PROP_VALUE,
      [handle, propertyCode],
    );

    return {
      descriptor,
      value: decodePropertyValueData(payload, descriptor.dataType),
    };
  }

  /**
   * Write one object property and read its data type from the descriptor when
   * the caller does not supply one.
   * @param {number} objectHandle
   * @param {number} property
   * @param {any} value
   * @param {{datatype?: number, format?: number}} [options]
   */
  async setObjectProperty(objectHandle, property, value, options = {}) {
    return this._enqueue(() =>
      this._setObjectPropertyDirect(objectHandle, property, value, options),
    );
  }

  /**
   * @param {number} objectHandle
   * @param {number} property
   * @param {any} value
   * @param {{datatype?: number, format?: number}} [options]
   */
  async _setObjectPropertyDirect(
    objectHandle,
    property,
    value,
    { datatype, format } = {},
  ) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const propertyCode = readUint16(property, 'property');
    let dataType = datatype;

    if (dataType == null) {
      const objectFormat =
        format == null
          ? await this._getObjectFormatDirect(handle)
          : readUint16(format, 'format');
      dataType = (
        await this._getObjectPropDescDirect(propertyCode, objectFormat)
      ).dataType;
    } else {
      dataType = readUint16(dataType, 'datatype');
    }

    const { response } = await this._executeDirect(
      this._command(CODE.SET_OBJECT_PROP_VALUE, [handle, propertyCode]),
      { sendData: encodePropertyValue(dataType, value) },
    );

    return response;
  }

  /**
   * Write several object properties in one command.
   * @param {Array<{handle?: number, property: number, datatype: number, value: any}>} entries
   */
  async setObjectPropertyList(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError('entries must be an array.');
    }

    return this._executeForResponse(CODE.SET_OBJECT_PROP_LIST, [], {
      sendData: encodeObjectPropList(entries),
    });
  }

  /**
   * Read the object handles that one object references.
   * @param {number} objectHandle
   * @returns {Promise<number[]>}
   */
  async getObjectReferences(objectHandle) {
    const handle = readUint32(objectHandle, 'objectHandle');
    const payload = await this._executeForData(CODE.GET_OBJECT_REFERENCES, [
      handle,
    ]);

    return decodeUint32List(payload);
  }

  /**
   * Replace the object handles that one object references.
   * @param {number} objectHandle
   * @param {number[]} handles
   */
  async setObjectReferences(objectHandle, handles) {
    const handle = readUint32(objectHandle, 'objectHandle');

    return this._executeForResponse(CODE.SET_OBJECT_REFERENCES, [handle], {
      sendData: encodeUint32List(handles),
    });
  }

  /**
   * Move one object to a storage and parent folder.
   * @param {number} objectHandle
   * @param {number} storageId
   * @param {number} [parentObjectHandle] `0` for the storage root.
   */
  async moveObject(objectHandle, storageId, parentObjectHandle = 0) {
    return this._executeForResponse(CODE.MOVE_OBJECT, [
      readUint32(objectHandle, 'objectHandle'),
      readUint32(storageId, 'storageId'),
      readUint32(parentObjectHandle, 'parentObjectHandle'),
    ]);
  }

  /**
   * Copy one object to a storage and parent folder.
   * @param {number} objectHandle
   * @param {number} storageId
   * @param {number} [parentObjectHandle] `0` for the storage root.
   */
  async copyObject(objectHandle, storageId, parentObjectHandle = 0) {
    return this._executeForResponse(CODE.COPY_OBJECT, [
      readUint32(objectHandle, 'objectHandle'),
      readUint32(storageId, 'storageId'),
      readUint32(parentObjectHandle, 'parentObjectHandle'),
    ]);
  }

  /**
   * Send metadata for an object, for example the file name before an upload.
   * @param {number} storageId
   * @param {number} parentObjectHandle
   * @param {number} format
   * @param {Array<{handle?: number, property: number, datatype: number, value: any}>} entries
   * @param {number|bigint} [size] Object size in bytes.
   * @returns {Promise<object>} The response container.
   */
  async sendObjectPropertyList(
    storageId,
    parentObjectHandle,
    format,
    entries,
    size = 0,
  ) {
    const objectSize = BigInt(size);
    if (objectSize < 0n || objectSize > 0xffffffffffffffffn) {
      throw new RangeError('Object size must fit in an unsigned 64-bit value.');
    }

    const payload = [
      readUint32(storageId, 'storageId'),
      readUint32(parentObjectHandle, 'parentObjectHandle'),
      readUint16(format, 'format'),
      Number((objectSize >> 32n) & 0xffffffffn),
      Number(objectSize & 0xffffffffn),
    ];
    const properties = entries.map(entry => ({ ...entry, handle: 0 }));

    return this._executeForResponse(CODE.SEND_OBJECT_PROP_LIST, payload, {
      sendData: encodeObjectPropList(properties),
    });
  }

  /**
   * Upload one file into a folder on a storage.
   *
   * The device sends the object handle in the SendObjectInfo response. Some
   * devices omit it, so the handle is then looked up in the parent folder by
   * file name.
   *
   * An AsyncIterable upload needs `size`. An upload cannot be aborted cleanly
   * after the data phase starts. An abort at that point marks the transport
   * unhealthy.
   *
   * @param {object} options
   * @param {number} options.storageId
   * @param {number} options.parentObjectHandle Folder handle, `0xFFFFFFFF`
   *   for the storage root.
   * @param {string} options.filename
   * @param {ArrayBuffer|Uint8Array|AsyncIterable<Uint8Array>} options.data
   * @param {number} [options.size] Total size in bytes. Required for an
   *   AsyncIterable.
   * @param {(sent: number) => void} [options.onProgress] Called after each
   *   chunk with the total number of bytes sent.
   * @param {AbortSignal} [options.signal] Stops before the data phase.
   * @param {number} [options.format] Object format code.
   * @param {string} [options.dateCreated] MTP date string.
   * @param {string} [options.dateModified] MTP date string.
   * @returns {Promise<number>} The object handle of the new file.
   */
  async uploadFile(options) {
    return this._enqueue(async () => {
      this._log('info', 'upload started', {
        filename: options?.filename,
        storageId: options?.storageId,
        parentObjectHandle: options?.parentObjectHandle,
        declaredSize: options?.size,
      });

      try {
        const { handle, filename: finalFilename } =
          await this._uploadFileDirect(options);
        this._log('info', 'upload complete', {
          filename: finalFilename,
          handle,
        });
        return handle;
      } catch (error) {
        this._log('error', 'upload failed', {
          filename: options?.filename,
          error,
        });
        throw error;
      }
    });
  }

  async _uploadFileDirect(options) {
    const {
      storageId,
      parentObjectHandle,
      filename,
      data,
      size,
      onProgress,
      signal,
      format = OBJECT_FORMAT.UNDEFINED,
      dateCreated,
      dateModified,
    } = options;
    if (typeof filename !== 'string' || filename.length === 0) {
      throw new TypeError('filename must be a non-empty string.');
    }

    const storage = readUint32(storageId, 'storageId');
    const parent = readUint32(parentObjectHandle, 'parentObjectHandle');
    const objectFormat = readUint16(format, 'format');
    const source = normalizeUploadSource(data, size);
    this._log('debug', 'upload source ready', {
      size: source.size,
      streaming: Boolean(source.iterable),
    });

    const { response, filename: uploadFilename } =
      await this._sendObjectInfoForUpload({
        storage,
        parent,
        format: objectFormat,
        size: source.size,
        filename,
        dateCreated,
        dateModified,
        signal,
      });

    if (signal?.aborted) {
      throw createAbortError();
    }

    await this._sendObject(source, { signal, onProgress });

    const handle = response.parameters?.[2];
    if (handle) {
      return { handle, filename: uploadFilename };
    }

    return {
      handle: await this._findHandleByNameDirect(
        storage,
        parent,
        uploadFilename,
      ),
      filename: uploadFilename,
    };
  }

  /**
   * Send SendObjectInfo. If the device rejects a duplicate name with
   * GeneralError, retry as `name (2).ext`, `name (3).ext`, and so on.
   * @param {object} options
   * @param {number} options.storage
   * @param {number} options.parent
   * @param {number} options.format
   * @param {number} options.size
   * @param {string} options.filename
   * @param {string} [options.dateCreated]
   * @param {string} [options.dateModified]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{response: MtpResponse, filename: string}>}
   */
  async _sendObjectInfoForUpload({
    storage,
    parent,
    format,
    size,
    filename,
    dateCreated,
    dateModified,
    signal,
  }) {
    let uploadFilename = filename;

    for (let attempt = 1; attempt <= MAX_UPLOAD_NAME_ATTEMPTS; attempt += 1) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const info = encodeObjectInfo({
        storageId: storage,
        parent,
        format,
        size,
        filename: uploadFilename,
        dateCreated,
        dateModified,
      });

      try {
        const { response } = await this._executeDirect(
          this._command(CODE.SEND_OBJECT_INFO, [storage, parent]),
          { sendData: info },
        );
        return { response, filename: uploadFilename };
      } catch (error) {
        if (!isGeneralError(error) || attempt === MAX_UPLOAD_NAME_ATTEMPTS) {
          if (attempt === 1) {
            throw error;
          }
          throw new Error(
            `Upload failed for "${filename}" after ${attempt} name attempts. ` +
              `The folder may already contain that name. ${error.message}`,
            { cause: error },
          );
        }

        uploadFilename = numberedFilename(filename, attempt + 1);
        this._log('info', 'upload name already exists; retrying', {
          filename: uploadFilename,
          attempt: attempt + 1,
        });
      }
    }

    throw new Error(`Upload failed for "${filename}".`);
  }

  /**
   * @param {{size: number, bytes?: Uint8Array, iterable?: AsyncIterable<Uint8Array>}} source
   * @param {UploadStreamOptions} [options]
   */
  async _sendObject(source, { signal, onProgress } = {}) {
    const transactionID = this.transactionID;

    this._log('debug', 'command', {
      code: CODE.SEND_OBJECT.name,
      transactionID,
      parameters: [],
      expectsData: false,
      sendDataBytes: source.size,
    });

    await this.write(
      this.buildContainerPacket(this._command(CODE.SEND_OBJECT)),
    );

    let sent;
    try {
      sent = source.bytes
        ? await this._writeDataContainer(
            CODE.SEND_OBJECT.value,
            transactionID,
            source.bytes,
            { signal, onProgress },
          )
        : await this._writeDataContainerIterable(
            CODE.SEND_OBJECT.value,
            transactionID,
            source.iterable,
            source.size,
            { signal, onProgress },
          );
    } catch (error) {
      this.transportHealthy = false;
      throw error;
    }

    if (sent !== source.size) {
      this.transportHealthy = false;
      throw new Error(
        `Upload ended after ${sent} bytes; expected ${source.size} bytes.`,
      );
    }

    // The response timeout starts after the last byte, not before the upload.
    const response = await this._readResponse(
      transactionID,
      Date.now() + this.transferDeadlineMs,
      CODE.SEND_OBJECT.value,
    );
    this._log('debug', 'response', {
      code: response.code,
      codeValue: response.codeValue,
      transactionID: response.transactionID,
    });
    if (response.codeValue !== CODE.OK.value) {
      throw new MtpResponseError(response, CODE.SEND_OBJECT.value);
    }

    return response;
  }

  async _findHandleByNameDirect(storageId, parentObjectHandle, filename) {
    const payload = await this._executeForDataDirect(CODE.GET_OBJECT_HANDLES, [
      storageId,
      0,
      parentObjectHandle,
    ]);

    for (const handle of decodeUint32List(payload)) {
      if ((await this._getFileNameDirect(handle)) === filename) {
        return handle;
      }
    }

    throw new Error(
      `Uploaded object "${filename}" was not found in the parent folder.`,
    );
  }

  close() {
    if (this._closePromise) {
      return this._closePromise;
    }

    this._closePromise = this._finishClose();
    return this._closePromise;
  }

  async _finishClose() {
    this._closing = true;
    await this.ready.catch(() => {});
    await this._operationQueue;
    await this._recoveryPromise?.catch(() => {});

    try {
      if (this.sessionOpen && this.transportHealthy) {
        await this._closeSessionDirect();
      }
    } catch (error) {
      // The device may already be gone; closing it is still worth attempting.
      console.warn('Error closing MTP session:', error.message);
    }

    try {
      if (this.device?.opened) {
        if (this.usbconfig) {
          await withTimeout(
            this.device.releaseInterface(this.usbconfig.interfaceNumber),
            SETUP_TIMEOUT_MS,
            'Timed out while releasing the MTP interface.',
          ).catch(() => {});
        }
        await withTimeout(
          this.device.close(),
          SETUP_TIMEOUT_MS,
          'Timed out while closing the MTP device.',
        ).catch(() => {});
      }
    } finally {
      this.device = null;
      this.usbconfig = null;
      this.sessionOpen = false;
      this._resetReader();
      this.state = 'closed';
      this.dispatchEvent(new Event('close'));
    }
  }
}
