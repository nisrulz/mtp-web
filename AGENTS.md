# AGENTS.md

Rules for coding agents. This repository is a small ESM library. Keep each
change small. Use test-driven development.

## Project

`mtp-web` speaks MTP over WebUSB in Chromium browsers and over `usb` 3 in
Node.js 18+ and Electron. It reads, uploads and deletes objects. It has no build
step, no bundler and no TypeScript. The runtime dependency is `usb` 3. The
development dependencies are ESLint, Prettier, TypeScript, Puppeteer and the
Node.js type definitions. Ask before you add a runtime dependency. Do not add
analytics, telemetry or tracking code.

## Code map

| Path                          | Owns                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `src/mtp.js`                  | The full library: containers, MTP strings, ObjectInfo, property lists, `Mtp`, every command |
| `test/mtp.test.js`            | Unit tests. `FakeDevice` replays containers and records writes                              |
| `test/usb.test.js`            | Dependency contract tests for the `usb` package                                             |
| `e2e/device.test.js`          | Physical-device WebUSB suite. Puppeteer drives the browser and the real device              |
| `e2e/fixture.html`            | Test page for the E2E suite                                                                 |
| `e2e/server.js`               | Local HTTP server for the E2E page                                                          |
| `scripts/manual-test.js`      | Hardware smoke test                                                                         |
| `scripts/build-demo.js`       | Builds the standalone demo bundle                                                           |
| `_site/index.html`            | Browser demo: connect, list, download, upload, delete                                       |
| `_site/script.js`             | Browser demo source logic                                                                   |
| `_site/demo.js`               | Generated standalone browser bundle                                                         |
| `_site/style.css`             | Browser demo styles                                                                         |
| `_site/img/logo.svg`          | Generated demo logo                                                                         |
| `Makefile`                    | Developer command surface                                                                   |
| `.github/workflows/ci.yml`    | CI checks                                                                                   |
| `.github/workflows/pages.yml` | GitHub Pages deployment                                                                     |
| `eslint.config.js`            | ESLint rules                                                                                |
| `.prettierrc.json`            | Prettier options                                                                            |
| `tsconfig.json`               | TypeScript `checkJs` options                                                                |
| `docs/api.md`                 | Public API reference                                                                        |
| `docs/usage.md`               | Browser, Node.js and Electron use                                                           |
| `docs/troubleshooting.md`     | Device, storage and protocol failures                                                       |
| `docs/development.md`         | Layout, tests, demo and publish steps                                                       |
| `README.md`                   | User overview and quick starts                                                              |
| `package.json`                | Name, version, `files`, `main`, `engines` and the test script                               |
| `img/logo.svg`                | Project logo and favicon source                                                             |

Inside `src/mtp.js`:

- `_execute()`: queues one command. `_executeDirect()` runs the command, data and
  response phases and checks the transaction ID.
- `buildContainerPacket()`, `_writeDataContainer()` and `_writeChunks()`:
  outbound containers and 64 KiB chunking.
- `read()`, `readData()` and `_readResponse()`: inbound buffers and phases.
- `encode*` and `decode*`: pure datasets and property lists.
- `normalizeBytes()`: `ArrayBuffer` and typed-array conversion.

## Workflow

1. **Map.** Read the owning functions above, the related test and the owning
   docs page. Do not copy logic that already exists.

2. **Reuse.** Send every command through `_execute()` with its phase flags.
   Reuse the existing encode and decode helpers and `normalizeBytes`. Export a
   new pure helper only when a test needs it. Keep the `isBrowser` split for
   browser and Node paths.

3. **Simplify.** Select readable code over comments. Extract nested logic into a
   named function and do not explain it with a comment. Use an options object in
   place of more than 4 positional arguments. Do not add indirection for a
   single caller.

4. **Protect.** Do not weaken these checks: operation queue, container length
   limit, event-block cap, transfer deadline, setup and write timeouts,
   transport health, transaction ID match, non-OK responses, ADB exclusion, MTP
   string count clamp, phase order, write chunking, partial-write resume and the
   read timeout. A broken or hostile device must cause an error. It must not
   hang and must not desynchronize the stream. Add a hostile-input test when
   parsing or a limit changes: short header, impossible length, wrong
   transaction ID, count larger than the payload.

5. **Test first.** Use red, green, refactor. Write the failing test, run
   `make test`, implement until the test passes, then refactor. For writes, check
   the bytes on the wire. Hardware checks are manual (`make manual-test` and
   `make e2e`). Still cover the logic at the fake-device seam.

6. **Document.** Update the owning `docs/` page and the `docs/api.md` table.
   Change `README.md` only for user-facing behaviour. Do not add ADRs or extra
   design notes.

7. **Check.** Run `make check` before each commit. Fix every failure.

## Language

Write all documentation in ASD-STE100 Simplified Technical English.

- Write one instruction or one fact in each sentence. Keep sentences short.
- Use the active voice and the present tense. Use the imperative for
  instructions.
- Do not use contractions.
- Write a number as a numeral.
- Keep technical details exact: identifiers, code, hex values, sizes, timeouts,
  paths and limits.
- Do not remove a condition or a step to make a sentence shorter.

## Ask before you change

- The public API: method names, arguments, return types, events and exports.
- `package.json`: name, version, `files`, `main` and `engines`. Keep `LICENSE`
  and `NOTICE` in the published tarball.
- MTP wire behaviour: container layout, transaction IDs, phase order and upload
  bytes.
- Validation rules, errors and timeouts.
- The Node floor and the browser matrix.

## Commands

```bash
make install
make test                  # unit tests, no hardware
make check                 # formatting, lint, types and unit tests
make audit                 # dependency vulnerability check
make format                # write the formatting changes
make lint                  # check the code with ESLint
make typecheck             # check the JSDoc types with tsc
make e2e                   # physical-device WebUSB suite
make manual-test           # hardware smoke test
make demo-bundle           # build the standalone browser bundle in _site
make pages                 # prepare the GitHub Pages demo in _site
make pack                  # inspect the tarball
```

Use the Makefile for every repository command. Do not add parallel npm scripts.

## Conventions

- Use conventional commit types and an imperative subject with no trailing
  period. Make one commit for each logical change.
- Use `const` and arrow functions. Add JSDoc to exports.
- A comment explains why. A comment does not explain what the code does.
