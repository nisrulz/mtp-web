import test from 'node:test';
import assert from 'node:assert/strict';

import Mtp, {
  buildContainerPacket,
  decodeDeviceInfo,
  decodeDevicePropDesc,
  decodeMtpString,
  decodeObjectInfo,
  decodeObjectPropDesc,
  decodeObjectPropList,
  decodePropertyValueData,
  DEVICE_PROPERTY,
  encodeMtpDate,
  encodeMtpString,
  encodeObjectInfo,
  encodeObjectPropList,
  EVENT_CODE,
  isSupported,
  MTP_DATATYPE,
  MtpResponseError,
  OBJECT_FORMAT,
  OBJECT_PROPERTY,
  parseContainerPacket,
  PROPERTY_FORM,
  setUsbTransport,
  STORAGE_ACCESS,
} from '../src/mtp.js';

const COMMAND_BLOCK = 1;
const DATA_BLOCK = 2;
const RESPONSE_BLOCK = 3;
const EVENT_BLOCK = 4;
const OK = 0x2001;
const GENERAL_ERROR = 0x2002;

function dataPacket(code, transactionID, payload) {
  const buffer = new ArrayBuffer(12 + payload.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, buffer.byteLength, true);
  view.setUint16(4, DATA_BLOCK, true);
  view.setUint16(6, code, true);
  view.setUint32(8, transactionID, true);
  new Uint8Array(buffer).set(payload, 12);
  return new Uint8Array(buffer);
}

// Independent encoder: the decoder tests must not depend on the encoder under
// test in src/mtp.js.
function encodeStringFixture(value) {
  const count = value.length + 1;
  const bytes = new Uint8Array(1 + count * 2);
  bytes[0] = count;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    bytes[1 + i * 2] = code & 0xff;
    bytes[2 + i * 2] = code >> 8;
  }
  return bytes;
}

class FakeDevice {
  constructor(bytes) {
    this.opened = false;
    this.configuration = null;
    this.selectedConfiguration = null;
    this.claimedInterface = null;
    this.releasedInterface = null;
    this.writes = [];
    this._bytes = bytes;
    this._cursor = 0;
  }

  async open() {
    this.opened = true;
    const endpoints = [
      { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 },
      { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 512 },
    ];
    const alternate = {
      alternateSetting: 0,
      interfaceClass: 6,
      interfaceSubclass: 1,
      interfaceProtocol: 1,
      endpoints,
    };
    this.configuration = {
      configurationValue: 1,
      interfaces: [{ interfaceNumber: 0, alternate, alternates: [alternate] }],
    };
  }

  async selectConfiguration(value) {
    this.selectedConfiguration = value;
  }

  async claimInterface(value) {
    this.claimedInterface = value;
  }

  async releaseInterface(value) {
    this.releasedInterface = value;
  }

  async close() {
    this.opened = false;
  }

  async clearHalt(direction, endpointNumber) {
    this.clearedHalt = { direction, endpointNumber };
  }

  async reset() {
    this.resetCount = (this.resetCount ?? 0) + 1;
  }

  async transferOut(endpointNumber, buffer) {
    this.writes.push({
      endpointNumber,
      bytes: new Uint8Array(buffer.slice(0)),
    });
    return { status: 'ok', bytesWritten: buffer.byteLength };
  }

  async transferIn(endpointNumber, length) {
    const remaining = this._bytes.length - this._cursor;
    const size = Math.min(length, remaining);
    const chunk = this._bytes.slice(this._cursor, this._cursor + size);
    this._cursor += size;
    return {
      status: 'ok',
      data: new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    };
  }
}

class BoundarySensitiveDevice extends FakeDevice {
  constructor(initialBytes, finalResponse) {
    super(initialBytes);
    this.finalResponse = finalResponse;
    this.gotZeroLengthPacket = false;
  }

  async transferOut(endpointNumber, buffer) {
    const result = await super.transferOut(endpointNumber, buffer);
    if (buffer.byteLength === 0) {
      this.gotZeroLengthPacket = true;
      this._bytes = this.finalResponse;
      this._cursor = 0;
    }
    return result;
  }
}

class RejectingZlpDevice extends FakeDevice {
  async transferOut(endpointNumber, buffer) {
    if (buffer.byteLength === 0) {
      throw new Error('zero-length packet rejected');
    }
    return super.transferOut(endpointNumber, buffer);
  }
}

class RecoveryFakeDevice extends FakeDevice {
  constructor(bytes, recoveryBytes) {
    super(bytes);
    this.recoveryBytes = recoveryBytes;
    this.useRecovery = false;
  }

  async open() {
    await super.open();
    if (this.useRecovery) {
      this._bytes = this.recoveryBytes;
      this._cursor = 0;
    }
  }
}

class RecoverFailureDevice extends FakeDevice {
  constructor(bytes) {
    super(bytes);
    this.failOpen = false;
  }

  async open() {
    if (this.failOpen) {
      throw new Error('unplugged');
    }
    return super.open();
  }
}

class VendorFakeDevice extends FakeDevice {
  async open() {
    this.opened = true;
    const endpoints = [
      { endpointNumber: 3, direction: 'in', type: 'bulk', packetSize: 512 },
      { endpointNumber: 4, direction: 'out', type: 'bulk', packetSize: 512 },
    ];
    const alternate = {
      alternateSetting: 0,
      interfaceClass: 0xff,
      interfaceSubclass: 0,
      interfaceProtocol: 0,
      endpoints,
    };
    this.configuration = {
      configurationValue: 1,
      interfaces: [{ interfaceNumber: 3, alternate, alternates: [alternate] }],
    };
  }
}

class AdbFakeDevice extends FakeDevice {
  async open() {
    this.opened = true;
    const endpoints = [
      { endpointNumber: 5, direction: 'in', type: 'bulk', packetSize: 512 },
      { endpointNumber: 6, direction: 'out', type: 'bulk', packetSize: 512 },
    ];
    const alternate = {
      alternateSetting: 0,
      interfaceClass: 0xff,
      interfaceSubclass: 0x42,
      interfaceProtocol: 1,
      endpoints,
    };
    this.configuration = {
      configurationValue: 1,
      interfaces: [{ interfaceNumber: 5, alternate, alternates: [alternate] }],
    };
  }
}

class AlternateFakeDevice extends FakeDevice {
  constructor(bytes) {
    super(bytes);
    this.selectedAlternate = null;
  }

  async open() {
    this.opened = true;
    const alternateZero = {
      alternateSetting: 0,
      interfaceClass: 0,
      interfaceSubclass: 0,
      interfaceProtocol: 0,
      endpoints: [],
    };
    const alternateOne = {
      alternateSetting: 1,
      interfaceClass: 6,
      interfaceSubclass: 1,
      interfaceProtocol: 1,
      endpoints: [
        { endpointNumber: 7, direction: 'in', type: 'bulk', packetSize: 512 },
        { endpointNumber: 8, direction: 'out', type: 'bulk', packetSize: 512 },
      ],
    };
    this.configuration = {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternate: alternateZero,
          alternates: [alternateZero, alternateOne],
        },
      ],
    };
  }

  async selectAlternateInterface(interfaceNumber, alternateSetting) {
    this.selectedAlternate = { interfaceNumber, alternateSetting };
  }
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function response(code, transactionID, payload = []) {
  return new Uint8Array(
    buildContainerPacket(transactionID, {
      type: RESPONSE_BLOCK,
      code,
      payload,
    }),
  );
}

async function openMtp(stream, options) {
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device, options);
  await mtp.ready;
  await mtp.openSession();
  return { mtp, device };
}

function eventPacket(transactionID, code = 0x4000) {
  return new Uint8Array(
    buildContainerPacket(transactionID, {
      type: EVENT_BLOCK,
      code,
    }),
  );
}

function headerPacket(length) {
  const buffer = new ArrayBuffer(12);
  new DataView(buffer).setUint32(0, length, true);
  return new Uint8Array(buffer);
}

test('buildContainerPacket encodes the header and parameters', () => {
  const packet = buildContainerPacket(7, {
    type: COMMAND_BLOCK,
    code: 0x1007,
    payload: [0xffffffff, 0, 0xffffffff],
  });

  assert.equal(packet.byteLength, 24);
  const view = new DataView(packet);
  assert.equal(view.getUint32(0, true), 24);
  assert.equal(view.getUint16(4, true), COMMAND_BLOCK);
  assert.equal(view.getUint16(6, true), 0x1007);
  assert.equal(view.getUint32(8, true), 7);
  assert.deepEqual(
    [12, 16, 20].map(offset => view.getUint32(offset, true)),
    [0xffffffff, 0, 0xffffffff],
  );
});

test('parseContainerPacket respects the view offset and container length', () => {
  const packet = buildContainerPacket(3, {
    type: DATA_BLOCK,
    code: 0x1007,
    payload: [2, 42, 43],
  });

  // Place the container in the middle of a larger buffer and append a
  // trailing sentinel that must not leak into the payload.
  const backing = new Uint8Array(packet.byteLength + 12);
  backing.set(new Uint8Array(packet), 4);
  const view = new DataView(backing.buffer, 4, packet.byteLength + 4);

  const parsed = parseContainerPacket(view, packet.byteLength);
  assert.equal(parsed.type, 'Data Block');
  assert.equal(parsed.code, 'GetObjectHandles');
  assert.equal(parsed.transactionID, 3);
  assert.deepEqual(parsed.parameters, [2, 42, 43]);
  assert.deepEqual(
    new Uint8Array(parsed.payload),
    new Uint8Array(packet).subarray(12),
  );
});

test('parseContainerPacket rejects malformed headers', () => {
  assert.throws(
    () => parseContainerPacket(new DataView(new ArrayBuffer(8))),
    RangeError,
  );

  const invalid = new ArrayBuffer(12);
  new DataView(invalid).setUint32(0, 8, true);
  assert.throws(
    () => parseContainerPacket(new DataView(invalid)),
    /Invalid MTP container length/,
  );
});

