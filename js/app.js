import {
  DEMO_MESSAGES,
  advanceLyricScheduler,
  advanceScheduler,
  applyLyricMode,
  createScheduler,
  createLyricScheduler,
  parseLrc,
  takeNextLyric,
  takeNextAutomatic,
  takeNextClick,
  validateMessages
} from './message-engine.mjs';

const $ = id => document.getElementById(id);
const audio = $('audio');
const welcome = $('welcome');
const popup = $('popup');
const settings = $('settings');
const player = $('player');
const fileInput = $('audioFile');
const lrcInput = $('lrcFile');
const fileName = $('fileName');
const audioStatus = $('audioStatus');
const playerStatus = $('playerStatus');
const progress = $('seekBar');
const timeLabel = $('timeLabel');
const toast = $('toast');
const messageList = $('messageList');
const lyricList = $('lyricList');
const formError = $('formError');
const jsonFeedback = $('jsonFeedback');

let messages = DEMO_MESSAGES.map(message => ({ ...message }));
let scheduler = createScheduler(messages);
let lrcSource = null;
let lrcEntries = [];
let lyricMetadata = {};
let lyricClickIds = new Set();
let lyricScheduler = createLyricScheduler([]);
let lyricClickQueue = [];
let lyricClickIndex = 0;
let lyricEndPending = false;
let objectUrl = null;
let activeMessage = null;
let activeMode = 'idle';
let editingId = null;
let endedMessagePending = false;
let toastTimer = null;
let returnFocus = null;

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function setPopup(message) {
  activeMessage = message;
  $('popupTitle').textContent = message.title || 'Blah Blah.exe';
  $('messageIcon').textContent = message.icon || 'i';
  $('message').textContent = message.text;
  popup.dataset.placement = message.placement || 'center';
  popup.classList.remove('hidden');
}

function presentNextMessage() {
  if (activeMode === 'audio' && lrcEntries.length) {
    presentNextLyric();
    return;
  }
  if (activeMessage || !settings.classList.contains('hidden')) return;
  const automatic = takeNextAutomatic(scheduler);
  if (automatic) {
    setPopup(automatic);
    return;
  }
  if (endedMessagePending) {
    endedMessagePending = false;
    setPopup({ title: 'Blah Blah.exe', icon: 'OK', text: 'End of track. Thanks for listening.', placement: 'center' });
    return;
  }
  if (activeMode !== 'idle') {
    const manual = takeNextClick(scheduler);
    if (manual) setPopup(manual);
    else showToast('There are no more messages in this sequence.');
  }
}

function presentNextLyric() {
  if (activeMessage || !settings.classList.contains('hidden')) return;
  if ($('lyricMode').value === 'click' && lyricClickIndex < lyricClickQueue.length) {
    setPopup(lyricClickQueue[lyricClickIndex++]);
    return;
  }
  const dueLyric = takeNextLyric(lyricScheduler);
  if (dueLyric) {
    setPopup(dueLyric);
    return;
  }
  if (lyricEndPending) {
    lyricEndPending = false;
    setPopup({ title: 'Blah Blah.exe', icon: 'OK', text: 'End of track. Thanks for listening.', placement: 'center' });
  }
}

function applyLyricsAtPlayhead({ present = false, includeCurrent = false } = {}) {
  const mode = $('lyricMode').value;
  const adjustedEntries = applyLyricMode(lrcEntries, mode, [...lyricClickIds]);
  lyricScheduler = createLyricScheduler(mode === 'click' ? [] : adjustedEntries);
  const currentTime = activeMode === 'audio' && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const tolerance = Math.max(Number.EPSILON, Math.abs(currentTime) * Number.EPSILON * 2);
  lyricClickQueue = mode === 'click' ? adjustedEntries : [];
  lyricClickIndex = 0;
  lyricEndPending = false;
  if (activeMessage?.id?.startsWith('lrc-')) {
    activeMessage = null;
    popup.classList.add('hidden');
  }
  if (activeMode === 'audio' && mode !== 'click') {
    lyricScheduler.lastTime = includeCurrent ? currentTime - tolerance : currentTime;
    if (includeCurrent) advanceLyricScheduler(lyricScheduler, currentTime);
  }
  if (present) presentNextLyric();
}

