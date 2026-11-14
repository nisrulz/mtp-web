// Hardware smoke test: reads the newest .ibf file from a MediaTek-based
// device. Change the vendor/product IDs for your own hardware before running.
//
//   make manual-test
//
import fs from 'node:fs';
import path from 'node:path';
import Mtp from '../src/mtp.js';

const vendorId = 0x0e8d;
const productId = 0x201d;

const mtp = new Mtp(vendorId, productId);

mtp.addEventListener('error', event => {
  console.error('MTP error:', event.error ?? event);
});

mtp.addEventListener('ready', async () => {
  try {
    await mtp.openSession();
    const handles = await mtp.getObjectHandles();

    handles.sort((a, b) => b - a);
    console.log('Handles:', handles);

    let fileName;
    let objectHandle;
    for (let i = 0; i < handles.length; i += 1) {
      objectHandle = handles[i];
      fileName = await mtp.getFileName(objectHandle);
      if (fileName.endsWith('.ibf')) {
        break;
      }
    }

    if (!fileName?.endsWith('.ibf')) {
      throw new Error('No .ibf object found on the device.');
    }

    const outputName = path.basename(fileName);
    const hasControlCharacter = [...outputName].some(character => {
      const code = character.codePointAt(0);
      return code <= 0x1f || code === 0x7f;
    });
    if (outputName !== fileName || hasControlCharacter) {
      throw new Error(`Refusing unsafe object name: ${fileName}`);
    }

    const array = await mtp.getFile(objectHandle, outputName);
    fs.writeFileSync(outputName, array);
    console.log(`Wrote ${outputName} (${array.byteLength} bytes)`);
  } catch (error) {
    console.error('MTP read failed:', error);
  } finally {
    await mtp.close();
  }
});
