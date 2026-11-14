import Mtp, {
  decodeDeviceInfo,
  decodeDevicePropDesc,
  decodeObjectPropDesc,
  decodePropertyValueData,
  DEVICE_PROPERTY,
  EVENT_CODE,
  MTP_DATATYPE,
  MtpResponseError,
  OBJECT_FORMAT,
  OBJECT_PROPERTY,
  PROPERTY_FORM,
  isSupported,
  setUsbTransport,
  type Container,
  type DeviceInfo,
  type DevicePropDesc,
  type DevicePropertyResult,
  type MtpLogger,
  type MtpLogLevel,
  type MtpOptions,
  type NavigatorLike,
  type ObjectInfo,
  type ObjectPropDesc,
  type ObjectPropertyResult,
  type PartialOrder,
  type PartialState,
  type PropListResult,
  type SetObjectPropertyOptions,
  type StorageInfo,
  type UploadOptions,
  type UsbDevice,
  type UsbTransport,
} from 'mtp-web';

const device: UsbDevice = {
  opened: false,
  configuration: null,
  async open() {},
  async close() {},
  async selectConfiguration() {},
  async claimInterface() {},
  async releaseInterface() {},
  async selectAlternateInterface() {},
  async transferIn() {
    return { status: 'ok', data: new DataView(new ArrayBuffer(0)) };
  },
  async transferOut() {
    return { status: 'ok', bytesWritten: 0 };
  },
};

const logLevel: MtpLogLevel = 'debug';
const logger: MtpLogger = {
  debug(message, context) {
    void message;
    void context;
  },
  error(message, context) {
    void message;
    void context;
  },
};

const options: MtpOptions = {
  maxContainerLength: 1024,
  readTimeoutMs: 1000,
  transferDeadlineMs: 2000,
  maxEventBlocks: 4,
  logLevel,
  logger,
  writeChunkSize: 512,
  sendZeroLengthPacket: true,
};

const mtp = new Mtp(0x1234, 0x5678, device, options);