test('operations run one at a time in the order they were queued', async () => {
  const mtp = new Mtp(
    0x1234,
    0x5678,
    new FakeDevice(concatBytes([response(OK, 0)])),
  );
  await mtp.ready;

  const order = [];
  await Promise.all([
    mtp._enqueue(async () => {
      order.push('first-start');
      await Promise.resolve();
      order.push('first-end');
    }),
    mtp._enqueue(async () => {
      order.push('second');
    }),
  ]);

  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('Mtp rejects invalid resource limits', () => {
  const bytes = concatBytes([response(OK, 0)]);
  const device = () => new FakeDevice(bytes);

  assert.throws(
    () => new Mtp(0x1234, 0x5678, device(), { maxContainerLength: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => new Mtp(0x1234, 0x5678, device(), { maxContainerLength: 11 }),
    /at least 12 bytes/,
  );
  assert.throws(
    () => new Mtp(0x1234, 0x5678, device(), { readTimeoutMs: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => new Mtp(0x1234, 0x5678, device(), { maxEventBlocks: 0 }),
    /positive integer/,
  );
});

test('read rejects a container above the configured limit', async () => {
  const stream = concatBytes([response(OK, 0), headerPacket(64)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream), {
    maxContainerLength: 32,
  });

  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(() => mtp.read(), /exceeds the limit of 32 bytes/);
});

test('read stops at the total transfer deadline', async () => {
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(new Uint8Array(0)), {
    readTimeoutMs: 10000,
    transferDeadlineMs: 50,
  });

  await mtp.ready;

  await assert.rejects(() => mtp.read(), /transfer deadline exceeded/);
});

test('commands fail fast after the transport is out of sync', async () => {
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(new Uint8Array(0)), {
    transferDeadlineMs: 1,
  });

  await mtp.ready;
  await assert.rejects(() => mtp.read(), /transfer deadline exceeded/);
  await assert.rejects(() => mtp.getStorageIDs(), /transport is out of sync/);
});

test('readData caps consecutive event blocks', async () => {
  const stream = concatBytes([
    response(OK, 0),
    eventPacket(1),
    eventPacket(1),
    eventPacket(1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream), {
    maxEventBlocks: 2,
  });

  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(() => mtp.getStorageIDs(), /Too many event blocks/);
});

test('the response phase caps consecutive event blocks', async () => {
  const stream = concatBytes([response(OK, 0), eventPacket(1), eventPacket(1)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream), {
    maxEventBlocks: 1,
  });

  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(() => mtp.closeSession(), /Too many event blocks/);
});

test('a vendor-specific interface falls back with a warning', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const mtp = new Mtp(
      0x1234,
      0x5678,
      new VendorFakeDevice(concatBytes([response(OK, 0)])),
    );

    await mtp.ready;

    assert.equal(mtp.usbconfig.interfaceNumber, 3);
    assert.match(warnings.join('\n'), /vendor-specific interface 3/);
  } finally {
    console.warn = originalWarn;
  }
});

test('the ADB interface is never used as an MTP fallback', async () => {
  const mtp = new Mtp(
    0x1234,
    0x5678,
    new AdbFakeDevice(concatBytes([response(OK, 0)])),
  );

  await assert.rejects(() => mtp.ready, /Only the Android Debug Bridge/);
});

test('the MTP alternate interface is selected and claimed', async () => {
  const device = new AlternateFakeDevice(concatBytes([response(OK, 0)]));
  const mtp = new Mtp(0x1234, 0x5678, device);

  await mtp.ready;

  assert.equal(mtp.usbconfig.interfaceNumber, 0);
  assert.equal(mtp.usbconfig.alternateSetting, 1);
  assert.deepEqual(device.selectedAlternate, {
    interfaceNumber: 0,
    alternateSetting: 1,
  });
});

test('decodeMtpString handles terminators, truncation and empty values', () => {
  assert.equal(decodeMtpString(encodeStringFixture('hello.txt')), 'hello.txt');
  assert.equal(decodeMtpString(new Uint8Array([0])), '');
  assert.equal(decodeMtpString(new Uint8Array(0)), '');

  // A device that claims ten characters but only sends two.
  const truncated = encodeStringFixture('ab').slice(0, 5);
  truncated[0] = 10;
  assert.equal(decodeMtpString(truncated), 'ab');

  // A string without a trailing NUL is still decoded up to the count.
  const unterminated = new Uint8Array([3, 0x41, 0x00, 0x42, 0x00]);
  assert.equal(decodeMtpString(unterminated), 'AB');
});

test('MtpResponseError carries the response details', () => {
  const error = new MtpResponseError({
    code: 'AccessDenied',
    codeValue: 0x200f,
    transactionID: 9,
  });
  assert.equal(error.name, 'MtpResponseError');
  assert.equal(error.code, 'AccessDenied');
  assert.equal(error.codeValue, 0x200f);
  assert.equal(error.transactionID, 9);
  assert.match(error.message, /AccessDenied/);
});

test('a full read cycle validates data and response phases', async () => {
  const fileContents = new Uint8Array(3000).fill(0xab);
  const stream = concatBytes([
    // OpenSession (transaction 0)
    response(OK, 0),
    // GetObjectHandles (transaction 1): data block then response
    dataPacket(
      0x1007,
      1,
      new Uint8Array([2, 0, 0, 0, 100, 0, 0, 0, 200, 0, 0, 0]),
    ),
    response(OK, 1),
    // GetObjectPropValue (transaction 2)
    dataPacket(0x9803, 2, encodeStringFixture('hello.txt')),
    response(OK, 2),
    // GetObject (transaction 3)
    dataPacket(0x1009, 3, fileContents),
    response(OK, 3),
    // CloseSession (transaction 4)
    response(OK, 4),
  ]);

  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;

  assert.equal(device.claimedInterface, 0);
  await mtp.openSession();
  assert.deepEqual(await mtp.getObjectHandles(), [100, 200]);
  assert.equal(await mtp.getFileName(100), 'hello.txt');
  assert.deepEqual(await mtp.getFile(100), fileContents);

  await mtp.close();
  assert.equal(device.releasedInterface, 0);
  assert.equal(mtp.state, 'closed');
  assert.equal(device.writes[0].endpointNumber, 2);
});

test('an error response is reported instead of being skipped', async () => {
  const stream = concatBytes([
    response(OK, 0),
    // GetObjectHandles fails before sending any data.
    response(0x200f, 1),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getObjectHandles(),
    error =>
      error instanceof MtpResponseError &&
      error.code === 'AccessDenied' &&
      error.transactionID === 1,
  );
});

test('event blocks are skipped while waiting for the data phase', async () => {
  const event = new Uint8Array(
    buildContainerPacket(0, { type: 4, code: 0x4002, payload: [1] }),
  );
  const stream = concatBytes([
    response(OK, 0),
    event,
    dataPacket(0x1007, 1, new Uint8Array([1, 0, 0, 0, 55, 0, 0, 0])),
    response(OK, 1),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getObjectHandles(), [55]);
});

test('a stale session is closed and reopened', async () => {
  const stream = concatBytes([
    response(0x201e, 0), // SessionAlreadyOpen
    response(OK, 1), // CloseSession
    response(OK, 0), // OpenSession retry (transaction ID reset)
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.equal(mtp.sessionOpen, true);
});

function u32(...values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });
  return out;
}

function joinWrites(device) {
  return concatBytes(device.writes.map(write => write.bytes));
}

function bigIntBytes(value, size = 16) {
  let number = BigInt(value);
  if (number < 0n) {
    number += 1n << BigInt(size * 8);
  }
  const out = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    out[index] = Number(number & 0xffn);
    number >>= 8n;
  }
  return out;
}

function propListElement(
  handle,
  property,
  datatype,
  value = new Uint8Array(0),
) {
  const head = new Uint8Array(8);
  const view = new DataView(head.buffer);
  view.setUint32(0, handle, true);
  view.setUint16(4, property, true);
  view.setUint16(6, datatype, true);
  return concatBytes([head, value]);
}

function propListPayload(elements) {
  return concatBytes([u32(elements.length), ...elements]);
}

function storageInfoPayload({ access = STORAGE_ACCESS.READ_WRITE } = {}) {
  const description = encodeMtpString('Internal storage');
  const label = encodeMtpString('Pixel');
  const out = new Uint8Array(26 + description.byteLength + label.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, 3, true); // storage type
  view.setUint16(2, 2, true); // filesystem type
  view.setUint16(4, access, true); // access capability
  view.setBigUint64(6, 1024n, true);
  view.setBigUint64(14, 512n, true);
  view.setUint32(22, 4, true);
  out.set(description, 26);
  out.set(label, 26 + description.byteLength);
  return out;
}

test('encodeMtpString and encodeObjectInfo round-trip', () => {
  assert.equal(decodeMtpString(encodeMtpString('hello.txt')), 'hello.txt');
  assert.equal(encodeMtpString('').byteLength, 1);
  assert.throws(() => encodeMtpString('x'.repeat(255)), RangeError);

  const encoded = encodeObjectInfo({
    filename: 'notes.txt',
    parent: 42,
    size: 1234,
    format: OBJECT_FORMAT.UNDEFINED,
  });
  const decoded = decodeObjectInfo(encoded);

  assert.equal(decoded.filename, 'notes.txt');
  assert.equal(decoded.parent, 42);
  assert.equal(decoded.size, 1234);
  assert.equal(decoded.format, OBJECT_FORMAT.UNDEFINED);
});

test('getStorageIDs lists the storage IDs', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1004, 1, u32(2, 0x00010001, 0x00020002)),
    response(OK, 1),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getStorageIDs(), [0x00010001, 0x00020002]);
});

test('storage access capability values match the MTP spec', () => {
  assert.deepEqual(STORAGE_ACCESS, {
    READ_WRITE: 0x00,
    READ_ONLY: 0x01,
    READ_ONLY_WITH_DELETE: 0x02,
  });
});

test('device property codes match the MTP 1.1 property table', () => {
  assert.equal(DEVICE_PROPERTY.SYNCHRONIZATION_PARTNER, 0xd401);
  assert.equal(DEVICE_PROPERTY.DEVICE_FRIENDLY_NAME, 0xd402);
  assert.equal(DEVICE_PROPERTY.VOLUME, 0xd403);
  assert.equal(DEVICE_PROPERTY.SUPPORTED_FORMATS_ORDERED, 0xd404);
  assert.equal(DEVICE_PROPERTY.DEVICE_ICON, 0xd405);
  assert.equal(DEVICE_PROPERTY.SESSION_INITIATOR_VERSION_INFO, 0xd406);
  assert.equal(DEVICE_PROPERTY.PERCEIVED_DEVICE_TYPE, 0xd407);
  assert.equal(DEVICE_PROPERTY.PLAYBACK_RATE, 0xd410);
  assert.equal(DEVICE_PROPERTY.PLAYBACK_OBJECT, 0xd411);
  assert.equal(DEVICE_PROPERTY.PLAYBACK_CONTAINER_INDEX, 0xd412);
  assert.equal(DEVICE_PROPERTY.PLAYBACK_POSITION, 0xd413);
});

test('object property event codes match the MTP 1.1 event table', () => {
  assert.equal(EVENT_CODE.OBJECT_PROP_CHANGED, 0xc801);
  assert.equal(EVENT_CODE.OBJECT_PROP_DESC_CHANGED, 0xc802);
  assert.equal(EVENT_CODE.OBJECT_REFERENCES_CHANGED, 0xc803);
});

test('getStorageInfo decodes capacities and strings', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1005, 1, storageInfoPayload()),
    response(OK, 1),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const info = await mtp.getStorageInfo(0x00010001);
  assert.equal(info.storageId, 0x00010001);
  assert.equal(info.accessCapability, STORAGE_ACCESS.READ_WRITE);
  assert.equal(info.readOnly, false);
  assert.equal(info.maxCapacity, 1024);
  assert.equal(info.freeSpaceInBytes, 512);
  assert.equal(info.freeSpaceInObjects, 4);
  assert.equal(info.description, 'Internal storage');
  assert.equal(info.volumeLabel, 'Pixel');
});

