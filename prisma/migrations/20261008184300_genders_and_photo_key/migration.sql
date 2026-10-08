-- Migration 2 (Chuan): the gender list of the app, and one user per profile photo.
-- Written by hand from `prisma migrate diff` (the index) plus the gender rows. One transaction:
-- if any step fails, nothing changes.
BEGIN;

-- Reference data: the app's four gender options. "prefer_not_to_say" replaces "other".
INSERT INTO "genders" ("code", "label") VALUES
    ('prefer_not_to_say', 'Prefer not to say');

-- Fails (and changes nothing) while a user or a target preference still uses "other",
-- because of the RESTRICT foreign keys. No user had "other" when this was written.
DELETE FROM "genders" WHERE "code" = 'other';

-- CreateIndex: a photo key belongs to one user, and GET /photos/{photoId} finds it by key.
CREATE UNIQUE INDEX "users_photo_key_key" ON "users"("photo_key");

COMMIT;
