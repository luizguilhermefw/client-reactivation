import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { CustomerModule } from './customer/customer.module';
import { AutomationModule } from './automation/automation.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MessageModule } from './message/message.module';
import { UsersModule } from './users/user.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CompanyModule,
    CustomerModule,
    AutomationModule,
    MessageModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
