ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
    ON users (lower(username))
    WHERE username IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format;
ALTER TABLE users ADD CONSTRAINT users_username_format
    CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,80}$');