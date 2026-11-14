/** A minimal WebUSB device surface used by Mtp. */
export interface UsbEndpoint {
  endpointNumber: number;
  direction: string;
  type: string;
  packetSize: number;
}

export interface UsbAlternateInterface {
  alternateSetting?: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints?: UsbEndpoint[];
}

export interface UsbInterface {
  interfaceNumber: number;
  alternate?: UsbAlternateInterface;
  alternates?: UsbAlternateInterface[];
}

export interface UsbConfiguration {
  configurationValue: number;
  interfaces?: UsbInterface[];
}

export interface UsbInTransferResult {
  status?: string;
  data?: DataView;
}

export interface UsbOutTransferResult {
  status?: string;
  bytesWritten?: number;
}

export interface UsbDevice {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly productName?: string | null;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations?: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  reset?(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(
    interfaceNumber: number,
    alternateSetting: number,
  ): Promise<void>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<UsbInTransferResult>;
  transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<UsbOutTransferResult>;
  clearHalt?(direction: 'in' | 'out', endpointNumber: number): Promise<void>;
}

export interface UsbDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

export interface UsbTransport {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: UsbDeviceFilter[] }): Promise<UsbDevice>;
}

export interface NavigatorLike {
  userAgent?: string;
  usb?: {
    requestDevice?: unknown;
    getDevices?: unknown;
  } | null;
}

export interface MtpOptions {
  /** Largest accepted inbound container in bytes. */
  maxContainerLength?: number;
  /** Idle read timeout in milliseconds. */
  readTimeoutMs?: number;
  /** Total deadline for one command in milliseconds. */
  transferDeadlineMs?: number;
  /** Maximum consecutive event blocks before a command fails. */
  maxEventBlocks?: number;
  /** Log threshold. Defaults to "silent". */
  logLevel?: MtpLogLevel;
  /** Custom log sink. Missing levels are silent. */
  logger?: MtpLogger;
  /** USB OUT payload chunk size. Defaults to 512 bytes. */
  writeChunkSize?: number;
  /** Append a zero-length packet to aligned data phases. Defaults to false. */
  sendZeroLengthPacket?: boolean;
}

export interface ContainerInput {
  type: number;
  code: number;
  payload?: number[];
}

export interface Container {
  type: string;
  typeValue: number;
  code: string;
  codeValue: number;
  transactionID: number;
  length: number;
  payload: ArrayBuffer;
  parameters: number[];
}

export interface ObjectInfoInput {
  filename?: string;
  storageId?: number;
  parent?: number;
  format?: number;
  size?: number;
  protectionStatus?: number;
  associationType?: number;
  associationDescription?: number;
  sequenceNumber?: number;
  dateCreated?: string;
  dateModified?: string;
  keywords?: string;
}

export interface ObjectInfoData {
  storageId: number;
  format: number;
  protectionStatus: number;
  size: number;
  parent: number;
  associationType: number;
  associationDescription: number;
  sequenceNumber: number;
  filename: string;
  dateCreated: string;
  dateModified: string;
  keywords: string;
}

export interface ObjectInfo extends ObjectInfoData {
  handle: number;
}

export interface StorageInfo {
  storageId: number;
  storageType: number;
  filesystemType: number;
  accessCapability: number;
  readOnly: boolean;
  maxCapacity: number;
  freeSpaceInBytes: number;
  freeSpaceInObjects: number;
  description: string;
  volumeLabel: string;
}

export interface PropListEntry {
  handle?: number;
  property: number;
  datatype?: number;
  value: unknown;
}

export interface PropListElement {
  handle: number;
  property: number;
  propertyName: string | null;
  datatype: number;
  value: unknown;
}

export interface PropListResult {
  count: number;
  elements: PropListElement[];
}

export type PropertyForm =
  | { type: 'range'; min: unknown; max: unknown; step: unknown }
  | { type: 'enumeration'; values: unknown[] }
  | { type: 'dateTime'; value: string }
  | { type: 'fixedLengthArray'; count: number }
  | { type: 'regularExpression'; value: string }
  | { type: 'byteArray'; count: number }
  | { type: 'longString' }
  | null;

export interface PropertyDescriptor {
  dataType: number;
  getSet: number;
  defaultValue: unknown;
  formFlag: number;
  form: PropertyForm;
}

export interface DevicePropDesc extends PropertyDescriptor {
  devicePropertyCode: number;
  currentValue: unknown;
}

export interface ObjectPropDesc extends PropertyDescriptor {
  objectPropertyCode: number;
  groupCode: number;
}

export interface ObjectPropertyResult {
  descriptor: ObjectPropDesc;
  value: unknown;
}

export interface DevicePropertyResult {
  descriptor: DevicePropDesc;
  value: unknown;
}

