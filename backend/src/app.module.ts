import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { CustomerModule } from './customer/customer.module';

@Module({
  imports: [PrismaModule, AuthModule, CompanyModule, CustomerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
