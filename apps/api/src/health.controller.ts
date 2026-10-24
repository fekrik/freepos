import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Public } from './auth/auth.guard';

@Controller('health')
export class HealthController {
  constructor(private db: PrismaService) {}

  @Public() @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}