export interface SetObjectPropertyOptions {
  datatype?: number;
  format?: number;
}

/**
 * The PTP DeviceInfo dataset. Field names follow the PTP specification.
 */
export interface DeviceInfo {
  StandardVersion: number;
  VendorExtensionID: number;
  VendorExtensionVersion: number;
  VendorExtensionDescription: string;
  FunctionalMode: number;
  OperationsSupported: number[];
  EventsSupported: number[];
  DevicePropertiesSupported: number[];
  CaptureFormats: number[];
  ImageFormats: number[];
  Manufacturer: string;
  Model: string;
  DeviceVersion: string;
  SerialNumber: string;
}

export type PartialOrder = 'hiFirst' | 'loFirst';
export type PartialState = 'unknown' | 'supported' | 'unsupported';
export type MtpLogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface MtpLogger {
  debug?(message: string, context?: unknown): void;
  info?(message: string, context?: unknown): void;
  warn?(message: string, context?: unknown): void;
  error?(message: string, context?: unknown): void;
}

export type UploadData = Uint8Array | ArrayBuffer | AsyncIterable<Uint8Array>;

export interface UploadOptions {
  storageId: number;
  /** Folder handle, `0xFFFFFFFF` for the storage root. */
  parentObjectHandle: number;
  filename: string;
  data: UploadData;
  /** Total size in bytes. Required for an AsyncIterable. */
  size?: number;
  /** Called after each chunk with the total number of bytes sent. */
  onProgress?: (sent: number) => void;
  /** Stops before the data phase starts. */
  signal?: AbortSignal;
  format?: number;
  dateCreated?: string;
  dateModified?: string;
}

export interface GetObjectPropertyListOptions {
  handle?: number;
  format?: number;
  property?: number;
  depth?: number;
}

export interface UsbConfig {
  interfaceNumber: number;
  alternateSetting: number;
  outEPnum: number;
  inEPnum: number;
  outPacketSize: number;
  inPacketSize: number;
}

export interface MtpEventMap {
  ready: Event;
  error: ErrorEvent;
  close: Event;
}

export declare class MtpResponseError extends Error {
  constructor(
    response: {
      code: string;
      codeValue: number;
      transactionID: number;
    },
    operation?: number,
  );
  code: string;
  codeValue: number;
  transactionID: number;
  operation: string | null;
}

export declare const OBJECT_FORMAT: {
  readonly UNDEFINED: 0x3000;
  readonly ASSOCIATION: 0x3001;
};

export declare const STORAGE_ACCESS: {
  readonly READ_WRITE: 0;
  readonly READ_ONLY: 1;
  readonly READ_ONLY_WITH_DELETE: 2;
};

export declare const OBJECT_PROPERTY: {
  readonly STORAGE_ID: number;
  readonly OBJECT_FORMAT: number;
  readonly PROTECTION_STATUS: number;
  readonly OBJECT_SIZE: number;
  readonly ASSOCIATION_TYPE: number;
  readonly ASSOCIATION_DESCRIPTION: number;
  readonly FILE_NAME: number;
  readonly DATE_CREATED: number;
  readonly DATE_MODIFIED: number;
  readonly PARENT_OBJECT: number;
  readonly PERSISTENT_UID: number;
  readonly NAME: number;
};

export declare const MTP_DATATYPE: {
  readonly NONE: number;
  readonly INT8: number;
  readonly UINT8: number;
  readonly INT16: number;
  readonly UINT16: number;
  readonly INT32: number;
  readonly UINT32: number;
  readonly INT64: number;
  readonly UINT64: number;
  readonly INT128: number;
  readonly UINT128: number;
  readonly AINT8: number;
  readonly AUINT8: number;
  readonly AINT16: number;
  readonly AUINT16: number;
  readonly AINT32: number;
  readonly AUINT32: number;
  readonly AINT64: number;
  readonly AUINT64: number;
  readonly AINT128: number;
  readonly AUINT128: number;
  readonly STRING: number;
};

export declare const EVENT_CODE: {
  readonly UNDEFINED: number;
  readonly CANCEL_TRANSACTION: number;
  readonly OBJECT_ADDED: number;
  readonly OBJECT_REMOVED: number;
  readonly STORE_ADDED: number;
  readonly STORE_REMOVED: number;
  readonly DEVICE_PROP_CHANGED: number;
  readonly OBJECT_INFO_CHANGED: number;
  readonly DEVICE_INFO_CHANGED: number;
  readonly REQUEST_OBJECT_TRANSFER: number;
  readonly STORE_FULL: number;
  readonly DEVICE_RESET: number;
  readonly STORAGE_INFO_CHANGED: number;
  readonly CAPTURE_COMPLETE: number;
  readonly UNREPORTED_STATUS: number;
  readonly OBJECT_PROP_CHANGED: number;
};

