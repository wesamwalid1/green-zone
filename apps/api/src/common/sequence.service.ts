import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SequenceService {
  constructor(private prisma: PrismaService) {}

  async next(key: string, prefix: string): Promise<string> {
    const seq = await this.prisma.sequence.upsert({
      where: { key },
      create: { key, value: 1 },
      update: { value: { increment: 1 } },
    });
    const num = String(seq.value).padStart(6, '0');
    return `${prefix}-${num}`;
  }
}
