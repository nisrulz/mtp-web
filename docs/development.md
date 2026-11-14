# Development

## Project layout

```text
src/mtp.js                 browser-safe library entry point
src/node.js                Node.js entry that installs the usb shim
src/mtp.d.ts               hand-written TypeScript declarations
src/usb.d.ts               type shim for the usb package
test/mtp.test.js           unit tests with a fake USB device
test/usb.test.js           dependency contract tests for usb
test/browser.test.js       browser entry and Vite build tests
test/types/consumer.ts     TypeScript consumer fixture
e2e/device.test.js         physical-device WebUSB tests with Puppeteer
e2e/fixture.html           test page for the E2E suite
e2e/server.js              local HTTP server for the E2E page
scripts/manual-test.js     hardware smoke test
scripts/build-demo.js      builds the standalone demo bundle
scripts/release.sh         releases a version and publishes it
_site/index.html           browser demo page
_site/script.js            browser demo source logic
_site/demo.js              generated standalone demo bundle
_site/style.css            browser demo styles
_site/img/logo.svg         generated demo logo
img/logo.svg               project logo and favicon source
docs/                      user and maintainer guides
Makefile                   developer commands
tsconfig.json              JavaScript type-check options
tsconfig.types.json        TypeScript fixture options
```

## Setup

```bash
make install
```

Node.js 18 or newer is necessary for the library. `usb` 3 installs prebuilt
binaries. The developer tools need Node.js 22.12 or newer and Yarn 1.22 or
newer.

Run `make help` to list every target.

## Checks

```bash
make check
```

`make check` runs 6 checks:

1. `make format-check` checks the formatting with Prettier.
2. `make lint` checks the code with ESLint.
3. `make typecheck` checks the JavaScript types with `tsc` and the JSDoc types.
4. `make typecheck-types` checks the TypeScript consumer fixture and `src/mtp.d.ts`.
5. `make demo-bundle-check` checks that the standalone demo is current.
6. `make test` runs the unit tests.

The unit tests include a Vite browser build. Vite must be installed. The build
imports `mtp-web` and confirms that the browser entry does not resolve `usb`.

Run `make format` to write the formatting changes. Run `make lint-fix` to fix
the issues that ESLint can fix. Run `make test` alone during development.

Run `make audit` to check the dependencies for known vulnerabilities. It needs
network access.

The unit tests run on `node:test` and need no hardware. A fake device replays
MTP containers. The tests cover the reader, the writer, the transaction checks
and the error paths. The tests compare each upload byte with the recorded
transfers. `test/usb.test.js` checks the `usb` 3 WebUSB contract. Run the
hardware smoke test after you change the `usb` version.

## Physical-device E2E suite

```bash
make e2e
```

The suite starts Chrome, opens the WebUSB device picker, selects the Samsung
device and drives the browser demo code. It needs these conditions:

- Connect the device with a data cable.
- Unlock the device.
- Set the USB mode to **File Transfer / MTP**.
- Close Android File Transfer, OpenMTP, Smart Switch and `adb`.

The suite creates files with the `mtp-web-e2e-` prefix. It deletes only the
files that it created. It does not delete other objects.

A read-only storage skips the upload and delete tests. Unlock the phone to run
them. Set `E2E_REQUIRE_WRITE=1` to fail when the storage is read-only.

The suite reads a device from the Samsung vendor ID by default. Use these
environment variables to change the target:

| Variable                   | Default | Purpose                                           |
| -------------------------- | ------- | ------------------------------------------------- |
| `E2E_VENDOR_ID`            | `04e8`  | USB vendor ID in hexadecimal.                     |
| `E2E_PRODUCT_ID`           | none    | USB product ID in hexadecimal.                    |
| `E2E_DEVICE_NAME`          | samsung | Case-insensitive part of the product name.        |
| `E2E_REQUIRE_WRITE`        | `0`     | Fail when the storage is read-only.               |
| `E2E_HEADLESS`             | `0`     | Run Chrome without a window. The picker can fail. |
| `E2E_TIMEOUT_MS`           | 30000   | Device prompt timeout in milliseconds.            |
| `E2E_OPERATION_TIMEOUT_MS` | 120000  | Total test timeout in milliseconds.               |

The suite writes a screenshot to `e2e/artifacts/` when a test fails.

## Hardware smoke test

```bash
make manual-test
```

Edit the vendor and product IDs at the top of `scripts/manual-test.js` first.
The script reads the newest `.ibf` object on the device, writes it to the
current directory and prints the size.

## Standalone demo

```bash
make demo-bundle
```

The command generates `_site/demo.js` from `src/mtp.js` and `_site/script.js`.
The page loads `demo.js` as a classic script. It has no module imports and no
server requirement. Open `_site/index.html` directly in a Chromium browser.

Run `make check` to confirm that `_site/demo.js` is current. Run
`make demo-bundle` after a change to the library or the demo logic. The `_site/`
directory is the demo source and the GitHub Pages output.

GitHub Pages does not need a server or a build at request time. The workflow
runs `make pages` before it uploads the static files.

## GitHub Pages demo

The `Pages` workflow publishes the demo on each push to `master`. The workflow
runs `make pages` and uploads `_site`. The published URL is
`https://nisrulz.github.io/mtp-web/`.

Set **Settings > Pages > Build and deployment > Source** to **GitHub Actions**
for the first run. The workflow asks GitHub to enable Pages when the token has
permission.

## Publishing

Bump `version` in a pull request. Merge the pull request into the default
branch. Then create the tag from that merged commit.

The release script does these steps:

1. It switches to the default branch and updates it.
2. It verifies that `package.json` on the default branch has the requested
   version.
3. It runs `make check`.
4. It verifies that the local default branch matches the remote branch.
5. It tags the current commit.
6. It pushes the tag to GitHub.
7. It publishes the package to npm.

```bash
make release-dry-run VERSION=0.2.0
make release VERSION=0.2.0
```

The version must equal the version in `package.json` on the default branch. The
script does not bump the version. The working tree must have no changes. The
`npm` account must be authenticated. The script stops when a check fails, when
the tag exists, when the version is not yet merged, or when the version is
already published.

A dry run does not run the checks. It does not change the repository. It does
not publish the package.

The published tarball contains `src/`, `README.md`, `LICENSE` and `NOTICE`. The
`files` field in `package.json` controls the list. Keep `LICENSE` and `NOTICE`
in the list. BSD-2-Clause requires the notice in binary distributions.

Run `make pack` to inspect the tarball before a release.
