export const DEMO_MESSAGES = [
  { id: 'hello', text: 'You do not have to say anything.', title: 'Blah Blah.exe', icon: 'i', triggerType: 'click', placement: 'center' },
  { id: 'quiet', text: 'Some quiet is its own kind of answer.', title: 'A small thought', icon: '...', triggerType: 'auto', timestamp: 7, placement: 'upper-left' },
  { id: 'still-here', text: 'The song can keep you company for a while.', title: 'Blah Blah.exe', icon: '♪', triggerType: 'click', placement: 'lower-right' },
  { id: 'little-light', text: 'There is still a little light in the room.', title: 'A small thought', icon: '*', triggerType: 'auto', timestamp: 16, placement: 'upper-right' },
  { id: 'your-turn', text: 'Your turn. Press OK when you are ready.', title: 'Blah Blah.exe', icon: '?', triggerType: 'click', placement: 'center' }
];

const placements = new Set(['center', 'upper-left', 'upper-right', 'lower-left', 'lower-right']);

export function validateMessages(value) {
  const errors = [];
  const messages = Array.isArray(value) ? value : value?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { valid: false, errors: ['Provide a non-empty array of messages.'], messages: [] };
  }

  const ids = new Set();
  const normalized = messages.map((message, index) => {
    const prefix = `Message ${index + 1}`;
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      errors.push(`${prefix} must be an object.`);
      return null;
    }

    const id = typeof message.id === 'string' ? message.id.trim() : '';
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    const title = typeof message.title === 'string' && message.title.trim() ? message.title.trim() : 'Blah Blah.exe';
    const icon = typeof message.icon === 'string' ? message.icon.trim().slice(0, 8) : 'i';
    const triggerType = message.triggerType;
    const placement = message.placement ?? 'center';

    if (!id) errors.push(`${prefix} needs a non-empty id.`);
    else if (ids.has(id)) errors.push(`${prefix} has duplicate id "${id}".`);
    else ids.add(id);
    if (!text) errors.push(`${prefix} needs message text.`);
    if (triggerType !== 'click' && triggerType !== 'auto') errors.push(`${prefix} triggerType must be "click" or "auto".`);
    if (!placements.has(placement)) errors.push(`${prefix} has an unsupported placement.`);

    const result = { id, text, title, icon: icon || 'i', triggerType, placement };
    if (triggerType === 'auto') {
      const timestamp = Number(message.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < 0) errors.push(`${prefix} needs a timestamp of 0 seconds or more.`);
      else result.timestamp = timestamp;
    }
    return result;
  });

  return { valid: errors.length === 0, errors, messages: normalized.filter(Boolean) };
}

export function createScheduler(messages) {
  return {
    messages,
    clickIndex: 0,
    lastTime: -Number.EPSILON,
    firedAutoIds: new Set(),
    pendingAutos: []
  };
}

export function advanceScheduler(scheduler, currentTime) {
  if (!Number.isFinite(currentTime) || currentTime < 0) return [];

  if (currentTime < scheduler.lastTime) {
    scheduler.firedAutoIds = new Set([...scheduler.firedAutoIds].filter(id => {
      const message = scheduler.messages.find(item => item.id === id);
      return message && message.timestamp < currentTime;
    }));
    scheduler.pendingAutos = scheduler.pendingAutos.filter(message => message.timestamp < currentTime);
    const seekTolerance = Math.max(Number.EPSILON, Math.abs(currentTime) * Number.EPSILON * 2);
    scheduler.lastTime = currentTime - seekTolerance;
  }

  const crossed = scheduler.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.triggerType === 'auto'
      && !scheduler.firedAutoIds.has(message.id)
      && message.timestamp > scheduler.lastTime
      && message.timestamp <= currentTime)
    .sort((a, b) => a.message.timestamp - b.message.timestamp || a.index - b.index)
    .map(({ message }) => message);

  for (const message of crossed) {
    scheduler.firedAutoIds.add(message.id);
    scheduler.pendingAutos.push(message);
  }
  scheduler.lastTime = currentTime;
  return crossed;
}

export function takeNextAutomatic(scheduler) {
  return scheduler.pendingAutos.shift() ?? null;
}

export function takeNextClick(scheduler) {
  while (scheduler.clickIndex < scheduler.messages.length) {
    const message = scheduler.messages[scheduler.clickIndex++];
    if (message.triggerType === 'click') return message;
  }
  return null;
}

