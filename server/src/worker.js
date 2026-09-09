/* Рейтинг «Под солнцем» — Cloudflare Worker.

   Две ручки:
     POST /sync  { initData, score, runs, path }  -> { place, total, top:[...] }
     GET  /top                                     -> { total, top:[...] }

   Здесь модульный синтаксис, в отличие от самой игры: это другой рантайм,
   а не браузер с file://, и запрет на ES-модули из CLAUDE.md сюда не относится.

   Токен бота живёт в секрете BOT_TOKEN и в репозиторий не попадает:
     wrangler secret put BOT_TOKEN
*/

const TOP_SIZE = 20;
const MAX_AGE = 24 * 3600;      // initData старше суток не принимаем
const MIN_GAP = 10;             // не чаще раза в 10 секунд от одного игрока
const SCORE_CAP = 1e30;         // выше этого — явно подделка, а не игра

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

async function topRows(env){
  const { results } = await env.DB.prepare(
    'SELECT id, name, score, runs, path FROM players ORDER BY score DESC LIMIT ?1'
  ).bind(TOP_SIZE).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first('n');
  return { total: total || 0, top: (results || []).map((r, i) => ({ place: i + 1, ...r })) };
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    if (url.pathname === '/top' && request.method === 'GET')
      return json(env, await topRows(env));

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

      if (fresh){
        await env.DB.prepare(
          `INSERT INTO players (id, name, score, runs, path, updated)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT(id) DO UPDATE SET
             name = ?2, score = ?3, runs = ?4, path = ?5, updated = ?6`
        ).bind(user.id, displayName(user), score,
               Number(body.runs) || 0, String(body.path || '').slice(0, 20), now).run();
      }

      const place = await env.DB.prepare(
        'SELECT COUNT(*) + 1 AS p FROM players WHERE score > (SELECT score FROM players WHERE id = ?1)'
      ).bind(user.id).first('p');

      return json(env, { ...(await topRows(env)), me: { id: user.id, place: place || null } });
    }

    return json(env, { error: 'нет такой ручки' }, 404);
  }
};
