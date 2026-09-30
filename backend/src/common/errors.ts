import { HttpStatus } from '@nestjs/common';

/** Domain error carrying a stable machine-readable code (see docs/07-api-spec.md §1). */
export class AppError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly errors?: { field: string; code: string; message: string }[],
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} not found`);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this resource') =>
  new AppError(HttpStatus.FORBIDDEN, code, message);
export const conflict = (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message);
export const unprocessable = (code: string, message: string) =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
export const badRequest = (code: string, message: string) => new AppError(HttpStatus.BAD_REQUEST, code, message);
