import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from './errors';

/** Renders every error as RFC 9457 problem+json. Never leaks stack traces or SQL. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let title = 'Something went wrong';
    let errors: unknown[] | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      title = exception.message;
      errors = exception.errors;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(body?.message)) {
        code = 'VALIDATION_FAILED';
        title = 'Some fields are invalid';
        errors = body.message.map((m: string) => ({ field: m.split(' ')[0], code: 'INVALID', message: m }));
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
        code = 'RATE_LIMITED';
        title = 'Too many requests. Please slow down and try again shortly.';
      } else {
        code = HttpStatus[status] ?? 'HTTP_ERROR';
        title = typeof body === 'string' ? body : body?.message ?? exception.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      code = 'DUPLICATE';
      title = 'This record already exists';
    } else {
      this.log.error(`[${requestId}] ${(exception as Error)?.stack ?? exception}`);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, code, errors, requestId });
  }
}
