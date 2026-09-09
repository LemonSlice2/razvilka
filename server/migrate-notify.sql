-- Когда игроку в последний раз слали уведомление о нападении.
-- Нужно, чтобы серия драк не превратилась в серию сообщений.
ALTER TABLE players ADD COLUMN notified INTEGER NOT NULL DEFAULT 0;
