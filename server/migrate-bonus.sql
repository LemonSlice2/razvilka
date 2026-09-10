-- Надбавка от владельца игры: прибавляется к силе и здоровью из вещей
-- и НЕ перезаписывается синхронизацией с клиентом.
ALTER TABLE players ADD COLUMN bonus_power  REAL NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN bonus_health REAL NOT NULL DEFAULT 0;
