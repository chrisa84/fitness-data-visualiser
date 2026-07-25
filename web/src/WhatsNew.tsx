import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { APP_VERSION } from '@fitness/shared';
import changelog from '../../CHANGELOG.md?raw';
import { latestChangelogEntry } from './changelog';

/**
 * Release-notes popup. Shows the newest CHANGELOG entry once per version, then
 * stays quiet until the next upgrade — or forever, if the user opts out.
 *
 * Both flags live in localStorage rather than the events DB: this is a
 * per-device display preference, and keeping it client-side means the popup
 * works offline in the installed PWA with no request on boot.
 */

const SEEN_KEY = 'fdv:whatsNewSeenVersion';
const MUTED_KEY = 'fdv:whatsNewMuted';

function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Locked-down webviews can throw; the popup then reappears next launch,
    // which is a better failure than crashing the shell.
  }
}

/** True when the user has switched release notes off entirely. */
export function releaseNotesMuted(): boolean {
  return lsGet(MUTED_KEY) === '1';
}

/** Re-enables the popup and forgets the seen version, so it shows again now. */
export function resetReleaseNotes(): void {
  lsSet(MUTED_KEY, '');
  lsSet(SEEN_KEY, '');
}

export default function WhatsNew() {
  const entry = latestChangelogEntry(changelog);
  // Decided once on mount: dismissing writes to localStorage, and re-reading it
  // on every render would race the closing animation-free unmount.
  const [open, setOpen] = useState(
    () => entry != null && !releaseNotesMuted() && lsGet(SEEN_KEY) !== APP_VERSION,
  );
  const [muteNextTime, setMuteNextTime] = useState(false);

  if (!open || !entry) return null;

  const dismiss = () => {
    lsSet(SEEN_KEY, APP_VERSION);
    if (muteNextTime) lsSet(MUTED_KEY, '1');
    setOpen(false);
  };

  return (
    <div className="modal-backdrop" onClick={dismiss} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="whats-new-title">What's new in v{entry.version}</h2>
        {entry.date && <p className="status">Released {entry.date}</p>}
        <div className="chat-md modal-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
        </div>
        <div className="controls modal-actions">
          <label>
            <input
              type="checkbox"
              checked={muteNextTime}
              onChange={(e) => setMuteNextTime(e.target.checked)}
            />{' '}
            Don't show release notes again
          </label>
          <button onClick={dismiss}>Got it</button>
        </div>
      </div>
    </div>
  );
}