test('a read-only storage is reported as readOnly', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(
      0x1005,
      1,
      storageInfoPayload({ access: STORAGE_ACCESS.READ_ONLY }),
    ),
    response(OK, 1),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const info = await mtp.getStorageInfo(0x00010001);
  assert.equal(info.readOnly, true);
});

test('getNumObjects returns the object count from the response', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1, [3])]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.equal(await mtp.getNumObjects(0x00010001), 3);
});

test('write resumes a short USB transfer from the written offset', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const chunks = [];
  mtp.device.transferOut = async (_endpointNumber, buffer) => {
    chunks.push(new Uint8Array(buffer));
    return { status: 'ok', bytesWritten: 1 };
  };

  const result = await mtp.write(new Uint8Array([1, 2, 3]));

  assert.equal(result.bytesWritten, 3);
  assert.deepEqual(
    chunks.map(chunk => chunk[0]),
    [1, 2, 3],
  );
});

test('getObjectInfo decodes the ObjectInfo dataset', async () => {
  const info = encodeObjectInfo({
    filename: 'clip.mp4',
    parent: 0xffffffff,
    size: 9001,
  });
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1008, 1, info),
    response(OK, 1),
  ]);

  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const decoded = await mtp.getObjectInfo(55);
  assert.equal(decoded.handle, 55);
  assert.equal(decoded.filename, 'clip.mp4');
  assert.equal(decoded.size, 9001);

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.equal(command.getUint32(12, true), 55);
});

test('deleteObject waits for the response phase only', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const result = await mtp.deleteObject(55);
  assert.equal(result.code, 'OK');
});

test('a failed deleteObject rejects with the response code', async () => {
  const stream = concatBytes([response(OK, 0), response(0x200f, 1)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.deleteObject(55),
    error => error instanceof MtpResponseError && error.code === 'AccessDenied',
  );
});

test('uploadFile sends the object info and the file contents', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'notes.txt',
    data,
  });
  assert.equal(handle, 77);

  const written = joinWrites(device);
  const view = new DataView(written.buffer);

  assert.equal(view.getUint16(6, true), 0x1002); // OpenSession

  // OpenSession carries one parameter, so its command block is 16 bytes.
  const infoOffset = view.getUint32(0, true);
  assert.equal(view.getUint16(infoOffset + 6, true), 0x100c); // SendObjectInfo

  const infoHeader = infoOffset + view.getUint32(infoOffset, true);
  const infoLength = view.getUint32(infoHeader, true);
  assert.equal(view.getUint16(infoHeader + 4, true), 2); // data container
  assert.equal(view.getUint16(infoHeader + 6, true), 0x100c);

  const info = decodeObjectInfo(
    written.slice(infoHeader + 12, infoHeader + infoLength),
  );
  assert.equal(info.filename, 'notes.txt');
  assert.equal(info.size, data.byteLength);

  const objectOffset = infoHeader + infoLength;
  assert.equal(view.getUint16(objectOffset + 6, true), 0x100d); // SendObject
  assert.equal(view.getUint32(objectOffset, true), 12); // no parameters
  const objectHeader = objectOffset + view.getUint32(objectOffset, true);
  assert.equal(view.getUint32(objectHeader, true), 12 + data.byteLength);
  assert.deepEqual(
    written.slice(objectHeader + 12, objectHeader + 12 + data.byteLength),
    data,
  );
});

test('uploadFile combines the data header and payload in one transfer', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 12]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const data = new Uint8Array(996).fill(0x5a);
  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'usb-square-bold.webp',
    data,
  });

  assert.equal(handle, 12);
  assert.deepEqual(
    device.writes.map(write => write.bytes.byteLength),
    [16, 20, 110, 12, 512, 496],
  );
  assert.equal(device.writes[4].bytes.byteLength, 512);
  assert.equal(device.writes[5].bytes.byteLength, 496);
  assert.deepEqual(
    concatBytes([device.writes[4].bytes.slice(12), device.writes[5].bytes]),
    data,
  );
  assert.equal(
    device.writes.filter(write => write.bytes.byteLength === 0).length,
    0,
  );
});

test('uploadFile retries with a numbered name when the device rejects a duplicate', async () => {
  const entries = [];
  const logger = {
    debug: (message, context) => entries.push({ message, context }),
    info: (message, context) => entries.push({ message, context }),
    warn: (message, context) => entries.push({ message, context }),
    error: (message, context) => entries.push({ message, context }),
  };
  const stream = concatBytes([
    response(OK, 0),
    response(GENERAL_ERROR, 1),
    response(OK, 2, [0x00010001, 0xffffffff, 12]),
    response(OK, 3),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device, {
    logLevel: 'info',
    logger,
  });
  await mtp.ready;
  await mtp.openSession();

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'usb-square-bold.webp',
    data: new Uint8Array(10),
  });

  assert.equal(handle, 12);
  assert.equal(
    decodeObjectInfo(device.writes[2].bytes.slice(12)).filename,
    'usb-square-bold.webp',
  );
  assert.equal(
    decodeObjectInfo(device.writes[4].bytes.slice(12)).filename,
    'usb-square-bold (2).webp',
  );
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('upload name already exists; retrying') &&
        entry.context?.filename === 'usb-square-bold (2).webp',
    ),
  );
});

test('uploadFile stops retrying duplicate names after 10 attempts', async () => {
  const stream = concatBytes([
    response(OK, 0),
    ...Array.from({ length: 10 }, (_, index) =>
      response(GENERAL_ERROR, index + 1),
    ),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'usb-square-bold.webp',
        data: new Uint8Array(10),
      }),
    /after 10 name attempts/,
  );
  assert.equal(mtp.isTransportHealthy(), true);
});

test('uploadFile ends a packet-aligned data phase with a zero-length packet', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device, {
    sendZeroLengthPacket: true,
  });
  await mtp.ready;
  await mtp.openSession();

  await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'aligned.bin',
    data: new Uint8Array(500),
  });

  assert.equal(
    device.writes.filter(write => write.bytes.byteLength === 0).length,
    1,
    'one zero-length packet must end the aligned data phase',
  );
});

test('uploadFile does not add a zero-length packet to an unaligned data phase', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 78]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'unaligned.bin',
    data: new Uint8Array(511),
  });

  assert.equal(
    device.writes.filter(write => write.bytes.byteLength === 0).length,
    0,
  );
});

test('zero-length packets are off by default', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 80]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'default-aligned.bin',
    data: new Uint8Array(500),
  });

  assert.equal(
    device.writes.filter(write => write.bytes.byteLength === 0).length,
    0,
  );
});

test('uploadFile completes when the device waits for a zero-length packet', async () => {
  const device = new BoundarySensitiveDevice(
    concatBytes([
      response(OK, 0),
      response(OK, 1, [0x00010001, 0xffffffff, 79]),
    ]),
    response(OK, 2),
  );
  const mtp = new Mtp(0x1234, 0x5678, device, {
    readTimeoutMs: 50,
    transferDeadlineMs: 200,
    sendZeroLengthPacket: true,
  });
  await mtp.ready;
  await mtp.openSession();

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'boundary.bin',
    data: new Uint8Array(500),
  });

  assert.equal(handle, 79);
  assert.equal(device.gotZeroLengthPacket, true);
});

test('a rejected zero-length packet does not mask the upload response', async () => {
  const device = new RejectingZlpDevice(
    concatBytes([
      response(OK, 0),
      response(OK, 1, [0x00010001, 0xffffffff, 81]),
      response(OK, 2),
    ]),
  );
  const mtp = new Mtp(0x1234, 0x5678, device, {
    sendZeroLengthPacket: true,
  });
  await mtp.ready;
  await mtp.openSession();

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'reject-zlp.bin',
    data: new Uint8Array(500),
  });

  assert.equal(handle, 81);
  assert.equal(mtp.isTransportHealthy(), true);
});

test('logger receives command and response events until it is silenced', async () => {
  const entries = [];
  const logger = {
    debug: (message, context) => entries.push({ message, context }),
    info: (message, context) => entries.push({ message, context }),
    warn: (message, context) => entries.push({ message, context }),
    error: (message, context) => entries.push({ message, context }),
  };
  const { mtp } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1004, 1, countU32Fixture([1])),
      response(OK, 1),
      dataPacket(0x1004, 2, countU32Fixture([1])),
      response(OK, 2),
    ]),
    { logLevel: 'debug', logger },
  );

  await mtp.getStorageIDs();

  assert.equal(mtp.getLogLevel(), 'debug');
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('command') &&
        entry.context?.code === 'GetStorageIDs',
    ),
  );
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('response') && entry.context?.code === 'OK',
    ),
  );

  mtp.setLogLevel('silent');
  const before = entries.length;
  await mtp.getStorageIDs();
  assert.equal(entries.length, before);
});

test('logger records the upload command and completion', async () => {
  const entries = [];
  const logger = {
    debug: (message, context) => entries.push({ message, context }),
    info: (message, context) => entries.push({ message, context }),
    warn: (message, context) => entries.push({ message, context }),
    error: (message, context) => entries.push({ message, context }),
  };
  const device = new FakeDevice(
    concatBytes([
      response(OK, 0),
      response(OK, 1, [0x00010001, 0xffffffff, 12]),
      response(OK, 2),
    ]),
  );
  const mtp = new Mtp(0x1234, 0x5678, device, {
    logLevel: 'debug',
    logger,
  });
  await mtp.ready;
  await mtp.openSession();

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'usb-square-bold.webp',
    data: new Uint8Array(996),
  });

  assert.equal(handle, 12);
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('command') &&
        entry.context?.code === 'SendObject' &&
        entry.context?.sendDataBytes === 996,
    ),
  );
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('upload started') &&
        entry.context?.filename === 'usb-square-bold.webp',
    ),
  );
  assert.ok(
    entries.some(
      entry =>
        entry.message.includes('upload complete') &&
        entry.context?.filename === 'usb-square-bold.webp' &&
        entry.context?.handle === 12,
    ),
  );
});

