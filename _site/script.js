import Mtp, { OBJECT_FORMAT } from '../src/mtp.js';

const status = document.querySelector('#status');
const connectButton = document.querySelector('#connect');
const storageButton = document.querySelector('#storage-button');
const storageValue = document.querySelector('#storage-value');
const storageMenu = document.querySelector('#storage-menu');
const storageNote = document.querySelector('#storage-note');
const refreshButton = document.querySelector('#refresh');
const fileInput = document.querySelector('#file');
const uploadButton = document.querySelector('#upload');
const table = document.querySelector('#objects');

let mtp = null;
let selectedStorageId = null;
const storageInfo = new Map();

function setStatus(text, tone = 'neutral') {
  status.textContent = text;
  status.dataset.tone = tone;
}

function updateUploadState() {
  const info = storageInfo.get(currentStorage());
  const readOnly = info?.readOnly ?? true;

  uploadButton.disabled = !mtp || readOnly;
  uploadButton.title = readOnly ? 'The selected storage is read-only.' : '';
  storageNote.textContent = readOnly
    ? 'This storage is read-only. Unlock the phone to upload or delete.'
    : '';
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
    `${info.description || info.volumeLabel || 'storage'} ` +
    `(${formatBytes(info.freeSpaceInBytes)} free` +
    `${info.readOnly ? ', read-only' : ''})`
  );
}

function updateStorageLabel() {
  const info = storageInfo.get(selectedStorageId);
  storageValue.textContent = info ? storageLabel(info) : 'No storage';

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
  updateStorageLabel();
  closeStorageMenu({ focus });
  updateUploadState();

  if (load) {
    loadObjects().catch(error => setStatus(error.message, 'danger'));
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
  return storageInfo.get(currentStorage())?.accessCapability !== 0;
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
  name.textContent = object.filename;

  const size = document.createElement('td');
  size.textContent = formatBytes(object.size);

  const actions = document.createElement('td');
  const actionGroup = document.createElement('div');
  actionGroup.className = 'row-actions';

  const download = document.createElement('button');
  download.className = 'button small';
  download.type = 'button';
  download.textContent = 'Download';
  download.addEventListener('click', async () => {
    try {
      const bytes = await mtp.getFile(object.handle);
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = document.createElement('a');
      link.href = url;
      link.download = object.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus(`Downloaded ${object.filename}`, 'success');
    } catch (error) {
      setStatus(`Download failed: ${error.message}`, 'danger');
    }
  });

  const remove = document.createElement('button');
  remove.className = 'button small danger';
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.disabled = !canDelete();
  remove.title = remove.disabled ? 'This storage is read-only.' : '';
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete ${object.filename}?`)) return;
    try {
      await mtp.deleteObject(object.handle);
      setStatus(`Deleted ${object.filename}`, 'success');
      await loadObjects();
    } catch (error) {
      setStatus(`Delete failed: ${error.message}`, 'danger');
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
  table.replaceChildren();
  if (selectedStorageId == null) return;

  const handles = await mtp.getObjectHandles(currentStorage(), 0, 0xffffffff);
  handles.sort((a, b) => b - a);

  if (handles.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.className = 'empty';
    cell.textContent = 'No objects in this storage.';
    row.append(cell);
    table.append(row);
    setStatus('0 object(s)', 'neutral');
    return;
  }

  for (const handle of handles) {
    addRow(await mtp.getObjectInfo(handle));
  }
  setStatus(`${handles.length} object(s)`, 'success');
}

connectButton.addEventListener('click', async () => {
  try {
    connectButton.disabled = true;
    setStatus('Connecting…', 'warning');

    const device = await navigator.usb.requestDevice({ filters: [] });
    mtp = new Mtp(null, null, device);
    mtp.addEventListener('error', event => {
      setStatus(
        `MTP error: ${event.error?.message ?? event.message ?? event}`,
        'danger',
      );
    });

    await mtp.ready;
    await mtp.openSession();
    await loadStorages();
    await loadObjects();

    fileInput.disabled = false;
    updateUploadState();
    setStatus(`Connected to ${device.productName || 'the device'}`, 'success');
  } catch (error) {
    await mtp?.close().catch(() => {});
    mtp = null;
    connectButton.disabled = false;
    updateUploadState();
    setStatus(`Connect failed: ${error.message}`, 'danger');
  }
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
  loadObjects().catch(error => setStatus(error.message, 'danger'));
});

uploadButton.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const handle = await mtp.uploadFile({
      storageId: currentStorage(),
      parentObjectHandle: 0xffffffff,
      filename: file.name,
      data,
      format: OBJECT_FORMAT.UNDEFINED,
    });
    setStatus(`Uploaded ${file.name} as handle ${handle}`, 'success');
    fileInput.value = '';
    await loadObjects();
  } catch (error) {
    setStatus(`Upload failed: ${error.message}`, 'danger');
  }
});

window.addEventListener('beforeunload', () => {
  mtp?.close();
});
