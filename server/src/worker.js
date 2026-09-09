/* Рейтинг «Под солнцем» — Cloudflare Worker.

   Две ручки:
     POST /sync   { initData, score, runs, path, power, health } -> { place, total, top }
     POST /fight  { initData, target }                          -> { win, rounds, delta, bp }
     GET  /top[?by=bp]                                          -> { total, top }

   Здесь модульный синтаксис, в отличие от самой игры: это другой рантайм,
   а не браузер с file://, и запрет на ES-модули из CLAUDE.md сюда не относится.

   Токен бота живёт в секрете BOT_TOKEN и в репозиторий не попадает:
     wrangler secret put BOT_TOKEN
*/

const TOP_SIZE = 20;
const MAX_AGE = 24 * 3600;      // initData старше суток не принимаем
const MIN_GAP = 10;             // не чаще раза в 10 секунд от одного игрока
const SCORE_CAP = 1e30;         // выше этого — явно подделка, а не игра
const FIGHT_COOLDOWN = 60;      // секунд между драками одного игрока

/* ---------- проверка подписи Telegram ----------
   secret = HMAC_SHA256(ключ "WebAppData", сообщение = токен бота)
   hash   = HMAC_SHA256(ключ secret,       сообщение = строка проверки)
   Порядок аргументов здесь легко перепутать, и тогда проверка молча
   пропустит что угодно. */

const enc = new TextEncoder();

async function hmac(keyBytes, message){
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const toHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

async function checkInitData(initData, botToken){
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // все поля кроме hash, по алфавиту, через перевод строки
  const check = [...params.entries()]
    .sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([k, v]) => k + '=' + v)
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const mine = toHex(await hmac(secret, check));

  // сравнение постоянного времени: длины равны, иначе уже не совпало
  if (mine.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > MAX_AGE) return null;

  try { return JSON.parse(params.get('user') || 'null'); }
  catch(e){ return null; }
}

/* ---------- имя игрока ----------
   Показываем то, что человек сам выставил в Telegram. Никаких телефонов
   и прочего: в user приходит только публичная часть профиля. */
function displayName(u){
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
            || u.username || ('Игрок ' + u.id);
  return name.slice(0, 40);
}

