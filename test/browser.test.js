import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

test('the browser entry contains no usb import', async () => {
  const source = await readFile(
    new URL('../src/mtp.js', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /from\s+['"]usb['"]/);
  assert.doesNotMatch(source, /import\s*\(\s*['"]usb['"]\s*\)/);
  assert.doesNotMatch(source, /require\s*\(\s*['"]usb['"]\s*\)/);
  assert.doesNotMatch(source, /@node-usb/);
});

test('the node entry imports the usb shim', async () => {
  const source = await readFile(
    new URL('../src/node.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /from\s+['"]usb['"]/);
});

test('Node resolves the node entry through the exports map', () => {
  const resolved = import.meta.resolve('mtp-web');

  assert.match(resolved, /\/src\/node\.js$/);
});

test('the node entry loads', async () => {
  const module = await import('../src/node.js');

  assert.equal(typeof module.default, 'function');
  assert.equal(typeof module.setUsbTransport, 'function');
});

test('Node imports the package through the exports map', async () => {
  const module = await import('mtp-web');

  assert.equal(typeof module.default, 'function');
  assert.equal(typeof module.OBJECT_FORMAT, 'object');
});

test('Vite builds a browser import without the native usb module', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mtp-web-vite-'));

  try {
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(packageRoot, join(root, 'node_modules', 'mtp-web'), 'dir');
    await writeFile(
      join(root, 'index.html'),
      '<script type="module" src="/main.js"></script>\n',
    );
    await writeFile(
      join(root, 'main.js'),
      "import Mtp from 'mtp-web';\n" +
        'globalThis.Mtp = Mtp;\n' +
        'console.log(typeof Mtp);\n',
    );

    await build({
      root,
      logLevel: 'silent',
      build: {
        outDir: join(root, 'dist'),
        emptyOutDir: true,
      },
    });

    const assets = await readdir(join(root, 'dist', 'assets'));
    const script = assets.find(file => file.endsWith('.js'));
    assert.ok(script, 'Vite writes a JavaScript bundle');

    const bundle = await readFile(join(root, 'dist', 'assets', script), 'utf8');
    assert.match(bundle, /The MTP transport is out of sync/);
    assert.doesNotMatch(bundle, /@node-usb/);
    assert.doesNotMatch(bundle, /usb\.darwin-arm64/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
