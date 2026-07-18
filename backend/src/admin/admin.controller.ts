import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { AdminService } from './admin.service';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { Roles } from '../auth/decorators/roles.decorator';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('companies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async listCompanies() {
    return this.adminService.listCompanies();
  }

  @Patch('company/:id/activate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN)
  async activateCompany(@Param('id') id: string) {
    return this.adminService.activateCompany(id);
  }
}
