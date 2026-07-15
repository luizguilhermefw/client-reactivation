import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';

import type { RequestWithUser } from '../auth/types/request-with-user';

import { UsersService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  create(@Req() req: RequestWithUser, @Body() data: CreateUserDto) {
    return this.usersService.create(data, req.user.companyId);
  }
}
