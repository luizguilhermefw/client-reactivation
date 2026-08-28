import { Test } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardModule } from './dashboard.module';
import { DashboardService } from './dashboard.service';

describe('DashboardModule', () => {
  it('compiles and resolves Dashboard dependencies', async () => {
    const prismaMock = {
      automation: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      customer: {
        count: jest.fn(),
      },
      outboundMessage: {
        count: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [DashboardModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    expect(moduleRef.get(DashboardController)).toBeDefined();
    expect(moduleRef.get(DashboardService)).toBeDefined();
    expect(moduleRef.get(PrismaService)).toBeDefined();
  });
});
