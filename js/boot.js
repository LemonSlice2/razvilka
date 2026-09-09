/* Запуск: автосохранение, стирание прогресса, старт игры.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* ---------- запуск ---------- */
function save(){ if (!S) return; S.ts = Date.now(); Store.save(S); }

/* Войти в сохранение: досчитать офлайн-доход и открыть нужный экран.
   Одно и то же и для локального сейва при запуске, и для облачного,
   если игрок решит на него перейти. */
function enter(saved){
  resetSession();
  if (saved && saved.path && PATHS.some(p => p.id === saved.path)){
    S = saved;
    Object.assign(S, { perks: saved.perks || [] });
    const cap = OFFLINE_CAP * (perk('birzha') ? 2.5 : 1) + metaLevel('pamyat') * 4 * 3600;
    const elapsed = Math.min((Date.now() - (saved.ts || Date.now())) / 1000, cap);
    if (S.totalEarned === undefined) S.totalEarned = S.money || 0;
    Object.assign(S, carryOf(S));
    if (S.path && !S.stats.paths.includes(S.path)) S.stats.paths.push(S.path);
    const earned = perSecond() * elapsed;
    earn(earned);                       // через earn, иначе пройдёт мимо статистики
    S.focus = FOCUS_MAX;
    start(S, earned);
  } else {
    showChoice(saved && (saved.legacy || saved.legacyTotal || saved.runs) ? saved : null);
  }
}

/* ---------- сверка с облаком ----------
   Игра запускается сразу от локального сейва и не ждёт сети. Облако
   подтягивается следом, и если там прогресс дальше — спрашиваем.
   Молча подменять забег нельзя: человек мог только что играть здесь. */

function describeSave(st){
  if (!st) return 'пусто';
  const p = PATHS.find(x => x.id === st.path);
  const runs = st.runs || 0;
  return [
    runs + ' ' + plural(runs, 'перерождение', 'перерождения', 'перерождений'),
    p ? p.name + ', ' + fmt(st.money || 0) + '$' : 'на выборе пути',
    'влияние ' + (st.legacy || 0)
  ].join(' · ');
}

async function syncWithCloud(localTs){
  if (!Store.hasRemote) return;                 // без облака замок ни на что не влияет
  const cloud = await Store.pull();

  // Облако пустое или отстало — значит здешний забег и есть свежий
  if (!cloud || !cloud.ts || cloud.ts <= localTs + 5000){
    Store.allowPush(); save(); Store.pushNow();
    return;
  }

  const go = await ask('Прогресс с другого устройства',
    `<b>В облаке:</b> ${describeSave(cloud)}<br>обновлён ${whenAgo(cloud.ts)}<br><br>` +
    `<b>Здесь:</b> ${describeSave(S)}<br>` +
    `<br>Перейти к облачному? Здешний забег пропадёт.`,
    'Перейти');

  if (!go){                                     // остаёмся на своём и перебиваем облако
    Store.allowPush(); save(); Store.pushNow();
    return;
  }
  Store.allowPush();
  Store.save(cloud);
  enter(cloud);
}

function boot(){
  const saved = Store.load();
  // Метку берём до enter(): он вызывает start(), тот — save(), и S.ts
  // становится «сейчас». Сравнивать с облаком после этого бессмысленно,
  // любой чужой сейв окажется старше и локальный молча его перебьёт.
  const localTs = (saved && saved.ts) || 0;
  enter(saved);
  requestAnimationFrame(loop);
  syncWithCloud(localTs);
}

setInterval(save, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden){ save(); Store.pushNow(); } });
window.addEventListener('pagehide', () => { save(); Store.pushNow(); });

$('reset').addEventListener('click', async () => {
  const ok = await ask('Стереть всё?',
    'Пропадёт вообще весь прогресс: влияние, открытые пути и текущий забег. Отменить будет нельзя.',
    'Стереть');
  if (!ok) return;
  Store.clear();
  showChoice(null);
});

boot();
