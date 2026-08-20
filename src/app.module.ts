import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { ArtistsModule } from './modules/artists/artists.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AdminCafesModule } from './modules/admin-cafes/admin-cafes.module';
import { AdminDailyClosingsModule } from './modules/admin-daily-closings/admin-daily-closings.module';
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module';
import { AdminEventsModule } from './modules/admin-events/admin-events.module';
import { AdminOrganizationsModule } from './modules/admin-organizations/admin-organizations.module';
import { AdminOrdersModule } from './modules/admin-orders/admin-orders.module';
import { AdminPaymentRecoveriesModule } from './modules/admin-payment-recoveries/admin-payment-recoveries.module';
import { AdminPromocodesModule } from './modules/admin-promocodes/admin-promocodes.module';
import { AdminPaymentSettingsModule } from './modules/admin-payment-settings/admin-payment-settings.module';
import { AdminFileStorageModule } from './modules/admin-file-storage/admin-file-storage.module';
import { AdminRedisSettingsModule } from './modules/admin-redis-settings/admin-redis-settings.module';
import { AdminAppSettingsModule } from './modules/admin-app-settings/admin-app-settings.module';
import { AdminRolesModule } from './modules/admin-roles/admin-roles.module';
import { AdminStaffModule } from './modules/admin-staff/admin-staff.module';
import { AdminCmsArtistsModule } from './modules/admin-cms-artists/admin-cms-artists.module';
import { AdminCmsVenuesModule } from './modules/admin-cms-venues/admin-cms-venues.module';
import { AdminFooterMenusModule } from './modules/admin-footer-menus/admin-footer-menus.module';
import { AdminHomepageFaqsModule } from './modules/admin-homepage-faqs/admin-homepage-faqs.module';
import { AdminBlogsModule } from './modules/admin-blogs/admin-blogs.module';
import { AdminOffersModule } from './modules/admin-offers/admin-offers.module';
import { AdminLegacyMigrationModule } from './modules/admin-legacy-migration/admin-legacy-migration.module';
import { MediaStorageModule } from './modules/media-storage/media-storage.module';
import { MailModule } from './modules/mail/mail.module';
import { SmsModule } from './modules/sms/sms.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { BlogsModule } from './modules/blogs/blogs.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { CustomerModule } from './modules/customer/customer.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { HomepageModule } from './modules/homepage/homepage.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MyFatoorahModule } from './modules/myfatoorah/myfatoorah.module';
import { OrganizerModule } from './modules/organizer/organizer.module';
import { PagesModule } from './modules/pages/pages.module';
import { PosModule } from './modules/pos/pos.module';
import { PosCafeModule } from './modules/pos-cafe/pos-cafe.module';
import { PromocodesModule } from './modules/promocodes/promocodes.module';
import { QueuesModule } from './modules/queues/queues.module';
import { RedisModule } from './modules/redis/redis.module';
import { RegistrationModule } from './modules/registration/registration.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { VenuesModule } from './modules/venues/venues.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AdminReviewsModule } from './modules/admin-reviews/admin-reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({
      skipIf: () =>
        Boolean(process.env.JEST_WORKER_ID) || process.env.NODE_ENV === 'test',
      throttlers: [{ name: 'default', ttl: 60000, limit: 120 }],
    }),
    DatabaseModule,
    RedisModule,
    InventoryModule,
    CatalogModule,
    ReportingModule,
    QueuesModule,
    AdminAuthModule,
    AdminCafesModule,
    AdminDailyClosingsModule,
    AdminDashboardModule,
    AdminEventsModule,
    AdminOrganizationsModule,
    AdminOrdersModule,
    AdminPaymentRecoveriesModule,
    AdminPromocodesModule,
    AdminFooterMenusModule,
    AdminHomepageFaqsModule,
    AdminBlogsModule,
    AdminOffersModule,
    AdminCmsArtistsModule,
    AdminCmsVenuesModule,
    AdminPaymentSettingsModule,
    AdminFileStorageModule,
    AdminRedisSettingsModule,
    AdminAppSettingsModule,
    AdminRolesModule,
    AdminStaffModule,
    AdminLegacyMigrationModule,
    MediaStorageModule,
    MailModule,
    SmsModule,
    MyFatoorahModule,
    ArtistsModule,
    AuthModule,
    BookingsModule,
    BlogsModule,
    CheckoutModule,
    CustomerModule,
    EventsModule,
    HealthModule,
    HomepageModule,
    OrganizerModule,
    PagesModule,
    PosModule,
    PosCafeModule,
    PromocodesModule,
    RegistrationModule,
    VenuesModule,
    ReviewsModule,
    AdminReviewsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
