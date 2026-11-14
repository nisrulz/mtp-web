import { webusb } from 'usb';

import Mtp, { setUsbTransport } from './mtp.js';

setUsbTransport(webusb);

export * from './mtp.js';
export default Mtp;
