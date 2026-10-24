import { BadRequestException, Body, Controller, Get, Injectable, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ROLE_PERMISSIONS } from '@freshpos/shared';
import { PrismaService } from '../prisma.service';
import { CurrentUser, Public, type AuthUser } from './auth.guard';
import { AuditService } from '../audit.service';

const PasswordLogin = z.object({ tenant: z.string(), email: z.string().email(), password: z.string().min(1) });
const PinLogin = z.object({ tenant: z.string(), storeId: z.string(), employeeNo: z.string(), pin: z.string().regex(/^\d{4,8}$/) });

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.flatten());
  return r.data;
}

@Injectable()
export class AuthService {
  constructor(private db: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  private async issue(user: { id: string; tenantId: string; role: AuthUser['role']; name: string; employeeNo?: string | null }, storeId?: string, ttl = '12h') {
    const payload: AuthUser = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      name: user.name,
      employeeNo: user.employeeNo ?? undefined,
      storeId,
    };
    return {
      token: await this.jwt.signAsync(payload, { expiresIn: ttl }),
      user: { ...payload, permissions: ROLE_PERMISSIONS[user.role] },
    };
  }

  async passwordLogin(input: z.infer<typeof PasswordLogin>) {
    const user = await this.db.user.findFirst({ where: { email: input.email, active: true, tenant: { slug: input.tenant } } });
    if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.audit.log(user.tenantId, 'auth.login', { userId: user.id });
    return this.issue(user);
  }

  async pinLogin(input: z.infer<typeof PinLogin>) {
    const user = await this.db.user.findFirst({
      where: {
        employeeNo: input.employeeNo, active: true, tenant: { slug: input.tenant },
        stores: { some: { storeId: input.storeId } },
      },
    });
    if (!user || !(await bcrypt.compare(input.pin, user.pinHash))) throw new UnauthorizedException('Invalid employee # or PIN');
    await this.audit.log(user.tenantId, 'auth.pin_login', { userId: user.id, storeId: input.storeId });
    return this.issue(user, input.storeId);
  }
  async supervisorAuthorize(cashier: AuthUser, input: { pin: string; permission: string; reason: string; details?: any }) {
    const users = await this.db.user.findMany({
      where: { tenantId: cashier.tenantId, active: true },
    });

    let supervisor: (typeof users)[0] | null = null;
    for (const u of users) {
      if (await bcrypt.compare(input.pin, u.pinHash)) {
        if (ROLE_PERMISSIONS[u.role].includes(input.permission as any)) {
          supervisor = u;
          break;
        }
      }
    }

    if (!supervisor) {
      throw new UnauthorizedException('Invalid supervisor PIN or supervisor lacks required override permission');
    }

    await this.audit.log(cashier.tenantId, 'supervisor.override', {
      userId: cashier.sub,
      storeId: cashier.storeId,
      entity: 'Override',
      data: {
        approvedByUserId: supervisor.id,
        supervisorName: supervisor.name,
        supervisorRole: supervisor.role,
        permission: input.permission,
        reason: input.reason,
        details: input.details,
      },
    });

    return {
      approved: true,
      supervisor: { id: supervisor.id, name: supervisor.name, role: supervisor.role },
      reason: input.reason,
    };
  }
}

const SupervisorAuthorizeInput = z.object({
  pin: z.string().regex(/^\d{4,8}$/),
  permission: z.string(),
  reason: z.string().min(1),
  details: z.any().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login')
  login(@Body() body: unknown) { return this.auth.passwordLogin(parse(PasswordLogin, body)); }

  @Public() @Post('pin')
  pin(@Body() body: unknown) { return this.auth.pinLogin(parse(PinLogin, body)); }

  @Post('supervisor-authorize')
  supervisorAuthorize(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.auth.supervisorAuthorize(user, parse(SupervisorAuthorizeInput, body));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) { return { ...user, permissions: ROLE_PERMISSIONS[user.role] }; }
}
