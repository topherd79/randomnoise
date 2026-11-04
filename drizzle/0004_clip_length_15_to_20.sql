-- Clip lengths changed from 5/10/15 to 5/10/20/30 seconds. Songs that were set to
-- "always 15 seconds" move to 20 (the closest longer option). Games already
-- created keep the clips they were cut with.
UPDATE "songs" SET "clip_length_sec" = 20 WHERE "clip_length_sec" = 15;
