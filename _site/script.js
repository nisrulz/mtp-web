import Mtp, { isSupported, OBJECT_FORMAT, STORAGE_ACCESS } from '../src/mtp.js';

const status = document.querySelector('#status');
const connectButton = document.querySelector('#connect');
const disconnectButton = document.querySelector('#disconnect');
const storageButton = document.querySelector('#storage-button');
const storageValue = document.querySelector('#storage-value');
const storageMenu = document.querySelector('#storage-menu');
const storageNote = document.querySelector('#storage-note');
const refreshButton = document.querySelector('#refresh');
const fileInput = document.querySelector('#file');
const uploadButton = document.querySelector('#upload');
const table = document.querySelector('#objects');
const filesTable = document.querySelector('#files-table');
const emptyState = document.querySelector('#empty-state');
const emptyTitle = document.querySelector('#empty-title');
const emptyDetail = document.querySelector('#empty-detail');
const folderBackButton = document.querySelector('#folder-back');
const folderPath = document.querySelector('#folder-path');
const fileCount = document.querySelector('#file-count');
const notice = document.querySelector('#notice');
const themeToggle = document.querySelector('#theme-toggle');
const logOutput = document.querySelector('#log');
const copyLogButton = document.querySelector('#copy-log');

let mtp = null;
let selectedStorageId = null;
let folderStack = [{ handle: 0xffffffff, name: 'Storage root' }];
const storageInfo = new Map();
const usbSupported = isSupported();
const logLines = [];

function logContext(context) {
  if (!context) {
    return '';
  }
  if (context.error instanceof Error) {
    return ` ${context.error.name}: ${context.error.message}`;
  }
  try {
    const text = JSON.stringify(context);
    return text && text !== '{}' ? ` ${text}` : '';
  } catch {
    return '';
  }
}

function appendLog(level, message, context) {
  const line = `${new Date().toLocaleTimeString()} ${level.toUpperCase()} ${message}${logContext(
    context,
  )}`;
  logLines.push(line);
  if (logLines.length > 300) {
    logLines.shift();
  }
  if (logOutput) {
    logOutput.textContent = logLines.join('\n');
    logOutput.scrollTop = logOutput.scrollHeight;
  }
  const consoleApi = globalThis.console;
  const method = consoleApi?.[level] ?? consoleApi?.log;
  method?.call(consoleApi, `[mtp-web] ${message}`, context ?? '');
}

const demoLogger = {
  debug: (message, context) => appendLog('debug', message, context),
  info: (message, context) => appendLog('info', message, context),
  warn: (message, context) => appendLog('warn', message, context),
  error: (message, context) => appendLog('error', message, context),
};

function copyLogWithSelection(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand?.('copy') ?? false;
  area.remove();
  return copied;
}

async function copyConnectionLog() {
  const text = logLines.join('\n') || 'No log entries.';
  let copied = false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    // Some browsers block the Clipboard API outside a secure context.
  }

  if (!copied) {
    copied = copyLogWithSelection(text);
  }

  if (copied) {
    setNotice('Connection log copied');
  } else {
    setNotice('Could not copy the log. Select the text and copy it.', 'danger');
  }
}

const THEME_KEY = 'mtp-web-theme';
const ICONS = {
  back: ['m15 18-6-6 6-6'],
  phone: [
    'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
    'M12 18h.01',
  ],
  disconnect: ['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10'],
  refresh: [
    'M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5',
    'M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5',
  ],
  upload: ['M12 16V4', 'm6 10 6-6 6 6', 'M4 20h16'],
  download: ['M12 4v12', 'm6 10 6 6 6-6', 'M4 20h16'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  copy: ['M8 8h11v11H8z', 'M5 16V5h11'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.42 1.42',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
};

function createIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  for (const data of ICONS[name] ?? []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }

  return svg;
}

function setIcon(button, name) {
  button.querySelector('svg')?.remove();
  button.prepend(createIcon(name));
}

function updateThemeToggle() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';

  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  setIcon(themeToggle, dark ? 'sun' : 'moon');
}

function applyTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The selected theme still applies for this page.
    }
  }

  updateThemeToggle();
}

function setStatus(text, tone = 'neutral') {
  status.textContent = text;
  status.dataset.tone = tone;
}

