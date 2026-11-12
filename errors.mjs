/** Error with a user-facing message; `code` is the CLI exit code. */
export class UserError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}
