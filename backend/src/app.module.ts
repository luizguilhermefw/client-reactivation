import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';

@Module({
  imports: [PrismaModule, AuthModule, CompanyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