function setFileCount(text, tone = 'neutral') {
  fileCount.textContent = text;
  fileCount.dataset.tone = tone;
}

let noticeTimer;
function setNotice(text, tone = 'success') {
  clearTimeout(noticeTimer);
  notice.textContent = text;
  notice.dataset.tone = tone;
  notice.hidden = !text;

  if (text) {
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 5000);
  }
}

function describeError(error, fallback) {
  const message = error?.message ?? String(error ?? '');

  if (/No device selected|cancel/i.test(message)) {
    return 'No phone was selected. Select your phone to continue.';
  }
  if (/claim/i.test(message)) {
    return 'Could not open your phone. Close other apps that use it, then try again.';
  }
  if (/timed out|timeout/i.test(message)) {
    return 'Your phone did not respond. Keep it unlocked and try again.';
  }
  if (/StoreReadOnly|read-only/i.test(message)) {
    return 'This storage is read only. Choose another storage.';
  }
  if (/StoreFull|not enough|full/i.test(message)) {
    return 'This storage does not have enough free space.';
  }
  if (/AccessDenied|denied/i.test(message)) {
    return 'Your phone denied that action.';
  }
  if (
    /OperationNotSupported|ParameterNotSupported|InvalidParameter/i.test(
      message,
    )
  ) {
    return 'Your phone does not support that action.';
  }
  if (/out of sync|deadline exceeded/i.test(message)) {
    return 'The phone connection was lost. Connect again.';
  }
  if (/not ready|not found|reconnect|session/i.test(message)) {
    return 'Your phone is not ready. Reconnect it and try again.';
  }

  return `${fallback}. Try again.`;
}

function itemCount(count) {
  if (count === 0) {
    return 'No items';
  }
  return `${count} item${count === 1 ? '' : 's'}`;
}

function showEmptyState(
  title = 'No phone connected',
  detail = 'Connect your phone to browse its files.',
) {
  table.replaceChildren();
  filesTable.hidden = true;
  emptyState.hidden = false;
  emptyTitle.textContent = title;
  emptyDetail.textContent = detail;
}

function updateConnectionState() {
  connectButton.textContent = mtp ? 'Switch phone' : 'Connect phone';
  setIcon(connectButton, 'phone');
  connectButton.classList.toggle('primary', !mtp);
  connectButton.disabled = !usbSupported;
  connectButton.title = usbSupported
    ? ''
    : 'This browser does not support WebUSB. Use Chrome or Edge.';
  disconnectButton.disabled = !mtp;
}

async function disconnect({ silent = false } = {}) {
  const current = mtp;
  mtp = null;
  setNotice('');
  selectedStorageId = null;
  resetFolders();
  storageInfo.clear();
  storageMenu.replaceChildren();
  storageButton.disabled = true;
  refreshButton.disabled = true;
  fileInput.disabled = true;
  fileInput.value = '';
  uploadButton.disabled = true;
  storageNote.textContent = '';
  storageValue.textContent = 'No storage found';
  showEmptyState();
  setFileCount('No items', 'neutral');
  updateUploadState();
  connectButton.disabled = !usbSupported;
  updateConnectionState();

  if (!silent) {
    setStatus('Phone disconnected', 'neutral');
  }

  await current?.close().catch(() => {});
}

function currentFolder() {
  return folderStack[folderStack.length - 1];
}

function updateFolderHeader() {
  folderPath.textContent = folderStack.map(folder => folder.name).join(' / ');
  folderBackButton.disabled = folderStack.length <= 1;
}

function resetFolders() {
  folderStack = [{ handle: 0xffffffff, name: 'Storage root' }];
  updateFolderHeader();
}

function openFolder(object) {
  if (object.format !== OBJECT_FORMAT.ASSOCIATION) {
    return;
  }

  folderStack.push({ handle: object.handle, name: object.filename });
  updateFolderHeader();
  loadObjects().catch(error =>
    setNotice(describeError(error, 'Could not open that folder'), 'danger'),
  );
}

function goBackOneFolder() {
  if (folderStack.length <= 1) {
    return;
  }

  folderStack.pop();
  updateFolderHeader();
  loadObjects().catch(error =>
    setNotice(describeError(error, 'Could not open that folder'), 'danger'),
  );
}

