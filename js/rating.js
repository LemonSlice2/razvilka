/* Рейтинг: общение с сервером в server/.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости.

   Игра остаётся играбельной без сети и без сервера. Если адрес не задан,
   Telegram не дал initData или сервер молчит — просто нет таблицы, всё
   остальное работает как раньше. */

// Адрес воркера. Пустая строка = рейтинг выключен.
// Заполняется после деплоя, см. server/README.md
const RATING_URL = 'https://pod-solncem-rating.sedin1nikolay.workers.dev';

const Rating = (() => {
  const EVERY = 60000;      // не чаще раза в минуту: результат меняется медленно
  const TIMEOUT = 8000;

  let state = { status: 'off', top: [], me: null, total: 0 };
  let lastTry = 0, inFlight = false;

  function reason(){
    if (!RATING_URL) return 'not-configured';
    if (!TG || !TG.initData) return 'no-telegram';
    return null;
  }

  async function pull(){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(RATING_URL.replace(/\/$/, '') + '/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: TG.initData,
          score: S.stats.earnedTotal,
          runs: S.runs,
          path: S.path
        }),
        signal: ctrl.signal
      });
      // 403 — это не «сервер лежит», а «подпись не сошлась»: обычно значит,
      // что на сервере лежит токен, который уже отозвали в BotFather.
      // Разные причины должны выглядеть по-разному, иначе чинишь наугад.
      if (res.status === 403) return { status: 'bad-signature', top: [], me: null, total: 0 };
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { status: 'ok', top: data.top || [], me: data.me || null, total: data.total || 0 };
    } finally { clearTimeout(timer); }
  }

  return {
    get state(){ return state; },

    /* Возвращает true, только если данные реально поменялись — тогда экран
       перерисовывается ещё раз. Иначе перерисовка звала бы обновление,
       обновление перерисовку, и так по кругу. */
    async refresh(){
      const off = reason();
      if (off){
        if (state.status === off) return false;
        state = { status: off, top: [], me: null, total: 0 };
        return true;
      }
      if (!S || !S.path) return false;
      if (inFlight || Date.now() - lastTry < EVERY) return false;

      inFlight = true; lastTry = Date.now();
      try {
        const fresh = await pull();
        const same = JSON.stringify(fresh) === JSON.stringify(state);
        state = fresh;
        return !same;
      } catch(e){
        if (state.status === 'error') return false;
        state = { status: 'error', top: [], me: null, total: 0 };
        return true;
      } finally { inFlight = false; }
    }
  };
})();
