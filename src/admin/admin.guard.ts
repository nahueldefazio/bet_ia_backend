import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Basic ')) throw new UnauthorizedException();

    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
    const colon = decoded.indexOf(':');
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);

    const expectedUser = this.config.get('ADMIN_USER', 'admin');
    const expectedPass = this.config.get('ADMIN_PASS', '');

    if (!expectedPass || user !== expectedUser || pass !== expectedPass) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
