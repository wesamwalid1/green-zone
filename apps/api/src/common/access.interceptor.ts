import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { stripHidden } from './access-map';
import { map } from 'rxjs/operators';

@Injectable()
export class AccessInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const keys: string[] = req.accessKeys || [];
    if (!keys.length) return next.handle();
    return next.handle().pipe(map((data) => stripHidden(data, keys)));
  }
}
