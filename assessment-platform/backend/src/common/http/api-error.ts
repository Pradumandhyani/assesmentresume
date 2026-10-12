import { HttpException } from '@nestjs/common';
export class ApiException extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly retryAfterSeconds = 5,
  ) {
    super({ code, message }, status);
  }
}
