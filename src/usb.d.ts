// The `usb` package ships no type declarations. This covers the shim that
// src/node.js uses.
declare module 'usb' {
  export const webusb: USB;
}