function updateUploadState() {
  if (!mtp) {
    uploadButton.disabled = true;
    uploadButton.title = 'Connect your phone to upload files.';
    storageNote.textContent = '';
    return;
  }

  if (currentStorage() == null) {
    uploadButton.disabled = true;
    uploadButton.title = 'No storage is available.';
    storageNote.textContent = '';
    return;
  }

  const info = storageInfo.get(currentStorage());
  const readOnly = info?.readOnly ?? true;

  uploadButton.disabled = readOnly;
  uploadButton.title = readOnly ? 'This storage is read only.' : '';
  storageNote.textContent = readOnly
    ? 'This storage is read only. You can download files, but you cannot upload.'
    : '';
}

function setUploadLabel(text) {
  const label = [...uploadButton.childNodes].find(
    node => node.nodeType === Node.TEXT_NODE,
  );
  if (label) {
    label.textContent = text;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function currentStorage() {
  return selectedStorageId;
}

function storageLabel(info) {
  return (
    `${info.description || info.volumeLabel || 'Storage'} ` +
    `(${formatBytes(info.freeSpaceInBytes)} free` +
    `${info.readOnly ? ', read only' : ''})`
  );
}

function updateStorageLabel() {
  const info = storageInfo.get(selectedStorageId);
  storageValue.textContent = info ? storageLabel(info) : 'No storage found';

  for (const option of storageMenu.children) {
    const selected = Number(option.dataset.id) === selectedStorageId;
    option.setAttribute('aria-selected', String(selected));
    option.tabIndex = selected ? 0 : -1;
  }
}

function closeStorageMenu({ focus = false } = {}) {
  storageMenu.hidden = true;
  storageButton.setAttribute('aria-expanded', 'false');
  if (focus) {
    storageButton.focus();
  }
}

function openStorageMenu() {
  if (storageButton.disabled) {
    return;
  }

  storageMenu.hidden = false;
  storageButton.setAttribute('aria-expanded', 'true');

  const selected =
    storageMenu.querySelector('[aria-selected="true"]') ??
    storageMenu.firstElementChild;
  if (selected) {
    selected.focus();
  }
}

function chooseStorage(id, { load = true, focus = true } = {}) {
  selectedStorageId = id;
  resetFolders();
  updateStorageLabel();
  closeStorageMenu({ focus });
  updateUploadState();

  if (load) {
    loadObjects().catch(error =>
      setNotice(describeError(error, 'Could not load files'), 'danger'),
    );
  }
}

function moveStorageFocus(direction) {
  const options = [...storageMenu.children];
  if (options.length === 0) {
    return;
  }

  const current = options.indexOf(document.activeElement);
  const index =
    current < 0 ? 0 : (current + direction + options.length) % options.length;
  options[index].focus();
}

function canDelete() {
  const accessCapability = storageInfo.get(currentStorage())?.accessCapability;

  return (
    accessCapability === STORAGE_ACCESS.READ_WRITE ||
    accessCapability === STORAGE_ACCESS.READ_ONLY_WITH_DELETE
  );
}

async function loadStorages() {
  const ids = await mtp.getStorageIDs();
  storageMenu.replaceChildren();
  storageInfo.clear();

  for (const id of ids) {
    const info = await mtp.getStorageInfo(id);
    storageInfo.set(id, info);

    const option = document.createElement('li');
    option.className = 'select-option';
    option.id = `storage-option-${id}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.dataset.id = String(id);
    option.tabIndex = -1;
    option.textContent = storageLabel(info);
    option.addEventListener('click', () => chooseStorage(id));
    storageMenu.append(option);
  }

  storageButton.disabled = ids.length === 0;
  refreshButton.disabled = ids.length === 0;

  if (ids.length > 0) {
    chooseStorage(ids[0], { load: false, focus: false });
  } else {
    selectedStorageId = null;
    updateStorageLabel();
    updateUploadState();
  }
}

function addRow(object) {
  const row = document.createElement('tr');

  const name = document.createElement('td');

  if (object.format === OBJECT_FORMAT.ASSOCIATION) {
    const folderLink = document.createElement('button');
    folderLink.className = 'folder-link';
    folderLink.type = 'button';
    folderLink.textContent = object.filename;
    folderLink.addEventListener('click', () => openFolder(object));
    name.append(folderLink);
  } else {
    name.textContent = object.filename;
  }

  const size = document.createElement('td');
  size.textContent =
    object.format === OBJECT_FORMAT.ASSOCIATION
      ? 'Folder'
      : formatBytes(object.size);

  const actions = document.createElement('td');
  const actionGroup = document.createElement('div');
  actionGroup.className = 'row-actions';

  const download = document.createElement('button');
  download.className = 'button small icon-button';
  download.type = 'button';
  download.setAttribute('aria-label', `Download ${object.filename}`);
  download.title = 'Download';
  setIcon(download, 'download');
  download.addEventListener('click', async () => {
    try {
      const bytes = await mtp.getFile(object.handle);
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = document.createElement('a');
      link.href = url;
      link.download = object.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`Downloaded ${object.filename}`);
    } catch (error) {
      setNotice(describeError(error, 'Could not download that file'), 'danger');
    }
  });

  const remove = document.createElement('button');
  remove.className = 'button small danger icon-button';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Delete ${object.filename}`);
  setIcon(remove, 'trash');
  remove.disabled = !canDelete();
  remove.title = remove.disabled ? 'This storage is read only.' : 'Delete';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete ${object.filename}? This cannot be undone.`)) return;
    try {
      await mtp.deleteObject(object.handle);
      setNotice(`Deleted ${object.filename}`);
      await loadObjects();
    } catch (error) {
      setNotice(describeError(error, 'Could not delete that file'), 'danger');
    }
  });

  if (object.format !== 0x3001) {
    actionGroup.append(download);
  }
  actionGroup.append(remove);
  actions.append(actionGroup);
  row.append(name, size, actions);
  table.append(row);
}

async function loadObjects() {
  if (selectedStorageId == null) {
    showEmptyState(
      mtp ? 'No storage is available' : 'No phone connected',
      mtp
        ? 'Unlock your phone and allow file access.'
        : 'Connect your phone to browse its files.',
    );
    setFileCount('No items', 'neutral');
    return;
  }

  showEmptyState('Loading files…', 'This can take a moment on a large folder.');
  setFileCount('Loading…', 'warning');

  try {
    const handles = await mtp.getObjectHandles(
      currentStorage(),
      0,
      currentFolder().handle,
    );
    handles.sort((a, b) => b - a);

    if (handles.length === 0) {
      showEmptyState(
        'This folder is empty',
        'Upload a file to add it to this folder.',
      );
      setFileCount(itemCount(0), 'neutral');
      return;
    }

    table.replaceChildren();
    for (const handle of handles) {
      addRow(await mtp.getObjectInfo(handle));
    }
    emptyState.hidden = true;
    filesTable.hidden = false;
    setFileCount(itemCount(handles.length), 'success');
  } catch (error) {
    showEmptyState(
      'Could not load files',
      'Try again or reconnect your phone.',
    );
    setFileCount('No items', 'neutral');
    throw error;
  }
}

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  setNotice('');
  setStatus('Selecting phone…', 'warning');

  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: [] });
  } catch (error) {
    connectButton.disabled = false;

    if (mtp) {
      setStatus(
        `Still connected to ${mtp.device?.productName || 'your phone'}`,
        'success',
      );
    } else {
      setStatus('Phone not connected', 'neutral');
      setNotice(describeError(error, 'Could not connect'), 'danger');
    }

    updateConnectionState();
    return;
  }

  if (mtp) {
    await disconnect({ silent: true });
  }

  connectButton.disabled = true;

  try {
    mtp = new Mtp(null, null, device, {
      logLevel: 'debug',
      logger: demoLogger,
    });
    mtp.addEventListener('error', event => {
      setNotice(describeError(event.error ?? event, 'Phone error'), 'danger');
    });

    await mtp.ready;
    await mtp.openSession();
    await loadStorages();
    await loadObjects();

    fileInput.disabled = false;
    updateUploadState();
    setStatus(`Connected to ${device.productName || 'your phone'}`, 'success');
  } catch (error) {
    appendLog('error', 'Connection failed', { error });
    const unhealthy = mtp && !mtp.isTransportHealthy();

    if (unhealthy) {
      setStatus('Resetting phone connection…', 'warning');
      await mtp
        .resetUsbDevice()
        .catch(resetError =>
          appendLog('warn', 'USB reset failed', { error: resetError }),
        );
    }

    await disconnect({ silent: true });
    setStatus('Phone not connected', 'danger');
    setNotice(
      unhealthy
        ? 'The phone connection was reset. Unplug the USB cable, reconnect the phone, then connect again.'
        : describeError(error, 'Could not connect'),
      'danger',
    );
  } finally {
    connectButton.disabled = false;
    updateConnectionState();
  }
});

disconnectButton.addEventListener('click', () => {
  disconnect().catch(error =>
    setNotice(describeError(error, 'Could not disconnect'), 'danger'),
  );
});

storageButton.addEventListener('click', () => {
  if (storageMenu.hidden) {
    openStorageMenu();
  } else {
    closeStorageMenu({ focus: true });
  }
});

storageButton.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openStorageMenu();
  }
});

storageMenu.addEventListener('keydown', event => {
  const options = [...storageMenu.children];

  if (event.key === 'Escape') {
    event.preventDefault();
    closeStorageMenu({ focus: true });
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveStorageFocus(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveStorageFocus(-1);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const option = document.activeElement.closest('[role="option"]');
    if (option) {
      chooseStorage(Number(option.dataset.id));
    }
  }
});

document.addEventListener('click', event => {
  if (!storageMenu.hidden && !event.target.closest?.('.storage-picker')) {
    closeStorageMenu();
  }
});

refreshButton.addEventListener('click', () => {
  loadObjects().catch(error =>
    setNotice(describeError(error, 'Could not refresh files'), 'danger'),
  );
});

async function uploadSelectedFile() {
  const file = fileInput.files[0];
  if (!file || !mtp) {
    return;
  }

  uploadButton.disabled = true;
  uploadButton.setAttribute('aria-busy', 'true');
  setUploadLabel('Uploading…');

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    setNotice(`Uploading ${file.name}…`, 'warning');
    const handle = await mtp.uploadFile({
      storageId: currentStorage(),
      parentObjectHandle: currentFolder().handle,
      filename: file.name,
      data,
      format: OBJECT_FORMAT.UNDEFINED,
      onProgress: sent =>
        setNotice(
          `Uploading ${file.name}… ${formatBytes(sent)} of ${formatBytes(
            data.byteLength,
          )}`,
          'warning',
        ),
    });

    let uploadedName = file.name;
    try {
      uploadedName = (await mtp.getObjectInfo(handle)).filename;
    } catch (error) {
      appendLog('warn', 'Could not read the uploaded file name', { error });
    }

    setNotice(`Uploaded ${uploadedName}`);
    await loadObjects();
  } catch (error) {
    console.error('Upload failed', error);
    if (mtp && !mtp.isTransportHealthy()) {
      setStatus('Resetting phone connection…', 'warning');
      await mtp
        .resetUsbDevice()
        .catch(resetError =>
          appendLog('warn', 'USB reset failed', { error: resetError }),
        );
      await disconnect({ silent: true });
      setStatus('Phone not connected', 'danger');
      setNotice(
        'The phone connection was reset. Unplug the USB cable, reconnect the phone, then connect again.',
        'danger',
      );
      return;
    }
    setNotice(describeError(error, 'Could not upload that file'), 'danger');
  } finally {
    fileInput.value = '';
    uploadButton.removeAttribute('aria-busy');
    setUploadLabel('Upload file');
    updateUploadState();
  }
}

uploadButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  uploadSelectedFile();
});

themeToggle.addEventListener('click', () => {
  applyTheme(
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark',
    true,
  );
});

setIcon(folderBackButton, 'back');
setIcon(refreshButton, 'refresh');
setIcon(disconnectButton, 'disconnect');
setIcon(uploadButton, 'upload');
if (copyLogButton) {
  setIcon(copyLogButton, 'copy');
  copyLogButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    copyConnectionLog();
  });
}
folderBackButton.addEventListener('click', goBackOneFolder);
updateFolderHeader();
updateThemeToggle();
updateConnectionState();
updateUploadState();
showEmptyState();
appendLog('info', 'Demo ready');

if (!usbSupported) {
  setStatus('WebUSB is not supported', 'danger');
  setNotice(
    'Open this page in Chrome or Edge on a desktop computer.',
    'danger',
  );
}

window.addEventListener('beforeunload', () => {
  mtp?.close();
});