export declare const DEVICE_PROPERTY: {
  readonly UNDEFINED: number;
  readonly BATTERY_LEVEL: number;
  readonly FUNCTIONAL_MODE: number;
  readonly IMAGE_SIZE: number;
  readonly COMPRESSION_SETTING: number;
  readonly WHITE_BALANCE: number;
  readonly RGB_GAIN: number;
  readonly F_NUMBER: number;
  readonly FOCAL_LENGTH: number;
  readonly FOCUS_DISTANCE: number;
  readonly FOCUS_MODE: number;
  readonly EXPOSURE_METERING_MODE: number;
  readonly FLASH_MODE: number;
  readonly EXPOSURE_TIME: number;
  readonly EXPOSURE_PROGRAM_MODE: number;
  readonly EXPOSURE_INDEX: number;
  readonly EXPOSURE_BIAS_COMPENSATION: number;
  readonly DATE_TIME: number;
  readonly CAPTURE_DELAY: number;
  readonly STILL_CAPTURE_MODE: number;
  readonly CONTRAST: number;
  readonly SHARPNESS: number;
  readonly DIGITAL_ZOOM: number;
  readonly EFFECT_MODE: number;
  readonly BURST_NUMBER: number;
  readonly BURST_INTERVAL: number;
  readonly TIMELAPSE_NUMBER: number;
  readonly TIMELAPSE_INTERVAL: number;
  readonly FOCUS_METERING_MODE: number;
  readonly UPLOAD_URL: number;
  readonly ARTIST: number;
  readonly COPYRIGHT_INFO: number;
  readonly SYNCHRONIZATION_PARTNER: number;
  readonly DEVICE_FRIENDLY_NAME: number;
  readonly VOLUME: number;
  readonly SUPPORTED_FORMATS: number;
  readonly SUPPORTED_FORMAT_CATEGORIES: number;
  readonly SUPPORTED_FORMAT_PROPERTIES: number;
};

export declare const PROPERTY_FORM: {
  readonly NONE: number;
  readonly RANGE: number;
  readonly ENUMERATION: number;
  readonly DATE_TIME: number;
  readonly FIXED_LENGTH_ARRAY: number;
  readonly REGULAR_EXPRESSION: number;
  readonly BYTE_ARRAY: number;
  readonly LONG_STRING: number;
};

export declare const PROPERTY_GET_SET: {
  readonly GET: number;
  readonly GET_SET: number;
};

export declare const OBJECT_PROTECTION: {
  readonly NONE: number;
  readonly READ_ONLY: number;
};

export declare function setUsbTransport(transport: UsbTransport | null): void;
export declare function isSupported(navigatorLike?: NavigatorLike): boolean;

export declare function buildContainerPacket(
  transactionId: number,
  container: ContainerInput,
): ArrayBuffer;

export declare function parseContainerPacket(
  bytes: DataView,
  length?: number,
): Container;

export declare function decodeMtpString(
  input: Uint8Array | ArrayBuffer,
): string;

export declare function encodeMtpString(value: string): Uint8Array;

export declare function encodeMtpDate(date?: Date): string;

export declare function encodeObjectInfo(info?: ObjectInfoInput): Uint8Array;

export declare function decodeObjectInfo(
  input: Uint8Array | ArrayBuffer,
): ObjectInfoData;

export declare function decodeDeviceInfo(
  input: Uint8Array | ArrayBuffer,
): DeviceInfo;

export declare function decodeDevicePropDesc(
  input: Uint8Array | ArrayBuffer,
): DevicePropDesc;

export declare function decodeObjectPropDesc(
  input: Uint8Array | ArrayBuffer,
): ObjectPropDesc;

export declare function decodePropertyValueData(
  input: Uint8Array | ArrayBuffer,
  datatype: number,
): unknown;

export declare function encodeObjectPropList(
  entries: PropListEntry[],
): Uint8Array;

export declare function decodeObjectPropList(
  input: Uint8Array | ArrayBuffer,
): PropListResult;

export default class Mtp extends EventTarget {
  static isSupported(navigatorLike?: NavigatorLike): boolean;

  constructor(
    vendorId?: number | null,
    productId?: number | null,
    device?: UsbDevice | null,
    options?: MtpOptions,
  );

  readonly ready: Promise<Mtp>;
  state: 'initializing' | 'open' | 'closed';
  transactionID: number;
  device: UsbDevice | null;
  usbconfig: UsbConfig | null;
  sessionOpen: boolean;
  lastError: Error | null;
  transportHealthy: boolean;
  partialOrder: PartialOrder | null;
  partialState: PartialState;
  maxContainerLength: number;
  readTimeoutMs: number;
  transferDeadlineMs: number;
  maxEventBlocks: number;
  logLevel: MtpLogLevel;
  logger: MtpLogger;
  writeChunkSize: number;
  sendZeroLengthPacket: boolean;

