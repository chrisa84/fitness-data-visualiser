import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the service worker, checks for new builds, and offers the update
 * as a dismissible toast rather than applying it mid-session.
 *
 * The problem this solves: an installed PWA is normally *resumed* from a frozen
 * state rather than reloaded, so it never re-fetches `sw.js`, never notices a
 * new build, and keeps serving the shell it was installed with — indefinitely,
 * until the user happens to force-quit it. `registerType` alone does not fix
 * that: it only decides what happens once an update has been *detected*.
 *
 * So we check on three triggers: at registration, on an interval, and whenever
 * the app comes back to the foreground (the one that actually matters on a
 * phone).
 */

/** How often to look for a new build while the app stays open. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = async () => {
        // Mid-install, or offline: nothing useful to do, and `update()` on a
        // dead connection just logs a failure.
        if (registration.installing) return;
        if ('onLine' in navigator && !navigator.onLine) return;
        try {
          // Fetch the worker ourselves first, bypassing every cache. If the
          // server is unreachable (VPS down, auth expired and redirecting),
          // registration.update() would otherwise churn pointlessly.
          const res = await fetch(swUrl, {
            cache: 'no-store',
            headers: { 'cache-control': 'no-cache' },
          });
          if (res.status === 200) await registration.update();
        } catch {
          // Offline or unreachable — try again on the next trigger.
        }
      };

      void checkForUpdate();
      setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

      // The important one on mobile: returning to the app is the moment a
      // stale shell becomes visible, and an interval in a frozen tab has not
      // been running.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void checkForUpdate();
      });
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="update-toast" role="status">
      <span>A new version is available.</span>
      {/* Tells the waiting worker to skipWaiting, then reloads once it takes
          control. (The boolean arg has been ignored since v0.13.2 — it always
          reloads — so it is left off rather than implying a choice.) */}
      <button onClick={() => void updateServiceWorker()}>Reload</button>
      <button className="update-toast-dismiss" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
    </div>
  );
}