function clamp(v, lo, hi){
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/* ---------- драка ----------
   Считается здесь, а не на клиенте: иначе побеждали бы все.
   Нападающий бьёт первым — это его преимущество за то, что он ищет драку.
   Минимум единица урона за удар, поэтому бой всегда заканчивается. */
function resolveFight(a, b){
  let ah = a.health, bh = b.health, rounds = 0;
  const swing = () => 0.8 + Math.random() * 0.4;
  while (rounds < 300){
    rounds++;
    bh -= Math.max(1, a.power * swing());
    if (bh <= 0) break;
    ah -= Math.max(1, b.power * swing());
    if (ah <= 0) break;
  }
  return { win: bh <= 0, rounds, left: Math.max(0, Math.round(ah)) };
}

/* Боевая мощь: сила решает, здоровье под корнем — живучесть без силы
   боёв не выигрывает. */
function might(p){ return p.power * Math.sqrt(Math.max(1, p.health) / 100); }

/* Очки по Эло плюс поправка на разрыв в мощи.
   Эло само по себе даёт мало за победу над низкорейтинговым, но новичок
   начинает с той же тысячи, что и все, — и первое избиение приносило бы
   полновесные очки. Поэтому победа над заведомо слабым домножается на
   отношение мощей: избивать беспомощных бессмысленно, а не запрещено.

   Запрещать нельзя: запрет на нападение к безоружным делал бы выгодным
   вообще не покупать оружие — неуязвимость за безделье. */
const K_FACTOR = 24;
function bpDelta(me, enemy, win){
  const expected = 1 / (1 + Math.pow(10, (enemy.bp - me.bp) / 400));
  let delta = K_FACTOR * ((win ? 1 : 0) - expected);
  if (win){
    const ratio = might(enemy) / Math.max(1, might(me));
    if (ratio < 1) delta *= Math.max(0.08, ratio);
  }
  return Math.round(delta);
}


/* ---------- уведомление в Telegram ----------
   Бот может писать тому, кто открывал игру и разрешил ему это — Telegram
   спрашивает разрешение сам при первом запуске Mini App. Кто не разрешил,
   получит от API отказ, и это нормально: молча пропускаем.

   Сообщение отправляется в фоне через ctx.waitUntil, иначе ответ на драку
   ждал бы ещё один сетевой запрос.

   Формулировка честная: денег мы не отнимаем, только очки. «Тебя ограбили»
   отправило бы человека искать пропавшие деньги, которых он не терял. */
const NOTIFY_GAP = 600;      // не чаще раза в 10 минут одному человеку

/* Род по имени не угадаешь — «напал Алена» и «не справилась Николай» одинаково
   плохи. Поэтому в тексте нет ни одного глагола в прошедшем времени. */
function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

async function notifyAttacked(env, defender, attackerName, defenderWon, delta){
  if (!env.BOT_TOKEN) return;

  const n = Math.abs(delta);
  const points = n + ' ' + plural(n, 'очко', 'очка', 'очков');
  const outcome = defenderWon
    ? 'нападение отбито · +' + points
    : 'поражение · −' + points;

  const lines = [
    '⚡ На тебя напали.',
    attackerName + ' · ' + outcome,
    'Деньги и прогресс целы, потеряны только боевые очки.'
  ];
  if (!defenderWon) lines.push('', 'Зайди и прокачай вещи, чтобы ответить.');

  const body = {
    chat_id: defender.id,
    text: lines.join('\n'),
    reply_markup: env.GAME_URL ? {
      inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: env.GAME_URL } }]]
    } : undefined
  };

  const send = async payload => fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) });

  try {
    const res = await send(body);
    // Кнопку web_app Telegram принимает не во всех случаях. Сообщение важнее
    // кнопки, поэтому при отказе шлём ещё раз без неё.
    if (!res.ok && body.reply_markup){
      const plain = { chat_id: body.chat_id, text: body.text };
      await send(plain);
    }
  } catch(e){ /* не достучались — драка от этого не отменяется */ }
}

/* ---------- ответы ---------- */
function cors(env){
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
const json = (env, data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(env) }
});

async function topRows(env, order){
  const byBp = order === 'bp';
  const { results } = await env.DB.prepare(
    `SELECT id, name, score, runs, path, bp, power, health FROM players
     ORDER BY ${byBp ? 'bp' : 'score'} DESC LIMIT ?1`
  ).bind(TOP_SIZE).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first('n');
  return { total: total || 0, top: (results || []).map((r, i) => ({ place: i + 1, ...r })) };
}