  addEventListener<K extends keyof MtpEventMap>(
    type: K,
    listener: (this: Mtp, event: MtpEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MtpEventMap>(
    type: K,
    listener: (this: Mtp, event: MtpEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;

  getName(
    list: Record<string, { value: number; name: string }>,
    index: number,
  ): string;
  isTransportHealthy(): boolean;
  setLogLevel(level: MtpLogLevel): void;
  getLogLevel(): MtpLogLevel;
  buildContainerPacket(container: ContainerInput): ArrayBuffer;
  parseContainerPacket(bytes: DataView, length?: number): Container;
  read(deadline?: number): Promise<Container>;
  readData(deadline?: number, operation?: number): Promise<Container>;
  write(buffer: BufferSource): Promise<{
    status: 'ok';
    bytesWritten: number;
  }>;
  openSession(): Promise<Container>;
  closeSession(): Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
  getObjectHandles(
    storageId?: number,
    format?: number,
    parent?: number,
  ): Promise<number[]>;
  getStorageIDs(): Promise<number[]>;
  getStorageInfo(storageId: number): Promise<StorageInfo>;
  getNumObjects(
    storageId: number,
    format?: number,
    parent?: number,
  ): Promise<number>;
  getObjectInfo(objectHandle: number): Promise<ObjectInfo>;
  getObjectPropertyList(
    options?: GetObjectPropertyListOptions,
  ): Promise<PropListResult>;
  sendObjectPropertyList(
    storageId: number,
    parentObjectHandle: number,
    format: number,
    entries: PropListEntry[],
    size?: number | bigint,
  ): Promise<Container>;
  uploadFile(options: UploadOptions): Promise<number>;
  deleteObject(objectHandle: number): Promise<Container>;
  getFileName(objectHandle: number): Promise<string>;
  getFile(objectHandle: number, fileName?: string): Promise<Uint8Array>;
  getPartial(
    objectHandle: number,
    offset: number,
    length: number,
    order?: PartialOrder,
  ): Promise<Uint8Array>;
  getThumb(objectHandle: number): Promise<Uint8Array>;
  getPartialObject(
    objectHandle: number,
    offset: number,
    length: number,
  ): Promise<Uint8Array>;
  getDevicePropDesc(property: number): Promise<DevicePropDesc>;
  getDevicePropValue(property: number, datatype: number): Promise<unknown>;
  setDevicePropValue(
    property: number,
    value: unknown,
    datatype: number,
  ): Promise<Container>;
  resetDevicePropValue(property: number): Promise<Container>;
  getDeviceProperty(property: number): Promise<DevicePropertyResult>;
  setDeviceProperty(
    property: number,
    value: unknown,
    datatype?: number,
  ): Promise<Container>;
  getObjectPropsSupported(format: number): Promise<number[]>;
  getObjectPropDesc(property: number, format: number): Promise<ObjectPropDesc>;
  getObjectPropValue(
    objectHandle: number,
    property: number,
    datatype: number,
  ): Promise<unknown>;
  setObjectPropValue(
    objectHandle: number,
    property: number,
    value: unknown,
    datatype: number,
  ): Promise<Container>;
  getObjectProperty(
    objectHandle: number,
    property: number,
    format?: number,
  ): Promise<ObjectPropertyResult>;
  setObjectProperty(
    objectHandle: number,
    property: number,
    value: unknown,
    options?: SetObjectPropertyOptions,
  ): Promise<Container>;
  setObjectPropertyList(entries: PropListEntry[]): Promise<Container>;
  getObjectReferences(objectHandle: number): Promise<number[]>;
  setObjectReferences(
    objectHandle: number,
    handles: number[],
  ): Promise<Container>;
  moveObject(
    objectHandle: number,
    storageId: number,
    parentObjectHandle?: number,
  ): Promise<Container>;
  copyObject(
    objectHandle: number,
    storageId: number,
    parentObjectHandle?: number,
  ): Promise<Container>;
  formatStore(storageId: number, filesystemType?: number): Promise<Container>;
  resetDevice(): Promise<Container>;
  selfTest(): Promise<Container>;
  setObjectProtection(
    objectHandle: number,
    protectionStatus: number,
  ): Promise<Container>;
  initiateCapture(storageId: number, format?: number): Promise<Container>;
  initiateOpenCapture(storageId: number, format?: number): Promise<Container>;
  terminateOpenCapture(transactionId: number): Promise<Container>;
  powerDown(): Promise<Container>;
  readEvent(timeoutMs?: number): Promise<Container>;
  recover(): Promise<Mtp>;
  resetUsbDevice(): Promise<void>;
  close(): Promise<void>;
}
