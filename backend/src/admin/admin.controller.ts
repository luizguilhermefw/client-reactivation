import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('companies')
  async listCompanies() {
    return this.adminService.listCompanies();
  }

  @Patch('company/:id/activate')
  async activateCompany(@Param('id') id: string) {
    return this.adminService.activateCompany(id);
  }
}
