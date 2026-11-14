# mtp-web v0.1.0

First public release of `mtp-web`, forked from `webmtp` and upgraded for `usb` 3.3.0.

## Library

- Forked `webmtp` as `mtp-web` and moved the implementation to `src`.
- Added unit tests and USB contract tests.
- Upgraded `usb` from 2.5.2 to 3.3.0.
- Hardened the transport with a command queue, setup and write timeouts, transport health checks, interface and alternate selection, ADB exclusion, and partial-write recovery.
- Corrected MTP behavior for storage access capabilities, `GetObjectPropList` and `SendObjectPropList` parameters, and 128-bit property encoding.
- Added full MTP specification coverage for property datatypes, container and string edge cases, ObjectInfo defaults, command wire parameters, storage access modes, response errors, transaction wrapping, and 64 KiB chunking.

## Browser demo

- Added a standalone browser demo in `_site`.
- Removed the old root page and HTTPS server.
- Added a two-pane file browser with connect and disconnect controls, folder drill-down, a single upload flow, and connection status that survives refreshes.
- Added persisted light and dark themes, icon actions, and clearer status handling.

## Tooling and documentation

- Added ESLint, Prettier, TypeScript JSDoc checks, Make targets, CI, and GitHub Pages deployment.
- Added a physical-device Puppeteer E2E suite and a hardware smoke test.
- Updated the CI check to use Node 24; Puppeteer 25 requires Node 22.12 or newer.
- Rewrote the guides for browser, Node.js, and Electron use, the API, troubleshooting, development, and agent guardrails.

## License

The fork adds a second copyright holder. BSD-2-Clause requires the original notice to travel with source and binary distributions. `NOTICE` records the upstream attribution for the npm tarball.

## Install

```bash
npm install mtp-web
```
