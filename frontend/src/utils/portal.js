// Hub Portal single sign-on, frontend side (see PORTAL-SSO.md).
//
// Switched on by VITE_PORTAL_URL. Without it, nothing here does anything and
// Winter League signs people in with its own username and password as before.

const PORTAL_URL = String(import.meta.env.VITE_PORTAL_URL || '').trim().replace(/\/+$/, '');
const APP_SLUG = import.meta.env.VITE_PORTAL_APP_SLUG || 'winter-league';

export const portalEnabled = !!PORTAL_URL;
export const portalUrl = PORTAL_URL;

// Safety net against a redirect loop between the portal and this app. If a
// visitor has been sent to the portal several times in a short spell without
// a successful sign-in, something is misconfigured (a mismatched secret, say),
// and going round again would only repeat the failure as fast as the browser
// can. Stop, and show this app's own sign-in page with an explanation.
const TRIPS_KEY = 'winterleague:portal-trips';
const MAX_TRIPS = 3;
const WINDOW_MS = 2 * 60 * 1000;

function recentTrips() {
  try {
    const now = Date.now();
    return (JSON.parse(sessionStorage.getItem(TRIPS_KEY)) || []).filter((t) => now - t < WINDOW_MS);
  } catch {
    return [];
  }
}

/** Called after a successful portal sign-in: the hand-off works, so start counting afresh. */
export function portalSignInSucceeded() {
  try {
    sessionStorage.removeItem(TRIPS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Sends a signed-out visitor to the portal to sign in. The portal hands them
 * straight back to `returnPath` (a path inside this app), with no sign-in
 * screen at all if they are already signed in there.
 */
export function signInThroughPortal(returnPath = '/') {
  const back = typeof returnPath === 'string' && returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/';
  const trips = recentTrips();
  if (trips.length >= MAX_TRIPS) {
    window.location.replace(`/login?local=1&portal=failed&next=${encodeURIComponent(back)}`);
    return;
  }
  try {
    sessionStorage.setItem(TRIPS_KEY, JSON.stringify([...trips, Date.now()]));
  } catch {
    // ignore
  }
  window.location.replace(`${PORTAL_URL}/launch/${encodeURIComponent(APP_SLUG)}?return=${encodeURIComponent(back)}`);
}

/** After signing out of this app, go back to the portal's app tiles. */
export function returnToPortal() {
  window.location.assign(PORTAL_URL);
}
