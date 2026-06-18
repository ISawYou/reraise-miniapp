-- Activity logging: tracks user actions for analytics
CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_label text,
  metadata jsonb,
  platform text NOT NULL DEFAULT 'unknown',
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_player_created
  ON activity_events (player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_type_created
  ON activity_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_created
  ON activity_events (created_at DESC);

-- Default: admin actions are NOT included in analytics
INSERT INTO app_settings (key, value)
VALUES ('include_admin_activity', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