test('logging is silent by default and can be enabled', async () => {
  const entries = [];
  const logger = {
    debug: (message, context) => entries.push({ message, context }),
    info: (message, context) => entries.push({ message, context }),
    warn: (message, context) => entries.push({ message, context }),
    error: (message, context) => entries.push({ message, context }),
  };
  const { mtp } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1004, 1, countU32Fixture([1])),
      response(OK, 1),
    ]),
    { logger },
  );

  assert.equal(mtp.getLogLevel(), 'silent');
  assert.equal(entries.length, 0);

  mtp.setLogLevel('debug');
  await mtp.getStorageIDs();
  assert.ok(entries.length > 0);
});

test('an invalid log level throws a clear error', () => {
  assert.throws(
    () =>
      new Mtp(0x1234, 0x5678, new FakeDevice(new Uint8Array(0)), {
        logLevel: 'verbose',
      }),
    /logLevel must be one of/,
  );
});

test('uploadFile looks up the handle when the device omits it', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, []), // no handle
    response(OK, 2), // SendObject
    dataPacket(0x1007, 3, u32(1, 77)), // GetObjectHandles
    response(OK, 3),
    dataPacket(0x9803, 4, encodeMtpString('notes.txt')), // GetObjectPropValue
    response(OK, 4),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'notes.txt',
    data: new Uint8Array([9, 9]),
  });
  assert.equal(handle, 77);
});

test('uploadFile rejects when the new object is missing', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, []),
    response(OK, 2),
    dataPacket(0x1007, 3, u32(0)),
    response(OK, 3),
  ]);

  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'gone.txt',
        data: new Uint8Array(0),
      }),
    /was not found in the parent folder/,
  );
});

test('getObjectPropertyList decodes mixed property types', async () => {
  const props = encodeObjectPropList([
    {
      handle: 9,
      property: OBJECT_PROPERTY.FILE_NAME,
      datatype: MTP_DATATYPE.STRING,
      value: 'photo.jpg',
    },
    {
      handle: 9,
      property: OBJECT_PROPERTY.OBJECT_SIZE,
      datatype: MTP_DATATYPE.UINT32,
      value: 4096,
    },
    {
      handle: 9,
      property: OBJECT_PROPERTY.PARENT_OBJECT,
      datatype: MTP_DATATYPE.UINT64,
      value: 5n,
    },
  ]);
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x9805, 1, props),
    response(OK, 1),
  ]);

  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const { count, elements } = await mtp.getObjectPropertyList({
    handle: 9,
    depth: 1,
  });
  assert.equal(count, 3);
  assert.equal(elements[0].propertyName, 'FILE_NAME');
  assert.equal(elements[0].value, 'photo.jpg');
  assert.equal(elements[1].value, 4096);
  assert.equal(elements[2].value, 5n);

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.deepEqual(
    [12, 16, 20, 24, 28].map(offset => command.getUint32(offset, true)),
    [9, 0, 0xffffffff, 0, 1],
  );
});

test('close drains the session and runs only one time', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  let closeEvents = 0;

  mtp.addEventListener('close', () => {
    closeEvents += 1;
  });

  await mtp.ready;
  await mtp.openSession();
  const firstClose = mtp.close();
  const secondClose = mtp.close();
  assert.equal(firstClose, secondClose);
  await Promise.all([firstClose, secondClose]);

  assert.equal(mtp.state, 'closed');
  assert.equal(device.opened, false);
  assert.equal(closeEvents, 1);
});

test('sendObjectPropertyList sends a property list data container', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const result = await mtp.sendObjectPropertyList(
    0x00010001,
    0xffffffff,
    OBJECT_FORMAT.UNDEFINED,
    [
      {
        property: OBJECT_PROPERTY.FILE_NAME,
        datatype: MTP_DATATYPE.STRING,
        value: 'notes.txt',
      },
    ],
  );
  assert.equal(result.code, 'OK');

  const written = joinWrites(device);
  const view = new DataView(written.buffer);

  const listOffset = view.getUint32(0, true); // command block size
  assert.equal(view.getUint16(listOffset + 6, true), 0x9808);

  const headerOffset = listOffset + view.getUint32(listOffset, true);
  assert.equal(view.getUint16(headerOffset + 4, true), 2); // data container
  assert.equal(view.getUint16(headerOffset + 6, true), 0x9808);

  const listLength = view.getUint32(headerOffset, true);
  const list = decodeObjectPropList(
    written.slice(headerOffset + 12, headerOffset + listLength),
  );
  assert.equal(list.count, 1);
  assert.equal(list.elements[0].value, 'notes.txt');
});

test('buildContainerPacket handles an empty payload and clamps values', () => {
  const empty = buildContainerPacket(0xffffffff, {
    type: COMMAND_BLOCK,
    code: 0x1002,
  });
  assert.equal(empty.byteLength, 12);

  const packet = buildContainerPacket(-1, {
    type: COMMAND_BLOCK,
    code: 0x1007,
    payload: [0, -1, 0x100000000],
  });
  const view = new DataView(packet);
  assert.equal(view.getUint32(8, true), 0xffffffff);
  assert.deepEqual(
    [12, 16, 20].map(offset => view.getUint32(offset, true)),
    [0, 0xffffffff, 0],
  );
});

test('parseContainerPacket handles unknown types and a shorter length', () => {
  const packet = buildContainerPacket(3, {
    type: 0x99,
    code: 0x9999,
    payload: [1, 2],
  });
  const backing = new Uint8Array(packet.byteLength + 8);
  backing.set(new Uint8Array(packet));

  const full = parseContainerPacket(
    new DataView(backing.buffer),
    packet.byteLength,
  );
  assert.equal(full.type, 'Unknown (153)');
  assert.equal(full.code, 'Unknown (0x9999)');
  assert.deepEqual(full.parameters, [1, 2]);
  assert.equal(full.payload.byteLength, 8);

  const shorter = parseContainerPacket(new DataView(backing.buffer), 16);
  assert.deepEqual(shorter.parameters, [1]);
  assert.equal(shorter.payload.byteLength, 4);
});

test('MTP strings preserve surrogate pairs and enforce the maximum', () => {
  const maximum = 'a'.repeat(254);
  assert.equal(decodeMtpString(encodeMtpString(maximum)), maximum);
  assert.throws(() => encodeMtpString(`${maximum}a`), RangeError);

  const emoji = '😀';
  assert.equal(decodeMtpString(encodeMtpString(emoji)), emoji);
  assert.equal(encodeMtpString(emoji)[0], 3);

  // A device can declare 255 characters but send only one.
  assert.equal(decodeMtpString(new Uint8Array([255, 0x41, 0x00])), 'A');
});

test('encodeMtpDate formats a UTC date in the MTP layout', () => {
  assert.equal(
    encodeMtpDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))),
    '20260102T030405',
  );
});

test('ObjectInfo writes defaults and preserves every field', () => {
  const defaults = decodeObjectInfo(encodeObjectInfo());
  assert.equal(defaults.storageId, 0);
  assert.equal(defaults.format, OBJECT_FORMAT.UNDEFINED);
  assert.equal(defaults.size, 0);
  assert.equal(defaults.parent, 0);
  assert.equal(defaults.filename, '');
  assert.equal(defaults.dateCreated, '');
  assert.equal(defaults.dateModified, '');
  assert.equal(defaults.keywords, '');

  const decoded = decodeObjectInfo(
    encodeObjectInfo({
      storageId: 0x00010001,
      format: OBJECT_FORMAT.ASSOCIATION,
      protectionStatus: 3,
      size: 0xffffffff,
      parent: 0xffffffff,
      associationType: 1,
      associationDescription: 2,
      sequenceNumber: 3,
      filename: 'folder',
      dateCreated: '20260102T030405',
      dateModified: '20260103T040506',
      keywords: 'test',
    }),
  );

  assert.equal(decoded.storageId, 0x00010001);
  assert.equal(decoded.format, OBJECT_FORMAT.ASSOCIATION);
  assert.equal(decoded.protectionStatus, 3);
  assert.equal(decoded.size, 0xffffffff);
  assert.equal(decoded.parent, 0xffffffff);
  assert.equal(decoded.associationType, 1);
  assert.equal(decoded.associationDescription, 2);
  assert.equal(decoded.sequenceNumber, 3);
  assert.equal(decoded.filename, 'folder');
  assert.equal(decoded.dateCreated, '20260102T030405');
  assert.equal(decoded.dateModified, '20260103T040506');
  assert.equal(decoded.keywords, 'test');
});

test('encodeObjectInfo rejects a size above 32 bits', () => {
  assert.throws(
    () => encodeObjectInfo({ size: 0x1_0000_0000 }),
    /unsigned 32-bit/,
  );
  assert.throws(
    () => encodeObjectInfo({ storageId: -1 }),
    /storageId must be an unsigned 32-bit integer/,
  );
  assert.throws(
    () => encodeObjectInfo({ format: 0x1_0000 }),
    /format must be an unsigned 16-bit integer/,
  );
});

test('decodeObjectInfo rejects a dataset shorter than the fixed header', () => {
  assert.throws(
    () => decodeObjectInfo(new Uint8Array(51)),
    /ObjectInfo is too short/,
  );
});

test('property lists encode and decode every MTP datatype', () => {
  const entries = [
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.NONE,
      value: null,
    },
    { property: OBJECT_PROPERTY.NAME, datatype: MTP_DATATYPE.INT8, value: -5 },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.UINT8,
      value: 250,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.INT16,
      value: -300,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.UINT16,
      value: 65000,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.INT32,
      value: -70000,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.UINT32,
      value: 4000000000,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.INT64,
      value: -5n,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.UINT64,
      value: 5n,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.INT128,
      value: -1n,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.UINT128,
      value: 1n << 100n,
    },
    {
      property: OBJECT_PROPERTY.NAME,
      datatype: MTP_DATATYPE.STRING,
      value: 'value',
    },
  ];
  const { count, elements } = decodeObjectPropList(
    encodeObjectPropList(entries),
  );

  assert.equal(count, entries.length);
  assert.equal(elements[0].value, null);
  assert.equal(elements[1].value, -5);
  assert.equal(elements[2].value, 250);
  assert.equal(elements[3].value, -300);
  assert.equal(elements[4].value, 65000);
  assert.equal(elements[5].value, -70000);
  assert.equal(elements[6].value, 4000000000);
  assert.equal(elements[7].value, -5n);
  assert.equal(elements[8].value, 5n);
  assert.deepEqual(elements[9].value, bigIntBytes(-1n));
  assert.deepEqual(elements[10].value, bigIntBytes(1n << 100n));
  assert.equal(elements[11].value, 'value');
});

