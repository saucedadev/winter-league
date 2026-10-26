// How referees get paid. Programs pay outside the app; the app only stores the
// referee's handle for each method and builds links from it.
//
// To offer another method later (Zelle, PayPal, Cash App), add an entry here
// and in frontend/src/utils/paymentMethods.js. No database change is needed.
import { badRequest } from '../utils/http.js';

export const PAYMENT_METHODS = {
  venmo: {
    label: 'Venmo',
    // Accepts "@name", "name", or a pasted profile link (venmo.com/u/name).
    // Venmo usernames are 5–30 letters, numbers, hyphens and underscores.
    normalize(raw) {
      let v = String(raw || '').trim();
      v = v.replace(/^https?:\/\//i, '').replace(/^(www\.|account\.)?venmo\.com\/(u\/)?/i, '').replace(/[/?#].*$/, '').replace(/^@/, '');
      if (!/^[A-Za-z0-9_-]{5,30}$/.test(v)) throw badRequest('Enter the Venmo username as it appears in Venmo, without the @ (5 to 30 letters, numbers, hyphens or underscores).');
      return v;
    },
    show: (h) => `@${h}`,
  },
};

// How a payment was made, for "Mark as paid".
export const PAID_WITH = { venmo: 'Venmo', check: 'Check', cash: 'Cash', other: 'Other' };

// A changed username is flagged on the payouts page for this many days.
export const RECENT_CHANGE_DAYS = 14;
