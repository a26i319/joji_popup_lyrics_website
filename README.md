# Blah Blah.exe

A static, retro desktop-style popup experience. Load an audio file you are authorized to use, then let original messages appear on OK or at manually configured points in the audio. The demo contains no commercial recording or reproduced song lyrics.

## Files

```text
project-root/
├── index.html
├── README.md
├── css/
│   └── main.css
├── js/
│   ├── app.js
│   └── message-engine.mjs
└── tests/
  └── message-engine.test.mjs
```

- `index.html` is the static entry point used by local servers and deployment platforms.
- `css/main.css` contains the Windows-inspired theme and responsive layout.
- `js/app.js` manages audio, rendering, and the message/LRC editor.
- `js/message-engine.mjs` validates messages, parses LRC files, and schedules cues from audio time.
- `tests/message-engine.test.mjs` tests parsing, offsets, scheduler behavior, and validation with Node's built-in test runner.

## Run locally

Run commands from the project root. This is a no-build static site. Serve the project root over HTTP so browser ES modules work:

```powershell
py -m http.server 8000
```

Then open `http://localhost:8000` in a browser. If `py` is not available, use `python -m http.server 8000`. The browser's file picker reads audio locally; the selected file is not uploaded or persisted.

Choose a supported audio file, optionally choose an `.lrc` lyrics file, wait for the ready status, and press **Start with audio**. Browsers require this user gesture before playback. Or choose **Try popup demo without audio** to try the built-in click-through messages. Play/pause, restart, seek, lyric mode, timing offset, and volume controls appear after starting. The volume slider may be unavailable or ignored by iOS Safari, where device volume controls are used.

## LRC Lyrics

Choose a local UTF-8 `.lrc` plain-text file. Parsing is in the browser and does not need a network connection. The LRC file is optional; without one, the built-in popup sequence remains available. An LRC with no valid timestamped lyric lines is rejected with a visible error. Malformed individual lines are skipped with a warning while valid lines load.

Supported timestamp examples are `[00:05.20]` and `[01:23.450]`. Fractional seconds may contain one to three digits. A line may have more than one timestamp; each timestamp creates a separate cue with the same lyric text. Metadata tags `[ar:]`, `[ti:]`, `[al:]`, `[by:]`, and signed millisecond `[offset:]` are recognized. Text following the timestamp tags is preserved as UTF-8 Unicode.

```lrc
[ar:Example Artist]
[ti:Example Track]
[al:Example Album]
[by:Editor]
[offset:+120]
[00:05.20]A quiet original placeholder line
[00:08.00][00:10.00]This line has two timestamps
[01:23.450]Café and Olá
```

The player has three modes: **Automatic** shows every lyric when playback crosses its timestamp; **Click through** puts every line in an OK-driven sequence independent of timestamps; **Mixed** shows every line at its timestamp, with checked lines waiting for OK before the next due line. Unchecked lines use the same timed popup behavior. Open **Edit messages** to mark mixed-mode lines. Each cue has a stable ID based on its source line and timestamp position. The mixed selection can be exported/imported as JSON such as `{"clickIds":["lrc-4-1"]}`; unknown IDs in an imported selection are ignored.

The **Offset (ms)** control is an additional adjustment applied on top of the LRC `[offset:]` value. Positive values move cues later; negative values move them earlier; adjusted timestamps are clamped at zero. Changing the offset reparses the original file.

Playback time is always read from `audio.currentTime`; there is no independent lyric timer. Seeking forward queues every automatic cue crossed. Equal timestamps keep their source order. Seeking backward discards pending automatic cues at or after the destination and rearms those cues, including one exactly at the destination. An automatic popup already visible is dismissed on seek; click-queued lines remain in their OK sequence. Restart returns to zero and resets both queues. At track end, pending automatic cues and click lines are offered before the end message.

## Message editor

Open **Edit messages** to add, edit, delete, and reorder entries. Changes are validated and applied immediately; applying edits resets the popup sequence at the current playhead. Use **Import / export JSON** to copy out or replace the sequence. Imported data may be either an array or an object with a `messages` array. Message text is inserted as text, never interpreted as HTML.

Each entry has this shape:

```json
{
  "id": "quiet-note",
  "text": "Some quiet is its own kind of answer.",
  "title": "A small thought",
  "icon": "...",
  "triggerType": "auto",
  "timestamp": 12.5,
  "placement": "upper-right"
}
```

`id` must be unique and non-empty. `text` must contain non-whitespace content. `title` and `icon` are optional; `triggerType` is `click` or `auto`; and `placement` is `center`, `upper-left`, `upper-right`, `lower-left`, or `lower-right`. Automatic entries need a finite, non-negative `timestamp`, measured in seconds. Click entries do not need a timestamp.

Example sequence:

```json
[
  {
    "id": "first-note",
    "text": "You do not have to say anything.",
    "title": "Blah Blah.exe",
    "icon": "i",
    "triggerType": "click",
    "placement": "center"
  },
  {
    "id": "at-twelve",
    "text": "The room got quiet.",
    "title": "A small thought",
    "icon": "...",
    "triggerType": "auto",
    "timestamp": 12.5,
    "placement": "upper-right"
  }
]
```

Click messages begin when playback/demo starts, then advance when the current popup is dismissed with **OK** or the close button. Automatic messages trigger when the audio playhead crosses their timestamp. If several are crossed together (including by seeking forward), they are queued in timestamp order; equal timestamps keep their order in the sequence. A queued automatic message is shown after the current popup is dismissed and before the next click message. A visible popup is never replaced by a new automatic one.

Pausing does not change scheduling state. Seeking backward rearms automatic messages at or after the new position, including a message exactly at the destination; they can appear again when crossed. Restart returns to zero and resets the entire sequence. At track end, pending automatic messages are shown before the end-of-track message. Closing a popup has the same effect as pressing **OK**.

## Audio and privacy

Provide audio you own or are otherwise authorized to use. This project does not include or download Joji's commercial recording, fetch lyrics, upload the selected file, or make analytics requests. The browser keeps the selected file in a temporary object URL, which is revoked when a new file is selected or the page is unloaded. Reloading does not save the audio or message sequence.

Supported formats vary by browser and device. Safari on iPhone has native codec and volume limitations; select a format supported by that browser. Playback begins only after a user action because browsers restrict autoplay.

## Tests

With Node.js installed, run from this folder:

```powershell
node --test tests/message-engine.test.mjs
```

The tests cover LRC timestamp/metadata parsing, multiple and repeated timestamps, offset adjustment, malformed and empty content, Unicode text, forward/backward seeking, restart, all lyric modes, and message validation. For a manual browser check, load a supported local audio and LRC file, exercise all three modes, pause/resume, restart, seek both directions across multiple/equal timestamps, adjust the offset, mark and export/import mixed click IDs, and try invalid/empty files. Resize the browser to a narrow phone viewport and check that the dialogs and player remain usable.

## Deploy

**GitHub Pages:** push this folder to a repository, then choose the branch and folder containing `index.html` in the repository's Pages settings. No build command is required.

**Vercel:** import the repository and deploy it as a static site. Leave the build command empty and set the output directory to the folder containing `index.html` (the repository root if this folder is the root).
