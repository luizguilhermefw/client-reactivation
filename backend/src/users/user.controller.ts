import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import type { RequestWithUser } from '../auth/types/request-with-user';

import { Roles } from '../auth/decorators/roles.decorator';

import { UserRole } from '@prisma/client';

import { UsersService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, CompanyActiveGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  create(@Req() req: RequestWithUser, @Body() data: CreateUserDto) {
    return this.usersService.create(data, req.user.companyId);
  }
}
