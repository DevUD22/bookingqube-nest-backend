-- AlterEnum: add SMS settings group (SMSCountry credentials, enable/disable, test)
ALTER TYPE "AppSettingGroup" ADD VALUE IF NOT EXISTS 'sms';

UPDATE "permissions"
SET "description" = 'Settings → Website, social, mail, SMS & regional'
WHERE "key" = 'settings.general.manage';
