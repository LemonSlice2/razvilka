-- Добавляет поля для драки к уже существующей таблице.
-- Прогоняется один раз: wrangler d1 execute pod-solncem-rating --remote --file=migrate-fights.sql
ALTER TABLE players ADD COLUMN power      REAL    NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN health     REAL    NOT NULL DEFAULT 100;
ALTER TABLE players ADD COLUMN bp         REAL    NOT NULL DEFAULT 1000;
ALTER TABLE players ADD COLUMN last_fight INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS players_bp ON players(bp DESC);