async function exercise(): Promise<void> {
  await mtp.ready;

  mtp.addEventListener('ready', () => {});
  mtp.addEventListener('error', event => {
    void event.error;
  });
  mtp.addEventListener('close', () => {});

  const info: DeviceInfo = await mtp.getDeviceInfo();
  const standardVersion: number = info.StandardVersion;
  const manufacturer: string = info.Manufacturer;
  const operations: number[] = info.OperationsSupported;

  await mtp.openSession();

  const storageIds: number[] = await mtp.getStorageIDs();
  const storage: StorageInfo = await mtp.getStorageInfo(storageIds[0]);
  const handles: number[] = await mtp.getObjectHandles(storage.storageId);
  const count: number = await mtp.getNumObjects(storage.storageId);
  const object: ObjectInfo = await mtp.getObjectInfo(handles[0]);
  const name: string = await mtp.getFileName(object.handle);
  const file: Uint8Array = await mtp.getFile(object.handle, name);
  const properties: PropListResult = await mtp.getObjectPropertyList({
    handle: object.handle,
    depth: 0,
  });
  const partial: Uint8Array = await mtp.getPartial(
    object.handle,
    0x1_0000_0002,
    16,
    'loFirst',
  );
  const order: PartialOrder | null = mtp.partialOrder;
  const partialState: PartialState = mtp.partialState;
  const thumbnail: Uint8Array = await mtp.getThumb(object.handle);

  const upload: UploadOptions = {
    storageId: storage.storageId,
    parentObjectHandle: 0xffffffff,
    filename: 'stream.bin',
    data: (async function* () {
      yield new Uint8Array([1]);
    })(),
    size: 1,
    onProgress: sent => {
      void sent;
    },
    signal: new AbortController().signal,
    format: OBJECT_FORMAT.UNDEFINED,
  };
  const uploadHandle: number = await mtp.uploadFile(upload);

  const sentProperties: Container = await mtp.sendObjectPropertyList(
    storage.storageId,
    0xffffffff,
    OBJECT_FORMAT.UNDEFINED,
    [],
  );
  const deleted: Container = await mtp.deleteObject(uploadHandle);

  const supported: number[] = await mtp.getObjectPropsSupported(
    OBJECT_FORMAT.UNDEFINED,
  );
  const objectDescriptor: ObjectPropDesc = await mtp.getObjectPropDesc(
    OBJECT_PROPERTY.OBJECT_SIZE,
    OBJECT_FORMAT.UNDEFINED,
  );
  const objectValue: unknown = await mtp.getObjectPropValue(
    object.handle,
    OBJECT_PROPERTY.OBJECT_SIZE,
    MTP_DATATYPE.UINT32,
  );
  const objectProperty: ObjectPropertyResult = await mtp.getObjectProperty(
    object.handle,
    OBJECT_PROPERTY.OBJECT_SIZE,
  );
  const setObjectOptions: SetObjectPropertyOptions = {
    datatype: MTP_DATATYPE.UINT32,
  };
  const setObject: Container = await mtp.setObjectProperty(
    object.handle,
    OBJECT_PROPERTY.OBJECT_SIZE,
    1,
    setObjectOptions,
  );
  const deviceDescriptor: DevicePropDesc = await mtp.getDevicePropDesc(
    DEVICE_PROPERTY.BATTERY_LEVEL,
  );
  const deviceProperty: DevicePropertyResult = await mtp.getDeviceProperty(
    DEVICE_PROPERTY.BATTERY_LEVEL,
  );
  const references: number[] = await mtp.getObjectReferences(object.handle);
  const partial32: Uint8Array = await mtp.getPartialObject(
    object.handle,
    0,
    16,
  );
  const moved: Container = await mtp.moveObject(
    object.handle,
    storage.storageId,
    0,
  );
  const copied: Container = await mtp.copyObject(
    object.handle,
    storage.storageId,
    0,
  );
  const formatted: Container = await mtp.formatStore(storage.storageId);
  const protectedObject: Container = await mtp.setObjectProtection(
    object.handle,
    1,
  );
  const captured: Container = await mtp.initiateCapture(storage.storageId);
  const event: Container = await mtp.readEvent();
  const eventCode: number = EVENT_CODE.OBJECT_ADDED;
  const decodedDeviceDescriptor: DevicePropDesc = decodeDevicePropDesc(
    new Uint8Array(0),
  );
  const decodedObjectDescriptor: ObjectPropDesc = decodeObjectPropDesc(
    new Uint8Array(0),
  );
  const decodedValue: unknown = decodePropertyValueData(
    new Uint8Array(0),
    MTP_DATATYPE.STRING,
  );
  const formFlag: number = PROPERTY_FORM.NONE;
  const recovered: Mtp = await mtp.recover();
  mtp.setLogLevel(logLevel);
  const currentLogLevel: MtpLogLevel = mtp.getLogLevel();
  await mtp.resetUsbDevice();

  await mtp.write(new Uint8Array(0));
  const built: ArrayBuffer = mtp.buildContainerPacket({
    type: 1,
    code: 0x1001,
  });
  const parsed: Container = mtp.parseContainerPacket(new DataView(built));
  const read: Container = await mtp.read();
  const readData: Container = await mtp.readData();

  await mtp.closeSession();
  const healthy: boolean = mtp.isTransportHealthy();
  void [
    standardVersion,
    manufacturer,
    operations,
    count,
    file,
    properties,
    partial,
    order,
    partialState,
    thumbnail,
    sentProperties,
    deleted,
    supported,
    objectDescriptor,
    objectValue,
    objectProperty,
    setObjectOptions,
    setObject,
    deviceDescriptor,
    deviceProperty,
    references,
    partial32,
    moved,
    copied,
    formatted,
    protectedObject,
    captured,
    event,
    eventCode,
    decodedDeviceDescriptor,
    decodedObjectDescriptor,
    decodedValue,
    formFlag,
    recovered,
    currentLogLevel,
    parsed,
    read,
    readData,
    healthy,
  ];
  await mtp.close();
}

const error: MtpResponseError = new MtpResponseError({
  code: 'OK',
  codeValue: 0x2001,
  transactionID: 1,
});
const transport: UsbTransport | null = null;
const supportNavigator: NavigatorLike = {
  userAgent: 'Chrome/131.0.0.0',
  usb: {
    requestDevice() {},
    getDevices() {},
  },
};
const browserSupported: boolean = isSupported(supportNavigator);
const staticBrowserSupported: boolean = Mtp.isSupported(supportNavigator);
setUsbTransport(transport);
const decoded: DeviceInfo = decodeDeviceInfo(new Uint8Array(0));
void error;
void decoded;
void exercise;
void browserSupported;
void staticBrowserSupported;