export function parseLrc(source, { offsetMs = 0 } = {}) {
  if (typeof source !== 'string') throw new TypeError('LRC content must be text.');
  if (!Number.isFinite(Number(offsetMs))) throw new TypeError('Timing adjustment must be a finite number of milliseconds.');

  const metadata = {};
  const warnings = [];
  const entries = [];
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  let fileOffsetMs = 0;

  lines.forEach((rawLine, lineIndex) => {
    const tags = [...rawLine.matchAll(/\[([^\]]*)\]/g)];
    const timestamps = [];
    for (const tag of tags) {
      const value = tag[1].trim();
      const meta = value.match(/^(ar|ti|al|by|offset)\s*:\s*(.*)$/i);
      if (meta) {
        const key = meta[1].toLowerCase();
        const content = meta[2].trim();
        if (key === 'offset') {
          if (/^[+-]?\d+$/.test(content)) {
            const parsedOffset = Number(content);
            if (Number.isFinite(parsedOffset)) {
              fileOffsetMs = parsedOffset;
              metadata.offset = fileOffsetMs;
            } else {
              warnings.push(`Line ${lineIndex + 1}: invalid offset metadata.`);
            }
          } else {
            warnings.push(`Line ${lineIndex + 1}: invalid offset metadata.`);
          }
        } else {
          metadata[key] = content;
        }
        continue;
      }

      const time = value.match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/);
      if (time) {
        const minutes = Number(time[1]);
        const seconds = Number(time[2]);
        const fractionMs = time[3] ? Number(time[3].padEnd(3, '0')) : 0;
        const timestamp = minutes * 60 + seconds + fractionMs / 1000;
        if (Number.isFinite(timestamp)) timestamps.push(timestamp);
        else warnings.push(`Line ${lineIndex + 1}: timestamp is out of range.`);
      } else if (/^\d+:/.test(value)) {
        warnings.push(`Line ${lineIndex + 1}: malformed timestamp [${value}].`);
      }
    }

    if (!timestamps.length) return;
    const text = rawLine.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) {
      warnings.push(`Line ${lineIndex + 1}: timestamp has no lyric text.`);
      return;
    }

    timestamps.forEach((timestamp, timestampIndex) => {
      const adjusted = timestamp + (fileOffsetMs + Number(offsetMs)) / 1000;
      if (!Number.isFinite(adjusted)) {
        warnings.push(`Line ${lineIndex + 1}: adjusted timestamp is out of range.`);
        return;
      }
      entries.push({
        id: `lrc-${lineIndex + 1}-${timestampIndex + 1}`,
        text,
        timestamp: Math.max(0, adjusted),
        lineNumber: lineIndex + 1,
        timestampIndex: timestampIndex + 1,
        triggerType: 'auto'
      });
    });
  });

  entries.sort((a, b) => a.timestamp - b.timestamp || a.lineNumber - b.lineNumber || a.timestampIndex - b.timestampIndex);
  return { metadata, entries, warnings };
}

export function applyLyricMode(entries, mode, clickIds = []) {
  if (!['automatic', 'click', 'mixed'].includes(mode)) throw new TypeError('Unknown lyric popup mode.');
  const selected = new Set(clickIds);
  return entries.map(entry => ({
    ...entry,
    triggerType: mode === 'click' || (mode === 'mixed' && selected.has(entry.id)) ? 'click' : 'auto'
  }));
}

export function createLyricScheduler(entries) {
  return {
    entries,
    lastTime: -Number.EPSILON,
    firedIds: new Set(),
    pending: []
  };
}

export function advanceLyricScheduler(scheduler, currentTime) {
  if (!Number.isFinite(currentTime) || currentTime < 0) return [];

  if (currentTime < scheduler.lastTime) {
    scheduler.firedIds = new Set([...scheduler.firedIds].filter(id => {
      const entry = scheduler.entries.find(item => item.id === id);
      return entry && entry.timestamp < currentTime;
    }));
    scheduler.pending = scheduler.pending.filter(entry => entry.timestamp < currentTime);
    const tolerance = Math.max(Number.EPSILON, Math.abs(currentTime) * Number.EPSILON * 2);
    scheduler.lastTime = currentTime - tolerance;
  }

  const crossed = scheduler.entries.filter(entry => !scheduler.firedIds.has(entry.id)
    && entry.timestamp > scheduler.lastTime
    && entry.timestamp <= currentTime);
  for (const entry of crossed) {
    scheduler.firedIds.add(entry.id);
    scheduler.pending.push(entry);
  }
  scheduler.lastTime = currentTime;
  return crossed;
}

export function peekNextLyric(scheduler) {
  return scheduler.pending[0] ?? null;
}

export function takeNextLyric(scheduler) {
  return scheduler.pending.shift() ?? null;
}
