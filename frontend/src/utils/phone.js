// Phones are stored as 10 digits and shown as (123) 456-7890.

export function phoneDigits(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.slice(0, 10);
}

// Partial numbers format progressively: "(312", "(312) 555", "(312) 555-01".
export function formatPhoneTyping(digits) {
  const d = String(digits ?? '');
  if (!d) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

// For display in tables and cards. Anything that isn't 10 digits (e.g. an
// old entry) is shown as it was stored.
export function formatPhone(value) {
  if (!value) return '';
  const d = String(value).replace(/\D/g, '');
  return d.length === 10 ? formatPhoneTyping(d) : String(value);
}
