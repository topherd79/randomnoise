-- A song can have several genres, stored as one line: "Pop/Rock" becomes "Pop, Rock"
-- (see genreList in src/lib/genres.ts, which reads both forms and does the same for
-- new uploads, lookups and edits). Splits on a slash, comma, semicolon or bar, or a
-- dash with spaces around it; never on a space ("Hard Rock"), "&" ("R&B") or a plain
-- dash ("Hip-Hop"). "Singer/Songwriter" stays one genre. Game history keeps each song's
-- genre as it was; the app reads "Pop/Rock" there the same way.
UPDATE "songs"
SET "genre" = replace(
      btrim(
        regexp_replace(
          regexp_replace(trim("genre"), 'singer\s*/\s*songwriter', 'Singer§Songwriter', 'gi'),
          '\s*[/,;|]\s*|\s+[-–—]\s+', ', ', 'g'),
        ', '),
      '§', '/'),
    "updated_at" = now()
WHERE "genre" ~ '[/,;|]|\s[-–—]\s'
  AND lower(regexp_replace("genre", '\s', '', 'g')) <> 'singer/songwriter';