test('decodeObjectPropList handles empty and truncated datasets', () => {
  const empty = decodeObjectPropList(u32(0));
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.elements, []);

  const element = propListElement(
    7,
    OBJECT_PROPERTY.NAME,
    MTP_DATATYPE.UINT32,
    u32(9),
  );
  const mismatched = decodeObjectPropList(concatBytes([u32(3), element]));
  assert.equal(mismatched.count, 3);
  assert.equal(mismatched.elements.length, 1);

  const noElementBody = decodeObjectPropList(concatBytes([u32(1), u32(7)]));
  assert.equal(noElementBody.elements.length, 0);

  assert.throws(
    () =>
      decodeObjectPropList(
        concatBytes([
          u32(1),
          propListElement(7, OBJECT_PROPERTY.NAME, MTP_DATATYPE.UINT32),
        ]),
      ),
    RangeError,
  );

  assert.throws(
    () =>
      decodeObjectPropList(
        propListPayload([propListElement(7, OBJECT_PROPERTY.NAME, 0x9999)]),
      ),
    /Unsupported MTP data type/,
  );
});

test('getStorageIDs tolerates a count larger than the payload', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1004, 1, u32(3, 0x00010001, 0x00020002)),
    response(OK, 1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getStorageIDs(), [0x00010001, 0x00020002]);
});

test('getStorageInfo reports read-only-with-delete and empty strings', async () => {
  const payload = new Uint8Array(26);
  const view = new DataView(payload.buffer);
  view.setUint16(4, STORAGE_ACCESS.READ_ONLY_WITH_DELETE, true);

  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1005, 1, payload),
    response(OK, 1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const info = await mtp.getStorageInfo(1);
  assert.equal(info.readOnly, true);
  assert.equal(info.description, '');
  assert.equal(info.volumeLabel, '');
});

test('getStorageInfo rejects a short dataset', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1005, 1, new Uint8Array(25)),
    response(OK, 1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(() => mtp.getStorageInfo(1), /StorageInfo is too short/);
});

test('getObjectHandles sends storage, format and parent', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1007, 1, u32(0)),
    response(OK, 1),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(
    await mtp.getObjectHandles(0x00010001, OBJECT_FORMAT.UNDEFINED, 42),
    [],
  );

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.deepEqual(
    [12, 16, 20].map(offset => command.getUint32(offset, true)),
    [0x00010001, OBJECT_FORMAT.UNDEFINED, 42],
  );
});

test('getNumObjects sends the storage, format and parent', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1, [0])]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.equal(await mtp.getNumObjects(0x00010001, 0, 42), 0);

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.deepEqual(
    [12, 16, 20].map(offset => command.getUint32(offset, true)),
    [0x00010001, 0, 42],
  );
});

test('getFileName sends GetObjectPropValue with the file-name code', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x9803, 1, encodeMtpString('name.txt')),
    response(OK, 1),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.equal(await mtp.getFileName(9), 'name.txt');

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.deepEqual(
    [12, 16].map(offset => command.getUint32(offset, true)),
    [9, OBJECT_PROPERTY.FILE_NAME],
  );
});

test('getFile sends the object handle and returns the payload', async () => {
  const payload = new Uint8Array([1, 2, 3]);
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1009, 1, payload),
    response(OK, 1),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getFile(9), payload);

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.equal(command.getUint32(12, true), 9);
});

test('deleteObject sends the object handle', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await mtp.deleteObject(9);

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.equal(command.getUint32(12, true), 9);
});

test('openSession sends session ID 1 and starts at transaction 0', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const command = new DataView(
    device.writes[0].bytes.buffer,
    device.writes[0].bytes.byteOffset,
    device.writes[0].bytes.byteLength,
  );
  assert.equal(command.getUint16(6, true), 0x1002);
  assert.equal(command.getUint32(8, true), 0);
  assert.equal(command.getUint32(12, true), 1);
  assert.equal(mtp.transactionID, 1);
});

test('closeSession sends no parameters and accepts SessionNotOpen', async () => {
  const stream = concatBytes([response(OK, 0), response(0x2003, 1)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await mtp.closeSession();
  assert.equal(mtp.sessionOpen, false);
  assert.deepEqual(commandParameters(device, 1), []);
});

test('read rejects a header with a length below 12', async () => {
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(headerPacket(11)));
  await mtp.ready;

  await assert.rejects(() => mtp.read(), /Invalid MTP container length/);
});

test('readData rejects a response before the data phase', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.readData(),
    /response before the expected data block/,
  );
});

test('a wrong response transaction ID poisons the transport', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 2)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.closeSession(),
    /Unexpected transaction ID 2 \(expected 1\)/,
  );
  await assert.rejects(() => mtp.getStorageIDs(), /transport is out of sync/);
});

test('write rejects a failed or stalled transfer', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  mtp.device.transferOut = async () => ({ status: 'stall', bytesWritten: 0 });
  await assert.rejects(() => mtp.write(new Uint8Array([1])), /status "stall"/);
  assert.deepEqual(mtp.device.clearedHalt, {
    direction: 'out',
    endpointNumber: 2,
  });

  mtp.transportHealthy = true;
  mtp.device.transferOut = async () => ({ status: 'ok', bytesWritten: 0 });
  await assert.rejects(() => mtp.write(new Uint8Array([1])), /stalled/);
});

test('sendObjectPropertyList sends the 64-bit size and zeroed handles', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await mtp.sendObjectPropertyList(
    0x00010001,
    0xffffffff,
    OBJECT_FORMAT.UNDEFINED,
    [
      {
        handle: 0x1234,
        property: OBJECT_PROPERTY.FILE_NAME,
        datatype: MTP_DATATYPE.STRING,
        value: 'notes.txt',
      },
    ],
    0x100000002,
  );

  const command = new DataView(
    device.writes[1].bytes.buffer,
    device.writes[1].bytes.byteOffset,
    device.writes[1].bytes.byteLength,
  );
  assert.equal(command.getUint32(0, true), 32);
  assert.equal(command.getUint16(6, true), 0x9808);
  assert.deepEqual(
    [12, 16, 20, 24, 28].map(offset => command.getUint32(offset, true)),
    [0x00010001, 0xffffffff, OBJECT_FORMAT.UNDEFINED, 1, 2],
  );

  const list = decodeObjectPropList(device.writes[2].bytes.slice(12));
  assert.equal(list.elements[0].handle, 0);
  assert.equal(list.elements[0].value, 'notes.txt');
});

test('sendObjectPropertyList rejects an out-of-range object size', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () =>
      mtp.sendObjectPropertyList(
        1,
        0xffffffff,
        OBJECT_FORMAT.UNDEFINED,
        [],
        -1n,
      ),
    /unsigned 64-bit/,
  );
  await assert.rejects(
    () =>
      mtp.sendObjectPropertyList(
        1,
        0xffffffff,
        OBJECT_FORMAT.UNDEFINED,
        [],
        0x10000000000000000n,
      ),
    /unsigned 64-bit/,
  );
});

test('encodeObjectPropList rejects out-of-range 128-bit values', () => {
  assert.throws(
    () =>
      encodeObjectPropList([
        {
          property: OBJECT_PROPERTY.NAME,
          datatype: MTP_DATATYPE.UINT128,
          value: 1n << 128n,
        },
      ]),
    /UINT128 value is out of range/,
  );
  assert.throws(
    () =>
      encodeObjectPropList([
        {
          property: OBJECT_PROPERTY.NAME,
          datatype: MTP_DATATYPE.INT128,
          value: 1n << 127n,
        },
      ]),
    /INT128 value is out of range/,
  );
});

test('encodeObjectPropList validates entry fields', () => {
  assert.throws(
    () =>
      encodeObjectPropList([
        { property: 0x1_0000, datatype: MTP_DATATYPE.UINT32, value: 1 },
      ]),
    /property must be an unsigned 16-bit integer/,
  );
  assert.throws(
    () => encodeObjectPropList([{ property: 1, datatype: 0x1_0000, value: 1 }]),
    /datatype must be an unsigned 16-bit integer/,
  );
  assert.throws(
    () =>
      encodeObjectPropList([
        { handle: -1, property: 1, datatype: MTP_DATATYPE.UINT32, value: 1 },
      ]),
    /handle must be an unsigned 32-bit integer/,
  );
});

test('getStorageIDs returns an empty list for a short payload', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1004, 1, new Uint8Array([1, 0])),
    response(OK, 1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getStorageIDs(), []);
});

test('getNumObjects returns zero when the response omits the count', async () => {
  const stream = concatBytes([response(OK, 0), response(OK, 1)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.equal(await mtp.getNumObjects(1), 0);
});

test('the response phase rejects a data block', async () => {
  const stream = concatBytes([response(OK, 0), dataPacket(0x1007, 1, u32(0))]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.closeSession(),
    /Expected a response block, received Data Block/,
  );
});

test('transaction IDs wrap after the 32-bit limit', async () => {
  const mtp = new Mtp(
    0x1234,
    0x5678,
    new FakeDevice(concatBytes([response(OK, 0)])),
  );
  await mtp.ready;
  mtp.transactionID = 0xffffffff;

  const packet = mtp.buildContainerPacket({
    type: COMMAND_BLOCK,
    code: 0x1002,
  });
  assert.equal(new DataView(packet).getUint32(8, true), 0xffffffff);
  assert.equal(mtp.transactionID, 0);
});

test('uploadFile splits a large payload into 512-byte transfers', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const data = new Uint8Array(2000);
  data[data.byteLength - 1] = 0xab;

  await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'large.bin',
    data,
  });

  const sizes = device.writes.map(write => write.bytes.byteLength);
  assert.ok(sizes.every(size => size <= 512));
  assert.ok(sizes.filter(size => size === 512).length >= 2);
  assert.equal(device.writes.at(-1).bytes.at(-1), 0xab);
});