function refreshLrcDisplay() {
  const metadataTitle = lyricMetadata.ti ? ` · ${lyricMetadata.ti}` : '';
  $('lyricPlayerStatus').textContent = lrcEntries.length
    ? `${lrcEntries.length} LRC lines loaded${metadataTitle}. Mode: ${$('lyricMode').selectedOptions[0].textContent}.`
    : 'No LRC loaded. The built-in popup sequence is active.';
  $('lyricEditor').classList.toggle('hidden', lrcEntries.length === 0);
  $('lyricCount').textContent = lrcEntries.length ? `${lrcEntries.length} lines` : 'No LRC loaded';
  renderLyricLines();
}

function renderLyricLines() {
  lyricList.replaceChildren();
  lrcEntries.forEach(entry => {
    const row = document.createElement('li');
    row.className = 'message-row lyric-row';
    const label = document.createElement('label');
    label.className = 'lyric-choice';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = lyricClickIds.has(entry.id);
    checkbox.dataset.lyricId = entry.id;
    checkbox.setAttribute('aria-label', `Make line at ${formatTime(entry.timestamp)} click to continue`);
    const text = document.createElement('span');
    text.textContent = entry.text;
    const meta = document.createElement('small');
    meta.textContent = `${formatTime(entry.timestamp)} · ${entry.id}`;
    label.append(checkbox, text);
    row.append(label, meta);
    lyricList.append(row);
  });
}

function loadLrcText(source, filename) {
  const adjustment = Number($('offsetInput').value);
  if (!Number.isFinite(adjustment)) throw new TypeError('Timing offset must be a finite number of milliseconds.');
  const parsed = parseLrc(source, { offsetMs: adjustment });
  if (!parsed.entries.length) throw new Error('No valid timestamped lyric lines were found in this LRC file.');
  lrcSource = source;
  lrcEntries = parsed.entries;
  lyricMetadata = parsed.metadata;
  const availableIds = new Set(lrcEntries.map(entry => entry.id));
  lyricClickIds = new Set([...lyricClickIds].filter(id => availableIds.has(id)));
  $('lrcFileName').textContent = filename;
  $('clearLrc').classList.remove('hidden');
  const warningText = parsed.warnings.length ? ` ${parsed.warnings.length} line warning(s); valid lines were loaded.` : '';
  $('lrcStatus').textContent = `${lrcEntries.length} lyric lines loaded.${warningText}`;
  $('lrcStatus').classList.toggle('is-error', parsed.warnings.length > 0);
  refreshLrcDisplay();
  if (activeMode === 'audio') applyLyricsAtPlayhead({ present: true });
}

function applyLyricOffset() {
  if (!lrcSource) return;
  try {
    loadLrcText(lrcSource, $('lrcFileName').textContent);
    $('lrcStatus').classList.remove('is-error');
    $('lrcStatus').textContent = `${lrcEntries.length} lyric lines loaded with ${$('offsetInput').value} ms user adjustment.`;
  } catch (error) {
    $('lrcStatus').textContent = error.message;
    $('lrcStatus').classList.add('is-error');
  }
}

function dismissPopup() {
  activeMessage = null;
  popup.classList.add('hidden');
  presentNextMessage();
}

function resetRun(showFirstMessage = false) {
  scheduler = createScheduler(messages);
  endedMessagePending = false;
  activeMessage = null;
  popup.classList.add('hidden');
  if (activeMode === 'audio' && lrcEntries.length) applyLyricsAtPlayhead({ includeCurrent: true });
  if (showFirstMessage) presentNextMessage();
}

function resetMessageStateAtPlayhead() {
  scheduler = createScheduler(messages);
  if (activeMode === 'audio') {
    const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const tolerance = Math.max(Number.EPSILON, Math.abs(currentTime) * Number.EPSILON * 2);
    scheduler.lastTime = currentTime - tolerance;
  }
  endedMessagePending = false;
  activeMessage = null;
  popup.classList.add('hidden');
}

