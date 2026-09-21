-- =====================================================================
-- Winter League Platform — Migration 004
--
-- 1. Phone numbers are now stored as digits only (formatted for display
--    as (123) 456-7890). Strip punctuation from existing values and drop a
--    leading US country code. Values that still aren't 10 digits are left
--    as they were and simply shown unformatted.
-- 2. The "Pacific Youth Conference" theme is now "Pacific Energy"; update
--    the stored theme id if a System Admin had already chosen it.
-- =====================================================================

UPDATE users SET phone = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')
WHERE phone IS NOT NULL;
UPDATE users SET phone = SUBSTR(phone, 2) WHERE LENGTH(phone) = 11 AND phone LIKE '1%';
UPDATE users SET phone = NULL WHERE phone = '';

UPDATE programs SET contact_phone = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(contact_phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')
WHERE contact_phone IS NOT NULL;
UPDATE programs SET contact_phone = SUBSTR(contact_phone, 2) WHERE LENGTH(contact_phone) = 11 AND contact_phone LIKE '1%';
UPDATE programs SET contact_phone = NULL WHERE contact_phone = '';

UPDATE app_settings SET value = 'pacificEnergy' WHERE key = 'theme' AND value = 'pacificYouthConference';
