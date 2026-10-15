-- STAGING ONLY. Do not apply to production before tested database snapshot.
-- Capture ALL writers to existing records table, including legacy web forms.
CREATE TABLE IF NOT EXISTS sync_events (
 sequence BIGSERIAL PRIMARY KEY,
 record_key TEXT NOT NULL,
 record_type TEXT NOT NULL,
 payload JSONB NOT NULL,
 revision TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_events_record_key_idx ON sync_events(record_key);
CREATE OR REPLACE FUNCTION greenair_sync_capture() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_events(record_key,record_type,payload,revision)
  VALUES(NEW.record_key,NEW.record_type,NEW.payload,
    encode(digest(convert_to(NEW.payload::text,'UTF8'),'sha256'),'hex'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Requires pgcrypto extension. Create in staging before running this migration.
DROP TRIGGER IF EXISTS greenair_sync_records_change ON records;
CREATE TRIGGER greenair_sync_records_change
 AFTER INSERT OR UPDATE ON records
 FOR EACH ROW EXECUTE FUNCTION greenair_sync_capture();
-- Note: DELETE is not captured; use tombstones instead.
