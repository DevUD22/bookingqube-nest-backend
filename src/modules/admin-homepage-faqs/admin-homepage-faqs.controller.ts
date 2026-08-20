import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminHomepageFaqsService } from './admin-homepage-faqs.service';
import { ReorderHomepageFaqsDto, UpsertHomepageFaqDto } from './dto/admin-homepage-faq.dto';

@ApiTags('admin-cms-homepage-faqs')
@ApiBearerAuth()
@Controller('admin/cms/homepage-faqs')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('cms.faqs.read')
export class AdminHomepageFaqsController {
  constructor(private readonly homepageFaqs: AdminHomepageFaqsService) {}

  @Get()
  list(@Query('locale') locale?: string) {
    return this.homepageFaqs.list(locale);
  }

  @Post()
  @RequirePermissions('cms.faqs.write')
  create(@Body() body: UpsertHomepageFaqDto) {
    return this.homepageFaqs.create(body);
  }

  @Put('reorder')
  @RequirePermissions('cms.faqs.write')
  reorder(@Body() body: ReorderHomepageFaqsDto) {
    return this.homepageFaqs.reorder(body);
  }

  @Put(':id')
  @RequirePermissions('cms.faqs.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertHomepageFaqDto) {
    return this.homepageFaqs.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions('cms.faqs.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.homepageFaqs.remove(id);
  }
}
