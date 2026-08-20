-- AlterEnum: Google Authenticator / admin login security settings
ALTER TYPE "AppSettingGroup" ADD VALUE IF NOT EXISTS 'security';

UPDATE "permissions"
SET "description" = 'Settings → Website, social, mail, SMS, regional & login security'
WHERE "key" = 'settings.general.manage';
