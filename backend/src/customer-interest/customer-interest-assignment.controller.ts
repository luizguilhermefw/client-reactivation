import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CompanyActiveGuard } from '../auth/guards/company-active.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../auth/types/request-with-user';
import { CustomerInterestAssignmentService } from './customer-interest-assignment.service';
import { UpdateCustomerInterestsDto } from './dto/update-customer-interests.dto';

@Controller('customer')
@UseGuards(JwtAuthGuard, CompanyActiveGuard)
export class CustomerInterestAssignmentController {
  constructor(private readonly service: CustomerInterestAssignmentService) {}

  @Get(':customerId/interests')
  get(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Req() request: RequestWithUser,
  ) {
    return this.service.get(request.user.companyId, customerId);
  }

  @Put(':customerId/interests')
  update(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() dto: UpdateCustomerInterestsDto,
    @Req() request: RequestWithUser,
  ) {
    return this.service.update(
      request.user.companyId,
      customerId,
      dto.interestOptionIds,
    );
  }
}
