/* Telegram Mini App: подгонка под клиент Telegram.
   Порядок подключения задан в index.html и важен: это обычные скрипты,
   а не модули — всё живёт в общей области видимости. */

/* Всё здесь необязательное. Открытая двойным кликом или в обычном браузере
   игра не должна ничего заметить, поэтому каждый вызов защищён. */
const TG = (() => {
  const api = (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null;
  if (!api) return null;
  // Скрипт Telegram создаёт WebApp даже в обычном браузере, но platform там
  // 'unknown'. Без этой проверки вибрация ушла бы в заглушку Telegram и
  // перестала работать на Android вне мессенджера.
  if (!api.platform || api.platform === 'unknown') return null;

  // Версии клиента разные, старые методы просто отсутствуют
  const call = (name, ...args) => { try { if (typeof api[name] === 'function') api[name](...args); } catch(e){} };

  call('ready');
  call('expand');

  // Без этого вертикальный свайп по игровому полю тянет и закрывает окно.
  // Для тапалки это обязательный вызов, а не украшение. Bot API 7.7+
  call('disableVerticalSwipes');

  // Шапка и фон под палитру игры, иначе поверх тёмного экрана светлая полоса
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#14100E';
  call('setHeaderColor', bg);
  call('setBackgroundColor', bg);

  return api;
})();

/* Облачное хранилище Telegram: данные привязаны к аккаунту, поэтому один забег
   на телефоне и на компьютере. Появилось в Bot API 6.9 — на клиентах постарше
   просто не включаем, игра продолжает жить на локальном хранилище.

   Store остаётся единственным местом, знающим, где живут данные: здесь только
   переходник к нему. */
if (TG && TG.CloudStorage && TG.isVersionAtLeast && TG.isVersionAtLeast('6.9')){
  Store.useRemote({
    get(key, cb){ TG.CloudStorage.getItem(key, cb); },
    set(key, value){ TG.CloudStorage.setItem(key, value, () => {}); },
    remove(key){ TG.CloudStorage.removeItem(key, () => {}); }
  });
}

/* Вибрация. В Telegram она идёт через их API и работает на iPhone,
   где navigator.vibrate из браузера недоступен. Снаружи Telegram
   остаётся прежнее поведение. */
haptic = function(pattern){
  if (TG && TG.HapticFeedback){
    try {
      if (Array.isArray(pattern)) TG.HapticFeedback.notificationOccurred('success');
      else TG.HapticFeedback.impactOccurred(pattern <= 10 ? 'light' : 'medium');
      return;
    } catch(e){}
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate){
    try { navigator.vibrate(pattern); } catch(e){}
  }
};
