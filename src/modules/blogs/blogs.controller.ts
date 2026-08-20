import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

import { BlogDetailApiResponseDto } from './dto/blog-detail.dto';
import { BlogsService } from './blogs.service';

@ApiTags('blogs')
@Controller('blog')
export class BlogsController {
  constructor(private readonly blogsService: BlogsService) {}

  @Get(':slug')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Frontend-compatible blog detail response' })
  @ApiNotFoundResponse({ description: 'Blog post was not found or is not published' })
  async getBlogDetail(
    @Param('slug') slug: string,
    @Query('lang') lang = 'en',
  ): Promise<BlogDetailApiResponseDto> {
    return {
      success: true,
      data: await this.blogsService.getBlogDetail(slug, lang),
    };
  }
}