function updateTimeDisplay() {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  progress.max = String(duration);
  progress.value = String(currentTime);
  progress.style.setProperty('--range-progress', duration ? `${(currentTime / duration) * 100}%` : '0%');
}

function updatePlaybackButton() {
  const playing = !audio.paused && !audio.ended;
  $('playPause').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  $('playPause').setAttribute('aria-label', playing ? 'Pause audio' : 'Play audio');
}

function updateAudioStatus(text, isError = false) {
  audioStatus.textContent = text;
  audioStatus.classList.toggle('is-error', isError);
}

function startDemo() {
  activeMode = 'demo';
  welcome.classList.add('hidden');
  player.classList.remove('hidden');
  $('trackName').textContent = 'Popup sequence demo';
  playerStatus.textContent = 'Demo mode: audio timestamps wait for an audio file.';
  $('playPause').disabled = true;
  $('restartBtn').disabled = true;
  $('volumeBar').disabled = true;
  progress.disabled = true;
  updateTimeDisplay();
  resetRun(true);
}

async function startWithAudio() {
  if (!audio.src || !objectUrl) {
    updateAudioStatus('Choose an audio file first, or try the popup demo without audio.', true);
    return;
  }
  if (lrcInput.files?.length && !lrcEntries.length) {
    $('lrcStatus').textContent = 'The selected LRC file has no valid timestamped lines. Choose another file or remove it.';
    $('lrcStatus').classList.add('is-error');
    return;
  }
  try {
    await audio.play();
    activeMode = 'audio';
    welcome.classList.add('hidden');
    player.classList.remove('hidden');
    $('playPause').disabled = false;
    $('restartBtn').disabled = false;
    $('volumeBar').disabled = false;
    progress.disabled = false;
    playerStatus.textContent = 'Playing. Automatic messages follow the audio playhead.';
    resetRun(true);
    updatePlaybackButton();
  } catch (error) {
    updateAudioStatus('Playback did not start. Tap Start again, or check that this audio file is supported.', true);
    playerStatus.textContent = error?.message || 'Playback was blocked or the file could not be decoded.';
  }
}

function acceptsAudioFile(file) {
  const knownAudioExtension = /\.(aac|aif|aiff|caf|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/i.test(file.name);
  return file.type.startsWith('audio/') || knownAudioExtension;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!acceptsAudioFile(file)) {
    fileInput.value = '';
    updateAudioStatus('That file does not look like a supported audio file. Choose an audio file or try the demo.', true);
    fileName.textContent = 'No audio selected';
    return;
  }

  audio.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.load();
  fileName.textContent = file.name;
  $('trackName').textContent = file.name;
  updateAudioStatus('Loading audio metadata…');
  playerStatus.textContent = 'Audio selected. Press Start to begin playback.';
  $('startBtn').disabled = false;
});

lrcInput.addEventListener('change', async () => {
  const file = lrcInput.files?.[0];
  if (!file) return;
  if (!/\.lrc$/i.test(file.name) && file.type !== 'text/plain') {
    lrcInput.value = '';
    $('lrcStatus').textContent = 'Choose an .lrc or UTF-8 plain-text file.';
    $('lrcStatus').classList.add('is-error');
    return;
  }
  try {
    loadLrcText(await file.text(), file.name);
    $('lyricConfigFeedback').textContent = '';
  } catch (error) {
    lrcSource = null;
    lrcEntries = [];
    lyricMetadata = {};
    lyricClickIds.clear();
    lyricScheduler = createLyricScheduler([]);
    lyricClickQueue = [];
    lyricClickIndex = 0;
    lyricEndPending = false;
    if (activeMessage?.id?.startsWith('lrc-')) {
      activeMessage = null;
      popup.classList.add('hidden');
    }
    $('lrcFileName').textContent = file.name;
    $('clearLrc').classList.remove('hidden');
    $('lrcStatus').textContent = error.message || 'Could not read this LRC file.';
    $('lrcStatus').classList.add('is-error');
    refreshLrcDisplay();
  }
});

