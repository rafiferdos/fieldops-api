import {
  Injectable,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
@Injectable()
export class PaymentCallbackGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !request.is('application/x-www-form-urlencoded') &&
      !request.is('application/json')
    )
      throw new UnsupportedMediaTypeException(
        'Payment notifications require form or JSON data',
      );
    return true;
  }
}
