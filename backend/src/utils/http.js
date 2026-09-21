// Small helpers so route handlers read cleanly and every error reaches the
// client as { error: "<plain sentence>" } with the right status code.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have access to that.') => new HttpError(403, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Express 4 doesn't catch rejected promises — wrap every async handler.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