$('clearLrc').addEventListener('click', () => {
  lrcInput.value = '';
  lrcSource = null;
  lrcEntries = [];
  lyricMetadata = {};
  lyricClickIds.clear();
  lyricScheduler = createLyricScheduler([]);
  lyricClickQueue = [];
  lyricClickIndex = 0;
  lyricEndPending = false;
  if (activeMessage?.id?.startsWith('lrc-')) {
    activeMessage = null;
    popup.classList.add('hidden');
  }
  $('lrcFileName').textContent = 'No LRC selected';
  $('lrcStatus').textContent = 'Lyrics cleared. The built-in popup sequence will be used.';
  $('lrcStatus').classList.remove('is-error');
  $('clearLrc').classList.add('hidden');
  refreshLrcDisplay();
});

$('offsetInput').addEventListener('change', applyLyricOffset);
$('lyricMode').addEventListener('change', () => {
  refreshLrcDisplay();
  if (activeMode === 'audio' && lrcEntries.length) applyLyricsAtPlayhead({ present: true });
});
$('lyricList').addEventListener('change', event => {
  const checkbox = event.target.closest('input[data-lyric-id]');
  if (!checkbox) return;
  if (checkbox.checked) lyricClickIds.add(checkbox.dataset.lyricId);
  else lyricClickIds.delete(checkbox.dataset.lyricId);
  $('lyricConfigFeedback').textContent = 'Mixed-mode selection updated.';
  if (activeMode === 'audio' && $('lyricMode').value === 'mixed') applyLyricsAtPlayhead({ present: true });
});

$('exportLyricConfig').addEventListener('click', () => {
  $('lyricConfig').value = JSON.stringify({ clickIds: [...lyricClickIds] }, null, 2);
  $('lyricConfigFeedback').textContent = 'Selection exported. Keep this JSON to reuse these stable lyric IDs.';
});
$('importLyricConfig').addEventListener('click', () => {
  let parsed;
  try {
    parsed = JSON.parse($('lyricConfig').value);
  } catch {
    $('lyricConfigFeedback').textContent = 'Invalid JSON. Expected an object with a clickIds array.';
    return;
  }
  if (!parsed || !Array.isArray(parsed.clickIds) || parsed.clickIds.some(id => typeof id !== 'string')) {
    $('lyricConfigFeedback').textContent = 'Expected an object with a clickIds array of strings.';
    return;
  }
  const availableIds = new Set(lrcEntries.map(entry => entry.id));
  lyricClickIds = new Set(parsed.clickIds.filter(id => availableIds.has(id)));
  renderLyricLines();
  $('lyricConfigFeedback').textContent = `${lyricClickIds.size} click line(s) imported${lyricClickIds.size < parsed.clickIds.length ? '; unknown IDs were ignored.' : '.'}`;
  if (activeMode === 'audio' && $('lyricMode').value === 'mixed') applyLyricsAtPlayhead({ present: true });
});

$('startBtn').addEventListener('click', startWithAudio);
$('demoBtn').addEventListener('click', startDemo);
$('closeWelcome').addEventListener('click', () => welcome.classList.add('hidden'));
$('taskStart').addEventListener('click', () => welcome.classList.toggle('hidden'));
$('okBtn').addEventListener('click', dismissPopup);
$('closePopup').addEventListener('click', dismissPopup);

$('playPause').addEventListener('click', async () => {
  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      playerStatus.textContent = 'Playback failed. Try selecting the audio file again.';
      showToast('Could not play this audio file.');
    }
  } else {
    audio.pause();
  }
});

$('restartBtn').addEventListener('click', async () => {
  audio.pause();
  audio.currentTime = 0;
  resetRun(true);
  try {
    await audio.play();
  } catch {
    playerStatus.textContent = 'Ready at the beginning. Press Play to resume.';
  }
});

progress.addEventListener('input', () => {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Number(progress.value);
  updateTimeDisplay();
});
$('volumeBar').addEventListener('input', event => { audio.volume = Number(event.currentTarget.value); });

