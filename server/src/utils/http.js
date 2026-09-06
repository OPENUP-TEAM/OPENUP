/** Wraps an async route so thrown errors reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  static badRequest(msg, details) { return new ApiError(400, msg, details); }
  static unauthorized(msg = 'Sign in to continue.') { return new ApiError(401, msg); }
  static forbidden(msg = 'You do not have access to this.') { return new ApiError(403, msg); }
  static notFound(msg = 'Not found.') { return new ApiError(404, msg); }
  static conflict(msg) { return new ApiError(409, msg); }
}
