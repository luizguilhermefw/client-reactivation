import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, CompanyActiveGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@Request() request: RequestWithUser) {
    return this.dashboardService.getSummary(request.user.companyId);
  }
}
