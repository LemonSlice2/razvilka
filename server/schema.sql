-- Таблица рейтинга. Один игрок — одна строка, id из Telegram.
CREATE TABLE IF NOT EXISTS players (
  id      INTEGER PRIMARY KEY,   -- telegram user id
  name    TEXT    NOT NULL,      -- то, что человек сам выставил в Telegram
  score   REAL    NOT NULL DEFAULT 0,   -- заработано за всё время
  runs    INTEGER NOT NULL DEFAULT 0,
  path    TEXT,                  -- на каком пути сейчас
  updated INTEGER NOT NULL       -- unix-время последнего обновления
);
CREATE INDEX IF NOT EXISTS players_score ON players(score DESC);
