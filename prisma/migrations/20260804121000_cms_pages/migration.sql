CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "body_html_en" TEXT NOT NULL,
    "body_html_ar" TEXT,
    "seo_title_en" TEXT,
    "seo_title_ar" TEXT,
    "seo_description_en" TEXT,
    "seo_description_ar" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");
CREATE INDEX "cms_pages_status_updated_at_idx" ON "cms_pages"("status", "updated_at");

INSERT INTO "cms_pages" (
  "slug", "status", "title_en", "title_ar", "body_html_en", "body_html_ar",
  "seo_title_en", "seo_title_ar", "seo_description_en", "seo_description_ar", "updated_at"
) VALUES
(
  'faqs', 'published', 'Frequently asked questions', 'الأسئلة الشائعة',
  '<h2>How do I book an event?</h2><p>Choose an event, select your date and tickets, then complete checkout securely.</p><h2>Where can I find my tickets?</h2><p>Your confirmed tickets are available from My Tickets in your account.</p><h2>How do I contact support?</h2><p>Visit our Support Center or use the contact details in the footer.</p>',
  '<h2>كيف أحجز فعالية؟</h2><p>اختر الفعالية والتاريخ والتذاكر، ثم أكمل عملية الدفع بأمان.</p><h2>أين أجد تذاكري؟</h2><p>ستجد تذاكرك المؤكدة في صفحة تذاكري داخل حسابك.</p><h2>كيف أتواصل مع الدعم؟</h2><p>تفضل بزيارة مركز الدعم أو استخدم بيانات التواصل أسفل الصفحة.</p>',
  'Frequently asked questions | BookingQube', 'الأسئلة الشائعة | BookingQube',
  'Answers to common BookingQube ticketing and account questions.', 'إجابات عن الأسئلة الشائعة حول التذاكر والحساب في BookingQube.', CURRENT_TIMESTAMP
),
(
  'support-center', 'published', 'Support Center', 'مركز الدعم',
  '<h2>How can we help?</h2><p>Our support team can help with bookings, payments, tickets, and account access.</p><h3>Contact us</h3><p>Email <a href="mailto:info@bookingqube.com">info@bookingqube.com</a> or call <a href="tel:+97451138418">+974 5113 8418</a>.</p>',
  '<h2>كيف يمكننا مساعدتك؟</h2><p>يمكن لفريق الدعم مساعدتك في الحجوزات والمدفوعات والتذاكر والوصول إلى الحساب.</p><h3>تواصل معنا</h3><p>راسلنا على <a href="mailto:info@bookingqube.com">info@bookingqube.com</a> أو اتصل على <a href="tel:+97451138418">+974 5113 8418</a>.</p>',
  'Support Center | BookingQube', 'مركز الدعم | BookingQube',
  'Get help with BookingQube bookings, payments, tickets, and accounts.', 'احصل على المساعدة في حجوزات ومدفوعات وتذاكر وحسابات BookingQube.', CURRENT_TIMESTAMP
);

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.pages.read', 'CMS → Pages — view FAQ and Support Center pages'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.pages.read');

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.pages.write', 'CMS → Pages — edit and publish FAQ and Support Center pages'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.pages.write');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name = 'admin'
  AND p.key IN ('cms.pages.read', 'cms.pages.write')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
