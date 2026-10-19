import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceLyricScheduler,
  advanceScheduler,
  applyLyricMode,
  createLyricScheduler,
  createScheduler,
  parseLrc,
  takeNextAutomatic,
  takeNextClick,
  takeNextLyric,
  validateMessages
} from '../js/message-engine.mjs';

const sequence = [
  { id: 'click-a', text: 'first', triggerType: 'click' },
  { id: 'auto-a', text: 'at three', triggerType: 'auto', timestamp: 3 },
  { id: 'auto-b', text: 'also at three', triggerType: 'auto', timestamp: 3 },
  { id: 'click-b', text: 'second', triggerType: 'click' },
  { id: 'auto-c', text: 'at eight', triggerType: 'auto', timestamp: 8 }
];

test('automatic messages fire once in timestamp order, keeping input order for ties', () => {
  const scheduler = createScheduler(sequence);
  assert.deepEqual(advanceScheduler(scheduler, 3), [sequence[1], sequence[2]]);
  assert.deepEqual(advanceScheduler(scheduler, 4), []);
  assert.equal(takeNextAutomatic(scheduler), sequence[1]);
  assert.equal(takeNextAutomatic(scheduler), sequence[2]);
});

test('forward seek fires every crossed automatic message', () => {
  const scheduler = createScheduler(sequence);
  advanceScheduler(scheduler, 2);
  assert.deepEqual(advanceScheduler(scheduler, 9), [sequence[1], sequence[2], sequence[4]]);
});

test('backward seek allows timestamps at and after the new position to fire again', () => {
  const scheduler = createScheduler(sequence);
  advanceScheduler(scheduler, 9);
  assert.deepEqual(advanceScheduler(scheduler, 3), [sequence[1], sequence[2]]);
  assert.deepEqual(advanceScheduler(scheduler, 9), [sequence[4]]);
});

test('resetting the scheduler restarts click order and automatic state', () => {
  let scheduler = createScheduler(sequence);
  assert.equal(takeNextClick(scheduler), sequence[0]);
  advanceScheduler(scheduler, 9);
  scheduler = createScheduler(sequence);
  assert.equal(takeNextClick(scheduler), sequence[0]);
  assert.deepEqual(advanceScheduler(scheduler, 9), [sequence[1], sequence[2], sequence[4]]);
});

test('validation catches blank text, duplicate ids, and invalid timestamps', () => {
  const result = validateMessages([
    { id: 'same', text: 'ok', triggerType: 'click' },
    { id: 'same', text: ' ', triggerType: 'auto', timestamp: -1 }
  ]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /duplicate id/);
  assert.match(result.errors.join(' '), /message text/);
  assert.match(result.errors.join(' '), /timestamp/);
});

test('validation accepts an empty timestamp of zero and rejects malformed input', () => {
  const valid = validateMessages([{ id: 'zero', text: 'at start', triggerType: 'auto', timestamp: 0 }]);
  assert.equal(valid.valid, true);
  assert.equal(valid.messages[0].timestamp, 0);
  assert.equal(validateMessages('{not json').valid, false);
});

test('LRC parser reads standard timestamps, metadata, and multiple timestamps per line', () => {
  const result = parseLrc('[ar:Joji]\n[ti:Blah Blah]\n[al:Album]\n[by:Editor]\n[01:23.450][00:05.20]hello');
  assert.deepEqual(result.metadata, { ar: 'Joji', ti: 'Blah Blah', al: 'Album', by: 'Editor' });
  assert.deepEqual(result.entries.map(entry => entry.timestamp), [5.2, 83.45]);
  assert.deepEqual(result.entries.map(entry => entry.text), ['hello', 'hello']);
  assert.notEqual(result.entries[0].id, result.entries[1].id);
});

test('LRC offset metadata and user adjustment combine in milliseconds and clamp at zero', () => {
  const result = parseLrc('[offset:+150]\n[00:05.20]later\n[00:00.10]early', { offsetMs: -50 });
  assert.deepEqual(result.entries.map(entry => entry.timestamp), [0.2, 5.3]);
  assert.equal(result.metadata.offset, 150);
});

test('LRC parser skips offsets and adjusted timestamps outside the finite numeric range', () => {
  const hugeOffset = `17${'0'.repeat(307)}`;
  const result = parseLrc(`[offset:${hugeOffset}]\n[00:01.00]too far`, { offsetMs: 1e308 });
  assert.deepEqual(result.entries, []);
  assert.equal(result.warnings.length, 1);
});

test('LRC parser preserves UTF-8 lyric text and warns about malformed or empty timestamp lines', () => {
  const result = parseLrc('[00:01.25]Café and Olá\n[00:65.2]bad\n[00:02.00]\n[00:xx]invalid');
  assert.equal(result.entries[0].text, 'Café and Olá');
  assert.equal(result.entries.length, 1);
  assert.equal(result.warnings.length, 3);
  assert.deepEqual(parseLrc('[ar:Unknown]\nno timestamps here').entries, []);
});

test('LRC scheduler orders duplicate timestamps, catches forward seeks, and rearms after backward seek', () => {
  const entries = parseLrc('[00:03.00]first\n[00:03.00]second\n[00:08.00]last').entries;
  const scheduler = createLyricScheduler(entries);
  assert.deepEqual(advanceLyricScheduler(scheduler, 3), entries.slice(0, 2));
  assert.deepEqual(advanceLyricScheduler(scheduler, 9), entries.slice(2));
  assert.deepEqual(advanceLyricScheduler(scheduler, 3), entries.slice(0, 2));
  assert.equal(takeNextLyric(scheduler), entries[0]);
});

test('LRC scheduler starts at zero and a fresh scheduler supports restart', () => {
  const entries = parseLrc('[00:00.00]start\n[00:01.00]next').entries;
  let scheduler = createLyricScheduler(entries);
  assert.deepEqual(advanceLyricScheduler(scheduler, 0), [entries[0]]);
  advanceLyricScheduler(scheduler, 2);
  scheduler = createLyricScheduler(entries);
  assert.deepEqual(advanceLyricScheduler(scheduler, 0), [entries[0]]);
});

test('lyric mode applies click selection by stable ID and defaults other mixed lines to automatic', () => {
  const entries = parseLrc('[00:01.00]one\n[00:02.00]two').entries;
  const mixed = applyLyricMode(entries, 'mixed', [entries[1].id]);
  assert.deepEqual(mixed.map(entry => entry.triggerType), ['auto', 'click']);
  assert.deepEqual(applyLyricMode(entries, 'automatic').map(entry => entry.triggerType), ['auto', 'auto']);
  assert.deepEqual(applyLyricMode(entries, 'click').map(entry => entry.triggerType), ['click', 'click']);
});