test('decodeDevicePropDesc decodes range and enumeration forms', () => {
  const range = decodeDevicePropDesc(
    concatBytes([
      u16Fixture(0x5001),
      u16Fixture(MTP_DATATYPE.UINT8),
      Uint8Array.of(0),
      Uint8Array.of(50),
      Uint8Array.of(75),
      Uint8Array.of(PROPERTY_FORM.RANGE),
      Uint8Array.of(0),
      Uint8Array.of(100),
      Uint8Array.of(1),
    ]),
  );

  assert.equal(range.devicePropertyCode, 0x5001);
  assert.equal(range.dataType, MTP_DATATYPE.UINT8);
  assert.equal(range.getSet, 0);
  assert.equal(range.defaultValue, 50);
  assert.equal(range.currentValue, 75);
  assert.deepEqual(range.form, { type: 'range', min: 0, max: 100, step: 1 });

  const enumeration = decodeDevicePropDesc(
    concatBytes([
      u16Fixture(0x500a),
      u16Fixture(MTP_DATATYPE.UINT16),
      Uint8Array.of(1),
      u16Fixture(1),
      u16Fixture(2),
      Uint8Array.of(PROPERTY_FORM.ENUMERATION),
      u16Fixture(3),
      u16Fixture(1),
      u16Fixture(2),
      u16Fixture(3),
    ]),
  );

  assert.equal(enumeration.defaultValue, 1);
  assert.equal(enumeration.currentValue, 2);
  assert.deepEqual(enumeration.form, {
    type: 'enumeration',
    values: [1, 2, 3],
  });
});

test('decodeObjectPropDesc decodes string, group code and range forms', () => {
  const stringDescriptor = decodeObjectPropDesc(
    concatBytes([
      u16Fixture(OBJECT_PROPERTY.FILE_NAME),
      u16Fixture(MTP_DATATYPE.STRING),
      Uint8Array.of(1),
      encodeMtpString(''),
      u32Fixture(0),
      Uint8Array.of(PROPERTY_FORM.NONE),
    ]),
  );

  assert.equal(stringDescriptor.objectPropertyCode, OBJECT_PROPERTY.FILE_NAME);
  assert.equal(stringDescriptor.dataType, MTP_DATATYPE.STRING);
  assert.equal(stringDescriptor.defaultValue, '');
  assert.equal(stringDescriptor.groupCode, 0);
  assert.equal(stringDescriptor.form, null);

  const rangeDescriptor = decodeObjectPropDesc(
    concatBytes([
      u16Fixture(OBJECT_PROPERTY.OBJECT_SIZE),
      u16Fixture(MTP_DATATYPE.UINT32),
      Uint8Array.of(1),
      u32Fixture(0),
      u32Fixture(0x1234),
      Uint8Array.of(PROPERTY_FORM.RANGE),
      u32Fixture(0),
      u32Fixture(100),
      u32Fixture(2),
    ]),
  );

  assert.equal(rangeDescriptor.groupCode, 0x1234);
  assert.deepEqual(rangeDescriptor.form, {
    type: 'range',
    min: 0,
    max: 100,
    step: 2,
  });
});

test('decodePropertyValueData decodes arrays and rejects truncated counts', () => {
  assert.deepEqual(
    decodePropertyValueData(countU32Fixture([1, 2, 3]), MTP_DATATYPE.AUINT32),
    [1, 2, 3],
  );
  assert.equal(
    decodePropertyValueData(encodeMtpString('hello'), MTP_DATATYPE.STRING),
    'hello',
  );
  assert.throws(
    () =>
      decodePropertyValueData(
        new Uint8Array([2, 0, 0, 0, 1]),
        MTP_DATATYPE.AUINT32,
      ),
    RangeError,
  );
  assert.throws(
    () => decodePropertyValueData(new Uint8Array(8), MTP_DATATYPE.UINT128),
    /truncated/,
  );
});

test('descriptor decoders reject datasets that cannot be read', () => {
  assert.throws(() => decodeDevicePropDesc(new Uint8Array(2)), /too short/);
  assert.throws(() => decodeObjectPropDesc(new Uint8Array(4)), /too short/);
  assert.throws(
    () =>
      decodeObjectPropDesc(
        concatBytes([
          u16Fixture(OBJECT_PROPERTY.FILE_NAME),
          u16Fixture(MTP_DATATYPE.STRING),
          Uint8Array.of(1),
          encodeMtpString(''),
        ]),
      ),
    /group code/,
  );
});

test('getDevicePropDesc and getDeviceProperty use the device property commands', async () => {
  const descriptor = concatBytes([
    u16Fixture(0x5001),
    u16Fixture(MTP_DATATYPE.UINT8),
    Uint8Array.of(0),
    Uint8Array.of(50),
    Uint8Array.of(75),
    Uint8Array.of(PROPERTY_FORM.NONE),
  ]);
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1014, 1, descriptor),
      response(OK, 1),
      dataPacket(0x1014, 2, descriptor),
      response(OK, 2),
      dataPacket(0x1015, 3, Uint8Array.of(75)),
      response(OK, 3),
    ]),
  );

  const decoded = await mtp.getDevicePropDesc(0x5001);
  assert.equal(decoded.currentValue, 75);
  assert.deepEqual(commandParameters(device, 1), [0x5001]);

  const property = await mtp.getDeviceProperty(0x5001);
  assert.equal(property.descriptor.currentValue, 75);
  assert.equal(property.value, 75);
});

test('getDevicePropValue, setDevicePropValue and resetDevicePropValue use the wire format', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1015, 1, Uint8Array.of(75)),
      response(OK, 1),
      response(OK, 2),
      response(OK, 3),
    ]),
  );

  assert.equal(await mtp.getDevicePropValue(0x5001, MTP_DATATYPE.UINT8), 75);
  assert.deepEqual(commandParameters(device, 1), [0x5001]);

  const setResponse = await mtp.setDevicePropValue(
    0x5001,
    75,
    MTP_DATATYPE.UINT8,
  );
  assert.equal(setResponse.code, 'OK');
  assert.deepEqual(commandParameters(device, 2), [0x5001]);
  assert.deepEqual(device.writes[3].bytes.slice(12), Uint8Array.of(75));

  const resetResponse = await mtp.resetDevicePropValue(0x5001);
  assert.equal(resetResponse.code, 'OK');
  assert.deepEqual(commandParameters(device, 4), [0x5001]);
});

test('getObjectPropsSupported decodes the supported property codes', async () => {
  const supported = countU16Fixture([
    OBJECT_PROPERTY.FILE_NAME,
    OBJECT_PROPERTY.OBJECT_SIZE,
  ]);
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x9801, 1, supported),
      response(OK, 1),
    ]),
  );

  assert.deepEqual(await mtp.getObjectPropsSupported(OBJECT_FORMAT.UNDEFINED), [
    OBJECT_PROPERTY.FILE_NAME,
    OBJECT_PROPERTY.OBJECT_SIZE,
  ]);
  assert.deepEqual(commandParameters(device, 1), [OBJECT_FORMAT.UNDEFINED]);
});

test('getObjectPropDesc and getObjectPropValue use the object property commands', async () => {
  const descriptor = concatBytes([
    u16Fixture(OBJECT_PROPERTY.OBJECT_SIZE),
    u16Fixture(MTP_DATATYPE.UINT32),
    Uint8Array.of(1),
    u32Fixture(0),
    u32Fixture(0),
    Uint8Array.of(PROPERTY_FORM.NONE),
  ]);
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x9802, 1, descriptor),
      response(OK, 1),
      dataPacket(0x9803, 2, u32Fixture(4096)),
      response(OK, 2),
    ]),
  );

  const decoded = await mtp.getObjectPropDesc(
    OBJECT_PROPERTY.OBJECT_SIZE,
    OBJECT_FORMAT.UNDEFINED,
  );
  assert.equal(decoded.dataType, MTP_DATATYPE.UINT32);
  assert.deepEqual(commandParameters(device, 1), [
    OBJECT_PROPERTY.OBJECT_SIZE,
    OBJECT_FORMAT.UNDEFINED,
  ]);

  assert.equal(
    await mtp.getObjectPropValue(
      9,
      OBJECT_PROPERTY.OBJECT_SIZE,
      MTP_DATATYPE.UINT32,
    ),
    4096,
  );
  assert.deepEqual(commandParameters(device, 2), [
    9,
    OBJECT_PROPERTY.OBJECT_SIZE,
  ]);
});

test('setObjectPropValue sends the encoded property value', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([response(OK, 0), response(OK, 1)]),
  );

  const result = await mtp.setObjectPropValue(
    9,
    OBJECT_PROPERTY.OBJECT_SIZE,
    4096,
    MTP_DATATYPE.UINT32,
  );

  assert.equal(result.code, 'OK');
  assert.deepEqual(commandParameters(device, 1), [
    9,
    OBJECT_PROPERTY.OBJECT_SIZE,
  ]);
  assert.deepEqual(device.writes[2].bytes.slice(12), u32Fixture(4096));
});

test('getObjectProperty reads ObjectInfo, the descriptor and the value', async () => {
  const info = encodeObjectInfo({
    filename: 'notes.txt',
    format: OBJECT_FORMAT.UNDEFINED,
    size: 4,
  });
  const descriptor = concatBytes([
    u16Fixture(OBJECT_PROPERTY.OBJECT_SIZE),
    u16Fixture(MTP_DATATYPE.UINT32),
    Uint8Array.of(0),
    u32Fixture(0),
    u32Fixture(0),
    Uint8Array.of(PROPERTY_FORM.NONE),
  ]);
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1008, 1, info),
      response(OK, 1),
      dataPacket(0x9802, 2, descriptor),
      response(OK, 2),
      dataPacket(0x9803, 3, u32Fixture(4)),
      response(OK, 3),
    ]),
  );

  const property = await mtp.getObjectProperty(9, OBJECT_PROPERTY.OBJECT_SIZE);

  assert.equal(property.descriptor.dataType, MTP_DATATYPE.UINT32);
  assert.equal(property.value, 4);
  assert.deepEqual(commandParameters(device, 2), [
    OBJECT_PROPERTY.OBJECT_SIZE,
    OBJECT_FORMAT.UNDEFINED,
  ]);
});

test('setObjectProperty reads the descriptor when the datatype is omitted', async () => {
  const info = encodeObjectInfo({
    filename: 'notes.txt',
    format: OBJECT_FORMAT.UNDEFINED,
    size: 4,
  });
  const descriptor = concatBytes([
    u16Fixture(OBJECT_PROPERTY.OBJECT_SIZE),
    u16Fixture(MTP_DATATYPE.UINT32),
    Uint8Array.of(1),
    u32Fixture(0),
    u32Fixture(0),
    Uint8Array.of(PROPERTY_FORM.NONE),
  ]);
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x1008, 1, info),
      response(OK, 1),
      dataPacket(0x9802, 2, descriptor),
      response(OK, 2),
      response(OK, 3),
    ]),
  );

  const result = await mtp.setObjectProperty(9, OBJECT_PROPERTY.OBJECT_SIZE, 4);

  assert.equal(result.code, 'OK');
  assert.deepEqual(commandParameters(device, 3), [
    9,
    OBJECT_PROPERTY.OBJECT_SIZE,
  ]);
  assert.deepEqual(device.writes[4].bytes.slice(12), u32Fixture(4));
});