audio.addEventListener('loadedmetadata', () => {
  updateTimeDisplay();
  updateAudioStatus(`Ready: ${fileName.textContent} (${formatTime(audio.duration)}). Press Start to play.`);
  playerStatus.textContent = 'Audio ready. Press Start to begin playback.';
});
audio.addEventListener('durationchange', updateTimeDisplay);
audio.addEventListener('timeupdate', () => {
  updateTimeDisplay();
  if (activeMode === 'audio') {
    if (lrcEntries.length) {
      const crossedLyrics = advanceLyricScheduler(lyricScheduler, audio.currentTime);
      if (crossedLyrics.length) presentNextLyric();
    } else {
      const crossedMessages = advanceScheduler(scheduler, audio.currentTime);
      if (crossedMessages.length) presentNextMessage();
    }
  }
});
audio.addEventListener('seeking', () => {
  if (activeMessage?.triggerType === 'auto' && lrcEntries.some(entry => entry.id === activeMessage.id)) {
    activeMessage = null;
    popup.classList.add('hidden');
  }
});
audio.addEventListener('seeked', () => {
  if (activeMode !== 'audio' || !lrcEntries.length) return;
  const crossedLyrics = advanceLyricScheduler(lyricScheduler, audio.currentTime);
  if (crossedLyrics.length) presentNextLyric();
});
audio.addEventListener('play', () => {
  updatePlaybackButton();
  if (activeMode === 'audio') playerStatus.textContent = 'Playing. Automatic messages follow the audio playhead.';
});
audio.addEventListener('pause', () => {
  updatePlaybackButton();
  if (activeMode === 'audio' && !audio.ended) playerStatus.textContent = 'Paused.';
});
audio.addEventListener('ended', () => {
  updatePlaybackButton();
  playerStatus.textContent = 'Track ended.';
  if (activeMode === 'audio' && lrcEntries.length) {
    lyricEndPending = true;
    presentNextLyric();
  } else {
    endedMessagePending = true;
    presentNextMessage();
  }
});
audio.addEventListener('error', () => {
  if (!audio.src) return;
  updateAudioStatus('The audio could not be loaded or decoded. Try another file format.', true);
  playerStatus.textContent = 'Audio load or decode error.';
  updatePlaybackButton();
});

function clearMessageForm() {
  editingId = null;
  $('messageForm').reset();
  $('messageTitle').value = 'Blah Blah.exe';
  $('messageIconInput').value = 'i';
  $('triggerType').value = 'click';
  $('placementInput').value = 'center';
  $('timestampInput').value = '';
  $('timestampField').classList.add('hidden');
  $('saveMessageBtn').textContent = 'Add message';
  formError.textContent = '';
}

function renderMessages() {
  messageList.replaceChildren();
  $('messageCount').textContent = `${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`;

  messages.forEach((message, index) => {
    const row = document.createElement('li');
    row.className = 'message-row';
    const copy = document.createElement('div');
    copy.className = 'message-row-copy';
    const heading = document.createElement('strong');
    heading.textContent = `${index + 1}. ${message.title}`;
    const body = document.createElement('span');
    body.textContent = message.text;
    const meta = document.createElement('small');
    meta.textContent = message.triggerType === 'auto' ? `Auto · ${message.timestamp}s` : 'Wait for OK';
    copy.append(heading, body, meta);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const up = makeActionButton('↑', `Move message ${index + 1} up`, () => moveMessage(index, -1));
    const down = makeActionButton('↓', `Move message ${index + 1} down`, () => moveMessage(index, 1));
    const edit = makeActionButton('Edit', `Edit message ${index + 1}`, () => editMessage(message.id));
    const remove = makeActionButton('×', `Delete message ${index + 1}`, () => deleteMessage(message.id));
    up.disabled = index === 0;
    down.disabled = index === messages.length - 1;
    actions.append(up, down, edit, remove);
    row.append(copy, actions);
    messageList.append(row);
  });
}

function makeActionButton(text, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'xp-button small-button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', action);
  return button;
}

function moveMessage(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= messages.length) return;
  [messages[index], messages[target]] = [messages[target], messages[index]];
  resetMessageStateAtPlayhead();
  renderMessages();
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
}

