export interface BlogNavPostDto {
  slug: string;
  title: string;
}

export interface BlogRecentPostDto {
  id: number;
  slug: string;
  title: string;
  published_date: string;
  thumbnail_url: string;
}

export interface BlogCategoryDto {
  id: number;
  name: string;
  slug: string;
  post_count: number;
  color: string;
}

export interface BlogDetailDto {
  id: number;
  slug: string;
  tag: string;
  category: string;
  title: string;
  seo_title: string;
  meta: string;
  published_date: string;
  published_date_label: string;
  reading_time_minutes: number;
  views: number;
  author: string;
  excerpt: string;
  image: string;
  content: string[];
  body: string;
  recent_posts: BlogRecentPostDto[];
  categories: BlogCategoryDto[];
  prev_post: BlogNavPostDto | null;
  next_post: BlogNavPostDto | null;
}

export interface BlogDetailApiResponseDto {
  success: true;
  data: BlogDetailDto;
}
