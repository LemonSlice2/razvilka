/* Запуск: автосохранение, стирание прогресса, старт игры.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* ---------- запуск ---------- */
function save(){ if (!S) return; S.ts = Date.now(); Store.save(S); }

function boot(){
  const saved = Store.load();
  if (saved && saved.path && PATHS.some(p => p.id === saved.path)){
    S = saved;
    Object.assign(S, { perks: saved.perks || [] });
    const cap = OFFLINE_CAP * (perk('birzha') ? 2.5 : 1) + metaLevel('pamyat') * 4 * 3600;
    const elapsed = Math.min((Date.now() - (saved.ts || Date.now())) / 1000, cap);
    if (S.totalEarned === undefined) S.totalEarned = S.money || 0;
    Object.assign(S, carryOf(S));
    if (S.path && !S.stats.paths.includes(S.path)) S.stats.paths.push(S.path);
    const earned = perSecond() * elapsed;
    S.money += earned; S.totalEarned += earned;
    S.focus = FOCUS_MAX;
    start(S, earned);
  } else {
    showChoice(saved && (saved.legacy || saved.legacyTotal || saved.runs) ? saved : null);
  }
  requestAnimationFrame(loop);
}

setInterval(save, 5000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('pagehide', save);

$('reset').addEventListener('click', async () => {
  const ok = await ask('Стереть всё?',
    'Пропадёт вообще весь прогресс: влияние, открытые пути и текущий забег. Отменить будет нельзя.',
    'Стереть');
  if (!ok) return;
  Store.clear();
  showChoice(null);
});

boot();
