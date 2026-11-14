# mtp-web v0.2.0

Adds browser-safe packaging, TypeScript declarations, broader MTP support and reliable uploads.

## Breaking changes

- The package now uses conditional exports. Import `mtp-web` from Node.js,
  Electron and browser bundlers. Subpath imports such as `mtp-web/src/mtp.js`
  are no longer exported. Migrate by importing the package root.

## Library

- Added `src/node.js` for Node.js and Electron. It loads `usb` and installs the
  WebUSB shim.
- Added `src/mtp.js` as the browser entry. It never imports the native `usb`
  module.
- Added hand-written TypeScript declarations in `src/mtp.d.ts`.
- Added `isSupported()` and `Mtp.isSupported()` for Chromium and WebUSB checks.
  Firefox and Safari return false.
- Added opt-in logging with `logLevel`, `logger`, `setLogLevel()` and
  `getLogLevel()`. Logging is silent by default.
- Added `getDeviceInfo()`, `getPartial()` and `getThumb()`.
- Added device and object property descriptors, property values and property
  lists.
- Added object references, move, copy, 32-bit partial reads, storage format,
  device reset, self-test, object protection and capture commands.
- Added MTP event reading and array property datatypes.
- Fixed upload framing. The data-container header and first payload bytes now
  share one USB transfer. Uploads use 512-byte OUT chunks by default.
- Added `writeChunkSize` and `sendZeroLengthPacket` options. A zero-length
  packet is off by default.
- Added duplicate-name retries as `name (2).ext`, `name (3).ext`, up to 10
  names.
- Added transport health tracking, `recover()` and `resetUsbDevice()`.
- Added endpoint halt clearing after a failed read or write.

## Browser demo

- Restructured the layout around a connection toolbar, storage controls and a
  files pane.
- Added an always-visible connection log with a copy button.
- Added upload progress, duplicate-name results and recovery guidance.
- Added browser support detection and clearer unsupported-browser guidance.
- Kept file sizes on one line and kept navigation links in a new tab.

## Tooling and documentation

- Added a Vite browser fixture and a TypeScript consumer fixture.
- Added release automation that tags the merged version. It does not bump the
  version in `package.json`. A dry run is available.
- Added a release-notes skill and the v0.1.0 changelog entry.
- Trimmed the README and moved detailed usage to `docs/usage.md`.
- The unit, browser-entry and USB contract suites now run 133 automated tests.

## Verification

- `make check` passed.
- A physical Android device uploaded a 996-byte WebP as 512 and 496 byte
  transfers and returned handle 12.
- Duplicate-name retry and browser-support detection are covered by automated
  tests. They were not re-tested on the physical device for this release.

## Install

```bash
npm install mtp-web
```
