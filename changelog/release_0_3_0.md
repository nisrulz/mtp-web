# mtp-web v0.3.0

Corrects protocol details found by checking the library against the MTP 1.1
specification, and rebuilds the browser demo theme.

## Breaking changes

- `DEVICE_PROPERTY` now uses the MTP 1.1 codes from `0xD401`. The
  `SUPPORTED_FORMATS`, `SUPPORTED_FORMAT_CATEGORIES` and
  `SUPPORTED_FORMAT_PROPERTIES` names are removed. `SUPPORTED_FORMATS_ORDERED`
  replaces `SUPPORTED_FORMATS`. Code that used the old names must switch to the
  new names.
- `getPartial()` now sends the low offset word first. The method still retries
  with the high word first when the device rejects that order. `partialOrder`
  caches the order that worked.

## Library

- Decode the `DeviceInfo` operation, event and device property arrays as 16-bit
  values. Reading the event and property arrays as 32-bit values shifted every
  field after them, including the manufacturer and serial strings.
- Reject a `DeviceInfo` array count that is larger than the payload. The old
  clamp could consume the trailing strings and return a dataset with empty
  strings.
- Correct the MTP device property codes: synchronization partner, device
  friendly name, volume, supported formats ordered, device icon, session
  initiator version information, perceived device type and the playback
  properties.
- Correct the object property event codes to `0xC801`, `0xC802` and `0xC803`,
  and add the descriptor and reference events.
- Send `CloseSession` without parameters, as the operation defines none.
- Accept an `OK` response as an empty data phase. A zero-byte thumbnail now
  returns an empty `Uint8Array` instead of a transport error.

## Browser demo

- Rebuilt the palette from two colors per theme. Light mode uses blue bell
  `#3E92CC` on ghost white `#FFFAFF`. Dark mode uses deep purple `#311847` as
  the primary, magenta `#A01A7D` as the accent, and near-black `#201E1F` as the
  base.
- Added light and dark theme tokens for the new palette. Surfaces, borders,
  muted text and hover states derive from those colors. Danger, success and
  warning stay semantic. Text, links and status tones stay legible in both
  themes.
- The empty and loading messages sit outside the table and are centered in the
  file pane. The table and its header appear only when a folder has items.
- File rows alternate their background. A row uses a blue tint on hover in
  light mode and a magenta tint in dark mode.

## Verification

- `make check` passed: formatting, lint, JSDoc types, bundle check and 137
  automated tests.
- The demo was rendered in a headless browser in light and dark mode. The empty
  state, the file rows and the enabled primary buttons were checked in both
  themes.

## Install

```bash
npm install mtp-web
```
