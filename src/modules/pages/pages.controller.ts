import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

const PAGES = {
  terms: {
    title: 'Terms and Conditions',
    body: `<h2>Booking terms</h2><p>By booking with BookingQube, you confirm that the customer and attendee details you provide are accurate and that you are authorised to make the booking.</p><h3>Tickets and entry</h3><p>Your booking reference and digital tickets are required for entry. Tickets may only be used for the booked date and time and remain subject to the organiser's admission, age, safety, and venue rules.</p><h3>Changes and cancellations</h3><p>Event schedules, performers, activities, and venue arrangements may change where reasonably necessary. Refunds, exchanges, and cancellations follow the policy shown for the event at checkout. Booking and payment-provider fees may be non-refundable where permitted.</p><h3>Customer responsibilities</h3><p>Please arrive on time, follow staff instructions, respect other guests, and disclose any accessibility or safety requirements before attending. Resale, duplication, or misuse of a ticket may result in cancellation.</p><h3>Liability</h3><p>Nothing in these terms excludes rights that cannot legally be excluded. To the extent permitted by law, BookingQube is not responsible for losses outside its reasonable control.</p>`,
  },
  privacy: {
    title: 'Privacy Policy',
    body: `<h2>Your privacy</h2><p>BookingQube uses the information you provide to create and manage your account, process bookings, issue tickets, provide customer support, prevent fraud, and meet legal obligations.</p><h3>Information we process</h3><p>This may include your name, contact details, booking history, preferences, device and security information, and payment status. Card details are handled by the selected payment provider and are not stored as plain card data by BookingQube.</p><h3>How information is shared</h3><p>We share only what is reasonably required with event organisers, venues, payment and communication providers, and authorities where the law requires it. Service providers must protect the information they process for us.</p><h3>Retention and choices</h3><p>We retain records for as long as needed for bookings, support, security, and legal requirements. You may update your profile and contact BookingQube to request access, correction, or deletion where applicable.</p><h3>Contact</h3><p>For privacy questions or requests, contact BookingQube support and include the email address associated with your account.</p>`,
  },
} as const;

/** Static legal copy until editable CMS pages are introduced in Prisma. */
@ApiTags('pages')
@Controller('page')
export class PagesController {
  @Get(':slug')
  @ApiQuery({ name: 'lang', required: false, example: 'en' })
  @ApiOkResponse({ description: 'Public legal page content' })
  getPage(
    @Param('slug') slug: string,
    @Query('lang') _lang = 'en',
  ) {
    const page = PAGES[slug as keyof typeof PAGES];
    if (!page) throw new NotFoundException('Page not found.');
    return {
      success: true,
      data: { slug, ...page },
    };
  }
}
