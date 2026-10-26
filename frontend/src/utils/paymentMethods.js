// How referees get paid. Programs pay outside the app; this only builds links
// and QR codes from the referee's username. Mirrors backend
// src/referees/payMethods.js; add new methods (Zelle, PayPal, Cash App) to both.
export const PAYMENT_METHODS = {
  venmo: {
    label: 'Venmo',
    show: (h) => `@${h}`,
    // Opens the referee's Venmo profile (the app on a phone, the website on a computer).
    profileUrl: (h) => `https://venmo.com/u/${encodeURIComponent(h)}`,
    // Opens Venmo ready to pay them, with the amount and note filled in. This
    // link format is widely used but not officially documented by Venmo; if it
    // ever stops filling in the amount, people can still type it.
    payUrl: (h, cents, note) => `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(h)}&amount=${(cents / 100).toFixed(2)}&note=${encodeURIComponent(note)}`,
  },
};

// How a payment was made, for "Mark as paid".
export const PAID_WITH = [['venmo', 'Venmo'], ['check', 'Check'], ['cash', 'Cash'], ['other', 'Other']];