function editMessage(id) {
  const message = messages.find(item => item.id === id);
  if (!message) return;
  editingId = id;
  $('messageText').value = message.text;
  $('messageTitle').value = message.title;
  $('messageIconInput').value = message.icon;
  $('triggerType').value = message.triggerType;
  $('timestampInput').value = message.triggerType === 'auto' ? String(message.timestamp) : '';
  $('placementInput').value = message.placement;
  $('timestampField').classList.toggle('hidden', message.triggerType !== 'auto');
  $('saveMessageBtn').textContent = 'Save changes';
  formError.textContent = '';
  $('messageText').focus();
}

function deleteMessage(id) {
  messages = messages.filter(item => item.id !== id);
  resetMessageStateAtPlayhead();
  renderMessages();
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
  if (editingId === id) clearMessageForm();
}

$('triggerType').addEventListener('change', event => {
  $('timestampField').classList.toggle('hidden', event.currentTarget.value !== 'auto');
});
$('clearFormBtn').addEventListener('click', clearMessageForm);
$('messageForm').addEventListener('submit', event => {
  event.preventDefault();
  const rawTimestamp = $('timestampInput').value.trim();
  const id = editingId || (globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  const candidate = {
    id,
    text: $('messageText').value,
    title: $('messageTitle').value,
    icon: $('messageIconInput').value,
    triggerType: $('triggerType').value,
    placement: $('placementInput').value
  };
  if (candidate.triggerType === 'auto') candidate.timestamp = rawTimestamp === '' ? Number.NaN : Number(rawTimestamp);
  const next = editingId
    ? messages.map(message => message.id === editingId ? candidate : message)
    : [...messages, candidate];
  const result = validateMessages(next);
  if (!result.valid) {
    formError.textContent = result.errors.join(' ');
    return;
  }

  messages = result.messages;
  resetMessageStateAtPlayhead();
  renderMessages();
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
  clearMessageForm();
  showToast('Message sequence updated.');
});

function openEditor() {
  returnFocus = document.activeElement;
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
  jsonFeedback.textContent = '';
  renderMessages();
  settings.classList.remove('hidden');
  $('messageText').focus();
}

function closeEditor() {
  settings.classList.add('hidden');
  if (returnFocus instanceof HTMLElement) returnFocus.focus();
  presentNextMessage();
}

$('settingsBtn').addEventListener('click', openEditor);
$('closeSettings').addEventListener('click', closeEditor);
settings.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeEditor();
  }
  if (event.key !== 'Tab') return;
  const focusable = [...settings.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea, select, summary')]
    .filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

$('exportBtn').addEventListener('click', async () => {
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
  try {
    await navigator.clipboard?.writeText($('jsonEditor').value);
    jsonFeedback.textContent = 'JSON exported here and copied to the clipboard.';
  } catch {
    jsonFeedback.textContent = 'JSON exported to the text box. Select and copy it if needed.';
  }
});
$('importBtn').addEventListener('click', () => {
  let parsed;
  try {
    parsed = JSON.parse($('jsonEditor').value);
  } catch {
    jsonFeedback.textContent = 'Invalid JSON. Check commas, quotes, and brackets.';
    return;
  }
  const result = validateMessages(parsed);
  if (!result.valid) {
    jsonFeedback.textContent = result.errors.join(' ');
    return;
  }
  messages = result.messages;
  resetMessageStateAtPlayhead();
  renderMessages();
  clearMessageForm();
  jsonFeedback.textContent = 'Sequence imported.';
  showToast('Message sequence imported.');
});
$('resetBtn').addEventListener('click', () => {
  messages = DEMO_MESSAGES.map(message => ({ ...message }));
  resetMessageStateAtPlayhead();
  clearMessageForm();
  renderMessages();
  $('jsonEditor').value = JSON.stringify(messages, null, 2);
  jsonFeedback.textContent = 'Demo messages restored.';
});

function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
updateClock();
setInterval(updateClock, 60000);
renderMessages();
clearMessageForm();
updateTimeDisplay();
$('startBtn').disabled = true;

window.addEventListener('beforeunload', () => {
  audio.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});
