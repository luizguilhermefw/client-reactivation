import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, MulterModuleOptions } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CompanyActiveGuard } from '../../auth/guards/company-active.guard';
import { ExactRolesGuard } from '../../auth/guards/exact-roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { RequestWithUser } from '../../auth/types/request-with-user';
import { isSupportedCustomerImportFileType } from './customer-import-file-policy';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportTemplateService } from './customer-import-template.service';
import {
  CustomerImportFile,
  MAX_CUSTOMER_IMPORT_BYTES,
} from './customer-import.types';

export const CUSTOMER_IMPORT_UPLOAD_OPTIONS: MulterModuleOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_CUSTOMER_IMPORT_BYTES,
    files: 1,
    fields: 0,
    parts: 2,
  },
  fileFilter: (
    _request: unknown,
    file: CustomerImportFile,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!isSupportedCustomerImportFileType(file.originalname, file.mimetype)) {
      callback(
        new BadRequestException('Only XLSX and CSV files are allowed'),
        false,
      );
      return;
    }
    callback(null, true);
  },
};

@Controller('customer/import')
@UseGuards(JwtAuthGuard, CompanyActiveGuard, ExactRolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.OPERATOR)
export class CustomerImportController {
  constructor(
    private readonly customerImportService: CustomerImportService,
    private readonly templateService: CustomerImportTemplateService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', CUSTOMER_IMPORT_UPLOAD_OPTIONS))
  preview(
    @Req() request: RequestWithUser,
    @UploadedFile() file: CustomerImportFile | undefined,
  ) {
    return this.customerImportService.preview(
      request.user.companyId,
      this.requireFile(file),
    );
  }

  @Post('execute')
  @UseInterceptors(FileInterceptor('file', CUSTOMER_IMPORT_UPLOAD_OPTIONS))
  execute(
    @Req() request: RequestWithUser,
    @UploadedFile() file: CustomerImportFile | undefined,
  ) {
    return this.customerImportService.execute(
      request.user.companyId,
      this.requireFile(file),
    );
  }

  @Get('template')
  async template(): Promise<StreamableFile> {
    const content = await this.templateService.create();
    return new StreamableFile(content, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="aylaflow-customer-import.xlsx"',
    });
  }

  private requireFile(
    file: CustomerImportFile | undefined,
  ): CustomerImportFile {
    if (!file)
      throw new BadRequestException('Customer import file is required');
    return file;
  }
}
