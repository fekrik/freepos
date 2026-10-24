import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasPermission, type Permission, type RoleName } from '@freshpos/shared';

export interface AuthUser {
  sub: string;
  tenantId: string;
  role: RoleName;
  name: string;
  employeeNo?: string;
  storeId?: string;
}

const PERM_KEY = 'perm';
const PUBLIC_KEY = 'public';
export const RequirePermission = (p: Permission) => SetMetadata(PERM_KEY, p);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);

/** Global guard: verifies JWT, then checks the route's required permission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const perm = this.reflector.getAllAndOverride<Permission>(PERM_KEY, targets);
    if (perm && !hasPermission(req.user.role, perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
    return true;
  }
}