test('object references round-trip through the reference commands', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x9810, 1, countU32Fixture([2, 3])),
      response(OK, 1),
      response(OK, 2),
    ]),
  );

  assert.deepEqual(await mtp.getObjectReferences(9), [2, 3]);
  assert.deepEqual(commandParameters(device, 1), [9]);

  const result = await mtp.setObjectReferences(9, [2, 3]);
  assert.equal(result.code, 'OK');
  assert.deepEqual(commandParameters(device, 2), [9]);
  assert.deepEqual(device.writes[3].bytes.slice(12), countU32Fixture([2, 3]));
});

test('setObjectReferences ends an aligned data phase with a zero-length packet', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([response(OK, 0), response(OK, 1)]),
    { sendZeroLengthPacket: true },
  );
  const handles = Array.from({ length: 124 }, (_, index) => index + 1);

  await mtp.setObjectReferences(9, handles);

  assert.equal(
    device.writes.filter(write => write.bytes.byteLength === 0).length,
    1,
  );
});

test('moveObject and copyObject send the destination storage and parent', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([response(OK, 0), response(OK, 1), response(OK, 2)]),
  );

  await mtp.moveObject(9, 0x00010001, 0);
  await mtp.copyObject(9, 0x00010001, 5);

  assert.deepEqual(commandParameters(device, 1), [9, 0x00010001, 0]);
  assert.deepEqual(commandParameters(device, 2), [9, 0x00010001, 5]);
});

test('getPartialObject sends a 32-bit offset and returns the payload', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      dataPacket(0x101b, 1, Uint8Array.of(1, 2, 3)),
      response(OK, 1),
    ]),
  );

  assert.deepEqual(
    await mtp.getPartialObject(9, 100, 3),
    Uint8Array.of(1, 2, 3),
  );
  assert.deepEqual(commandParameters(device, 1), [9, 100, 3]);
});

test('storage, protection and capture commands use the standard parameters', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([
      response(OK, 0),
      response(OK, 1),
      response(OK, 2),
      response(OK, 3),
      response(OK, 4),
      response(OK, 5),
      response(OK, 6),
    ]),
  );

  await mtp.formatStore(0x00010001);
  await mtp.selfTest();
  await mtp.setObjectProtection(9, 1);
  await mtp.initiateCapture(0x00010001, OBJECT_FORMAT.UNDEFINED);
  await mtp.initiateOpenCapture(0x00010001, OBJECT_FORMAT.UNDEFINED);
  await mtp.terminateOpenCapture(9);

  assert.deepEqual(commandParameters(device, 1), [0x00010001, 0]);
  assert.deepEqual(commandParameters(device, 2), []);
  assert.deepEqual(commandParameters(device, 3), [9, 1]);
  assert.deepEqual(commandParameters(device, 4), [
    0x00010001,
    OBJECT_FORMAT.UNDEFINED,
  ]);
  assert.deepEqual(commandParameters(device, 5), [
    0x00010001,
    OBJECT_FORMAT.UNDEFINED,
  ]);
  assert.deepEqual(commandParameters(device, 6), [9]);
});

test('resetDevice and powerDown end the session and poison the transport', async () => {
  const reset = await openMtp(concatBytes([response(OK, 0), response(OK, 1)]));

  const resetResponse = await reset.mtp.resetDevice();
  assert.equal(resetResponse.code, 'OK');
  assert.equal(reset.mtp.sessionOpen, false);
  assert.equal(reset.mtp.isTransportHealthy(), false);

  const power = await openMtp(concatBytes([response(OK, 0), response(OK, 1)]));

  const powerResponse = await power.mtp.powerDown();
  assert.equal(powerResponse.code, 'OK');
  assert.equal(power.mtp.sessionOpen, false);
  assert.equal(power.mtp.isTransportHealthy(), false);
});

test('setObjectPropertyList sends a property list without command parameters', async () => {
  const { mtp, device } = await openMtp(
    concatBytes([response(OK, 0), response(OK, 1)]),
  );
  const entries = [
    {
      handle: 9,
      property: OBJECT_PROPERTY.OBJECT_SIZE,
      datatype: MTP_DATATYPE.UINT32,
      value: 4,
    },
  ];

  const result = await mtp.setObjectPropertyList(entries);

  assert.equal(result.code, 'OK');
  assert.deepEqual(commandParameters(device, 1), []);
  assert.deepEqual(
    device.writes[2].bytes.slice(12),
    encodeObjectPropList(entries),
  );
});

test('readEvent returns an event container and names its event code', async () => {
  const { mtp } = await openMtp(
    concatBytes([response(OK, 0), eventPacket(1, EVENT_CODE.OBJECT_ADDED)]),
  );

  const event = await mtp.readEvent();

  assert.equal(event.type, 'Event Block');
  assert.equal(event.code, 'ObjectAdded');
  assert.equal(event.codeValue, EVENT_CODE.OBJECT_ADDED);
});

test('readEvent rejects a non-event container and poisons the transport', async () => {
  const { mtp } = await openMtp(
    concatBytes([response(OK, 0), response(OK, 1)]),
  );

  await assert.rejects(() => mtp.readEvent(), /Expected an MTP event/);
  assert.equal(mtp.isTransportHealthy(), false);
});

test('readEvent reports a timeout and poisons the transport', async () => {
  const { mtp } = await openMtp(concatBytes([response(OK, 0)]));

  await assert.rejects(
    () => mtp.readEvent(1),
    /MTP transfer deadline exceeded/,
  );
  assert.equal(mtp.isTransportHealthy(), false);
});

test('recover reopens the transport and starts a new session', async () => {
  const device = new RecoveryFakeDevice(
    concatBytes([response(OK, 0), dataPacket(0x1004, 2, countU32Fixture([1]))]),
    concatBytes([
      response(OK, 0),
      dataPacket(0x1004, 1, countU32Fixture([1, 2])),
      response(OK, 1),
    ]),
  );
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getStorageIDs(),
    /Unexpected data-block transaction ID/,
  );
  assert.equal(mtp.isTransportHealthy(), false);

  device.useRecovery = true;
  await mtp.recover();

  assert.equal(mtp.isTransportHealthy(), true);
  assert.equal(mtp.sessionOpen, true);
  assert.deepEqual(await mtp.getStorageIDs(), [1, 2]);
});

test('recover rejects a second concurrent call', async () => {
  const device = new RecoveryFakeDevice(
    concatBytes([response(OK, 0), dataPacket(0x1004, 2, countU32Fixture([1]))]),
    concatBytes([response(OK, 0)]),
  );
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getStorageIDs(),
    /Unexpected data-block transaction ID/,
  );
  device.useRecovery = true;

  const first = mtp.recover();
  const second = mtp.recover();

  await assert.rejects(second, /already recovering/);
  await first;
  assert.equal(mtp.isTransportHealthy(), true);
});

test('recover reports a clear error when the device cannot reopen', async () => {
  const device = new RecoverFailureDevice(
    concatBytes([response(OK, 0), dataPacket(0x1004, 2, countU32Fixture([1]))]),
  );
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getStorageIDs(),
    /Unexpected data-block transaction ID/,
  );
  device.failOpen = true;

  await assert.rejects(
    () => mtp.recover(),
    /Could not recover the MTP connection: unplugged/,
  );
  assert.equal(mtp.isTransportHealthy(), false);
});

test('resetUsbDevice resets the device and ends the session', async () => {
  const { mtp, device } = await openMtp(concatBytes([response(OK, 0)]));

  await mtp.resetUsbDevice();

  assert.equal(device.resetCount, 1);
  assert.equal(mtp.sessionOpen, false);
  assert.equal(mtp.isTransportHealthy(), false);
});

test('MtpResponseError names the failed operation and code value', () => {
  const error = new MtpResponseError(
    {
      code: 'AccessDenied',
      codeValue: 0x200f,
      transactionID: 9,
    },
    0x100b,
  );

  assert.equal(error.operation, 'DeleteObject');
  assert.match(error.message, /DeleteObject/);
  assert.match(error.message, /0x200f/);
});

test('object property lists preserve array values', () => {
  const entries = [
    {
      handle: 9,
      property: OBJECT_PROPERTY.OBJECT_SIZE,
      datatype: MTP_DATATYPE.AUINT32,
      value: [1, 2, 3],
    },
  ];

  const decoded = decodeObjectPropList(encodeObjectPropList(entries));

  assert.deepEqual(decoded.elements[0].value, [1, 2, 3]);
});

