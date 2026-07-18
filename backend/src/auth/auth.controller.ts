import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterCompanyDto } from './dto/register-company.dto';
import type { RequestWithUser } from './types/request-with-user';
import { CompanyActiveGuard } from './guards/company-active.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard, CompanyActiveGuard)
  @Get('me')
  getProfile(@Req() req: RequestWithUser) {
    return req.user;
  }

  @Post('register-company')
  registerCompany(@Body() data: RegisterCompanyDto) {
    return this.authService.registerCompany(data);
  }
}