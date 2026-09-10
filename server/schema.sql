-- Таблица рейтинга. Один игрок — одна строка, id из Telegram.
CREATE TABLE IF NOT EXISTS players (
  id      INTEGER PRIMARY KEY,   -- telegram user id
  name    TEXT    NOT NULL,      -- то, что человек сам выставил в Telegram
  score   REAL    NOT NULL DEFAULT 0,   -- заработано за всё время
  runs    INTEGER NOT NULL DEFAULT 0,
  path    TEXT,                  -- на каком пути сейчас
  updated INTEGER NOT NULL,      -- unix-время последнего обновления

  -- драка
  power      REAL    NOT NULL DEFAULT 0,     -- сила из вещей
  health     REAL    NOT NULL DEFAULT 100,   -- здоровье из вещей
  bp         REAL    NOT NULL DEFAULT 1000,  -- боевые очки, меняются по итогам драк
  last_fight INTEGER NOT NULL DEFAULT 0,     -- когда дрался в последний раз
  notified   INTEGER NOT NULL DEFAULT 0,     -- когда ему слали уведомление о нападении

  -- надбавка от владельца, синхронизация её не трогает
  bonus_power  REAL NOT NULL DEFAULT 0,
  bonus_health REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_score ON players(score DESC);
CREATE INDEX IF NOT EXISTS players_bp ON players(bp DESC);