function u16Fixture(value) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function u32Fixture(value) {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function countU32Fixture(values) {
  return concatBytes([u32Fixture(values.length), ...values.map(u32Fixture)]);
}

function countU16Fixture(values) {
  return concatBytes([u32Fixture(values.length), ...values.map(u16Fixture)]);
}

function deviceInfoFixture() {
  return concatBytes([
    u16Fixture(0x0100),
    u32Fixture(0x00000006),
    u16Fixture(0x0064),
    encodeStringFixture('microsoft.com: 1.0'),
    u16Fixture(0x0001),
    countU16Fixture([0x1001, 0x1002, 0x1009]),
    countU16Fixture([0x4001]),
    countU16Fixture([0x5001, 0x5002]),
    countU16Fixture([0x3801]),
    countU16Fixture([0x3801, 0x3802]),
    encodeStringFixture('Samsung'),
    encodeStringFixture('Galaxy'),
    encodeStringFixture('1.0'),
    encodeStringFixture('SN123'),
    Uint8Array.of(0xde, 0xad),
  ]);
}

function commandParameters(device, index) {
  const bytes = device.writes[index].bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parameters = [];

  for (let offset = 12; offset + 4 <= bytes.byteLength; offset += 4) {
    parameters.push(view.getUint32(offset, true));
  }

  return parameters;
}

test('decodeDeviceInfo decodes the golden dataset and ignores trailing bytes', () => {
  const info = decodeDeviceInfo(deviceInfoFixture());

  assert.deepEqual(info, {
    StandardVersion: 0x0100,
    VendorExtensionID: 0x00000006,
    VendorExtensionVersion: 0x0064,
    VendorExtensionDescription: 'microsoft.com: 1.0',
    FunctionalMode: 0x0001,
    OperationsSupported: [0x1001, 0x1002, 0x1009],
    EventsSupported: [0x4001],
    DevicePropertiesSupported: [0x5001, 0x5002],
    CaptureFormats: [0x3801],
    ImageFormats: [0x3801, 0x3802],
    Manufacturer: 'Samsung',
    Model: 'Galaxy',
    DeviceVersion: '1.0',
    SerialNumber: 'SN123',
  });
});

test('decodeDeviceInfo rejects a dataset below the fixed fields', () => {
  assert.throws(() => decodeDeviceInfo(new Uint8Array(4)), RangeError);
});

function deviceInfoCountOffsets() {
  const fixture = deviceInfoFixture();
  const view = new DataView(
    fixture.buffer,
    fixture.byteOffset,
    fixture.byteLength,
  );
  const description = encodeStringFixture('microsoft.com: 1.0').byteLength;
  const offsets = [];
  let offset = 2 + 4 + 2 + description + 2;

  for (let index = 0; index < 5; index += 1) {
    offsets.push(offset);
    offset += 4 + view.getUint32(offset, true) * 2;
  }

  return offsets;
}

test('decodeDeviceInfo rejects an array count larger than the payload', () => {
  for (const offset of deviceInfoCountOffsets()) {
    const hostile = deviceInfoFixture().slice();
    new DataView(hostile.buffer).setUint32(offset, 0xffffffff, true);

    assert.throws(() => decodeDeviceInfo(hostile), RangeError);
  }
});

test('getDeviceInfo works before openSession', async () => {
  const stream = concatBytes([
    dataPacket(0x1001, 0, deviceInfoFixture()),
    response(OK, 0),
    response(OK, 0),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;

  assert.equal(mtp.sessionOpen, false);
  const info = await mtp.getDeviceInfo();
  assert.equal(info.Manufacturer, 'Samsung');
  assert.deepEqual(info.OperationsSupported, [0x1001, 0x1002, 0x1009]);
  assert.equal(mtp.transactionID, 1);

  const command = new DataView(
    device.writes[0].bytes.buffer,
    device.writes[0].bytes.byteOffset,
    device.writes[0].bytes.byteLength,
  );
  assert.equal(command.getUint32(0, true), 12);
  assert.equal(command.getUint16(6, true), 0x1001);

  await mtp.openSession();
  assert.equal(mtp.sessionOpen, true);
});

test('getPartial sends the offset low word first by default', async () => {
  const payload = Uint8Array.of(9, 8, 7);
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x95c1, 1, payload),
    response(OK, 1),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const bytes = await mtp.getPartial(0x42, 0x100000002, 3);

  assert.deepEqual(bytes, payload);
  assert.deepEqual(commandParameters(device, 1), [0x42, 2, 1, 3]);
  assert.equal(mtp.partialOrder, 'loFirst');
  assert.equal(mtp.partialState, 'supported');
});

test('getPartial rejects unsafe offsets and oversized lengths', async () => {
  const mtp = new Mtp(
    0x1234,
    0x5678,
    new FakeDevice(concatBytes([response(OK, 0)])),
  );
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getPartial(1, Number.MAX_SAFE_INTEGER + 1, 1),
    /non-negative safe integer/,
  );
  await assert.rejects(
    () => mtp.getPartial(1, 0, 0x1_0000_0000),
    /unsigned 32-bit integer/,
  );
});

test('getPartial retries with the high word first and caches the order', async () => {
  const payload = Uint8Array.of(1, 2);
  const stream = concatBytes([
    response(OK, 0),
    response(0x2006, 1),
    dataPacket(0x95c1, 2, payload),
    response(OK, 2),
    dataPacket(0x95c1, 3, payload),
    response(OK, 3),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getPartial(0x42, 0x100000002, 2), payload);
  assert.deepEqual(commandParameters(device, 1), [0x42, 2, 1, 2]);
  assert.deepEqual(commandParameters(device, 2), [0x42, 1, 2, 2]);
  assert.equal(mtp.partialOrder, 'hiFirst');
  assert.equal(mtp.partialState, 'supported');

  assert.deepEqual(await mtp.getPartial(0x42, 6, 2), payload);
  assert.deepEqual(commandParameters(device, 3), [0x42, 0, 6, 2]);
});

test('getPartial reports both orders as unsupported', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(0x2006, 1),
    response(0x201d, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getPartial(0x42, 0x100000002, 3),
    error =>
      error instanceof MtpResponseError &&
      error.codeValue === 0x201d &&
      error.transactionID === 2,
  );

  assert.deepEqual(commandParameters(device, 1), [0x42, 2, 1, 3]);
  assert.deepEqual(commandParameters(device, 2), [0x42, 1, 2, 3]);
  assert.equal(mtp.partialOrder, null);
  assert.equal(mtp.partialState, 'unsupported');
});

test('getThumb returns bytes and accepts an empty payload', async () => {
  const thumbnail = Uint8Array.of(0xff, 0xd8, 0xff);
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x100a, 1, thumbnail),
    response(OK, 1),
    dataPacket(0x100a, 2, new Uint8Array(0)),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  assert.deepEqual(await mtp.getThumb(7), thumbnail);
  assert.deepEqual(await mtp.getThumb(7), new Uint8Array(0));
  assert.deepEqual(commandParameters(device, 1), [7]);
  assert.deepEqual(commandParameters(device, 2), [7]);
});

test('streaming upload writes chunks in order and reports progress', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
    response(OK, 2),
  ]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const progress = [];
  async function* source() {
    yield Uint8Array.of(1, 2);
    yield Uint8Array.of(3);
  }

  const handle = await mtp.uploadFile({
    storageId: 0x00010001,
    parentObjectHandle: 0xffffffff,
    filename: 'stream.bin',
    data: source(),
    size: 3,
    onProgress: sent => progress.push(sent),
  });

  assert.equal(handle, 77);
  assert.deepEqual(progress, [2, 3]);

  const dataHeader = new DataView(
    device.writes[4].bytes.buffer,
    device.writes[4].bytes.byteOffset,
    device.writes[4].bytes.byteLength,
  );
  assert.equal(dataHeader.getUint32(0, true), 15);
  assert.equal(dataHeader.getUint16(4, true), DATA_BLOCK);
  assert.equal(dataHeader.getUint16(6, true), 0x100d);
  assert.equal(dataHeader.getUint32(8, true), 2);
  assert.deepEqual(device.writes[4].bytes.slice(12), Uint8Array.of(1, 2));
  assert.deepEqual(device.writes[5].bytes, Uint8Array.of(3));
});

test('uploadFile rejects a short streaming source', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  async function* source() {
    yield Uint8Array.of(1, 2);
  }

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'short.bin',
        data: source(),
        size: 3,
      }),
    /expected 3 bytes/,
  );
  assert.equal(mtp.transportHealthy, false);
});

test('uploadFile requires a size for an AsyncIterable', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  async function* source() {
    yield Uint8Array.of(1);
  }

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'missing-size.bin',
        data: source(),
      }),
    /size is required/,
  );
  assert.equal(device.writes.length, 1);
});

test('uploadFile honors an abort before the data phase', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const device = new FakeDevice(stream);
  const mtp = new Mtp(0x1234, 0x5678, device);
  await mtp.ready;
  await mtp.openSession();

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'aborted.bin',
        data: Uint8Array.of(1),
        signal: controller.signal,
      }),
    error => error.name === 'AbortError',
  );
  assert.equal(device.writes.length, 1);
  assert.equal(mtp.transportHealthy, true);
});

test('an aborted streaming upload marks the transport unhealthy', async () => {
  const stream = concatBytes([
    response(OK, 0),
    response(OK, 1, [0x00010001, 0xffffffff, 77]),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  const controller = new AbortController();
  async function* source() {
    yield Uint8Array.of(1);
    controller.abort();
    yield Uint8Array.of(2);
  }

  await assert.rejects(
    () =>
      mtp.uploadFile({
        storageId: 0x00010001,
        parentObjectHandle: 0xffffffff,
        filename: 'aborted-stream.bin',
        data: source(),
        size: 2,
        signal: controller.signal,
      }),
    error => error.name === 'AbortError',
  );
  assert.equal(mtp.transportHealthy, false);
});

test('transport health rejects the next command after a transfer error', async () => {
  const stream = concatBytes([response(OK, 0)]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  assert.equal(mtp.isTransportHealthy(), true);
  mtp.device.transferOut = async () => {
    throw new Error('USB transfer failed');
  };

  await assert.rejects(() => mtp.getStorageIDs(), /USB transfer failed/);
  assert.equal(mtp.transportHealthy, false);
  assert.equal(mtp.isTransportHealthy(), false);
  await assert.rejects(() => mtp.getStorageIDs(), /transport is out of sync/);
});

test('a data-block transaction mismatch marks the transport unhealthy', async () => {
  const stream = concatBytes([
    response(OK, 0),
    dataPacket(0x1007, 9, u32(0)),
    response(OK, 1),
  ]);
  const mtp = new Mtp(0x1234, 0x5678, new FakeDevice(stream));
  await mtp.ready;
  await mtp.openSession();

  await assert.rejects(
    () => mtp.getObjectHandles(),
    /Unexpected data-block transaction ID/,
  );
  assert.equal(mtp.transportHealthy, false);
});

test('isSupported accepts Chromium with WebUSB', () => {
  const usb = {
    requestDevice: async () => {},
    getDevices: async () => [],
  };

  assert.equal(
    isSupported({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      usb,
    }),
    true,
  );
  assert.equal(Mtp.isSupported({ userAgent: 'Chrome/131.0.0.0', usb }), true);
});

test('isSupported rejects Firefox and Safari even with a WebUSB shim', () => {
  const usb = {
    requestDevice: async () => {},
    getDevices: async () => [],
  };

  assert.equal(
    isSupported({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:133.0) Gecko/20100101 Firefox/133.0',
      usb,
    }),
    false,
  );
  assert.equal(
    isSupported({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      usb,
    }),
    false,
  );
  assert.equal(
    isSupported({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      usb,
    }),
    false,
  );
});

test('isSupported rejects missing WebUSB methods', () => {
  assert.equal(isSupported({ userAgent: 'Chrome/131.0.0.0' }), false);
  assert.equal(
    isSupported({
      userAgent: 'Chrome/131.0.0.0',
      usb: { getDevices: async () => [] },
    }),
    false,
  );
  assert.equal(
    isSupported({
      userAgent: 'Chrome/131.0.0.0',
      usb: { requestDevice: async () => {} },
    }),
    false,
  );
  assert.equal(isSupported(null), false);
});

test('setUsbTransport discovers a device without importing usb', async () => {
  const device = new FakeDevice(new Uint8Array(0));
  device.vendorId = 0x1234;
  device.productId = 0x5678;
  const transport = {
    getDevices: async () => [device],
    requestDevice: async () => {
      throw new Error('requestDevice must not run');
    },
  };

  setUsbTransport(transport);
  try {
    const mtp = new Mtp(0x1234, 0x5678);
    await mtp.ready;
    assert.equal(mtp.device, device);
    await mtp.close();
  } finally {
    setUsbTransport(null);
  }
});