export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    if (url.pathname === '/top' && request.method === 'GET')
      return json(env, await topRows(env, url.searchParams.get('by')));

    if (url.pathname === '/sync' && request.method === 'POST'){
      if (!env.BOT_TOKEN) return json(env, { error: 'BOT_TOKEN не задан' }, 500);

      let body;
      try { body = await request.json(); } catch(e){ return json(env, { error: 'плохой json' }, 400); }

      const user = await checkInitData(body.initData || '', env.BOT_TOKEN);
      if (!user || !user.id) return json(env, { error: 'подпись не сошлась' }, 403);

      const score = Number(body.score);
      if (!isFinite(score) || score < 0 || score > SCORE_CAP)
        return json(env, { error: 'странный результат' }, 400);

      const now = Math.floor(Date.now() / 1000);
      const prev = await env.DB.prepare(
        'SELECT score, updated FROM players WHERE id = ?1').bind(user.id).first();

      // Результат только растёт, и не чаще раза в MIN_GAP секунд.
      // От честной накрутки это не спасает — счёт считает клиент, — но
      // отсекает случайные откаты и долбёжку запросами.
      const fresh = !prev || (score > prev.score && now - prev.updated >= MIN_GAP);

      // Сила и здоровье обновляются всегда, даже если счёт не вырос:
      // иначе прокачанная вещь не попадёт в драку до следующего заработка.
      const power  = clamp(body.power,  0, 100000);
      const health = clamp(body.health, 100, 1000000);

      if (fresh || !prev){
        await env.DB.prepare(
          `INSERT INTO players (id, name, score, runs, path, updated, power, health)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(id) DO UPDATE SET
             name = ?2, score = ?3, runs = ?4, path = ?5, updated = ?6, power = ?7, health = ?8`
        ).bind(user.id, displayName(user), score,
               Number(body.runs) || 0, String(body.path || '').slice(0, 20), now,
               power, health).run();
      } else {
        await env.DB.prepare(
          'UPDATE players SET name = ?2, power = ?3, health = ?4 WHERE id = ?1'
        ).bind(user.id, displayName(user), power, health).run();
      }

      const place = await env.DB.prepare(
        'SELECT COUNT(*) + 1 AS p FROM players WHERE score > (SELECT score FROM players WHERE id = ?1)'
      ).bind(user.id).first('p');

      const mine = await env.DB.prepare('SELECT bp FROM players WHERE id = ?1').bind(user.id).first();
      return json(env, { ...(await topRows(env, body.by)),
                         me: { id: user.id, place: place || null, bp: mine ? mine.bp : 1000 } });
    }

    if (url.pathname === '/fight' && request.method === 'POST'){
      if (!env.BOT_TOKEN) return json(env, { error: 'BOT_TOKEN не задан' }, 500);
      let body;
      try { body = await request.json(); } catch(e){ return json(env, { error: 'плохой json' }, 400); }

      const user = await checkInitData(body.initData || '', env.BOT_TOKEN);
      if (!user || !user.id) return json(env, { error: 'подпись не сошлась' }, 403);

      const me = await env.DB.prepare(
        'SELECT id, name, power, health, bp, last_fight FROM players WHERE id = ?1').bind(user.id).first();
      if (!me) return json(env, { error: 'сначала поиграй' }, 400);
      if (me.power <= 0) return json(env, { error: 'нечем драться: прокачай хотя бы одну вещь' }, 400);

      const now = Math.floor(Date.now() / 1000);
      const wait = FIGHT_COOLDOWN - (now - me.last_fight);
      if (wait > 0) return json(env, { error: 'рано', wait }, 429);

      // Противника выбирает игрок в таблице лидеров, сервер только проверяет,
      // что тот существует, это не он сам и ему есть чем отвечать.
      const targetId = Number(body.target);
      if (!targetId || targetId === me.id)
        return json(env, { error: 'выбери противника в таблице' }, 400);

      const enemy = await env.DB.prepare(
        'SELECT id, name, power, health, bp FROM players WHERE id = ?1').bind(targetId).first();
      if (!enemy) return json(env, { error: 'такого игрока нет' }, 404);

      const r = resolveFight(me, enemy);
      const delta = bpDelta(me, enemy, r.win);
      const myBp = Math.max(0, me.bp + delta);
      const foeBp = Math.max(0, enemy.bp - delta);

      // Уведомляем не чаще раза в NOTIFY_GAP: серия драк не должна
      // превращаться в серию сообщений.
      const foeRow = await env.DB.prepare(
        'SELECT notified FROM players WHERE id = ?1').bind(enemy.id).first();
      const tellHim = !foeRow || (now - (foeRow.notified || 0) >= NOTIFY_GAP);

      await env.DB.batch([
        env.DB.prepare('UPDATE players SET bp = ?2, last_fight = ?3 WHERE id = ?1').bind(me.id, myBp, now),
        env.DB.prepare('UPDATE players SET bp = ?2' + (tellHim ? ', notified = ?3' : '') + ' WHERE id = ?1')
          .bind(...(tellHim ? [enemy.id, foeBp, now] : [enemy.id, foeBp]))
      ]);

      if (tellHim && ctx && ctx.waitUntil)
        ctx.waitUntil(notifyAttacked(env, enemy, me.name, !r.win, delta));

      return json(env, {
        win: r.win, rounds: r.rounds, left: r.left, delta, bp: myBp,
        enemy: { name: enemy.name, power: enemy.power, health: enemy.health, bp: enemy.bp }
      });
    }

    return json(env, { error: 'нет такой ручки' }, 404);
  }
};
