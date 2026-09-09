/* Версии в адресах css и js: index.html?v=<хэш содержимого>.

   Зачем. GitHub Pages отдаёт всё с Cache-Control: max-age=600 и настроить это
   нельзя. Файлы скачиваются в разное время, поэтому окна протухания разъезжаются,
   и клиент может держать свежий index.html вместе со старым style.css. Разметка
   новая, стилей на неё нет, а js падает на функции, которой в старой версии ещё
   не было. В Telegram Desktop это выглядит как поехавший интерфейс, при том что
   на телефоне всё в порядке — там файлы скачались разом.

   Хэш считается от содержимого каждого файла отдельно: не изменившийся файл
   сохраняет адрес и остаётся в кэше, изменившийся получает новый и скачивается.

   Запуск:  node tools/stamp.js
   Гонять перед каждым коммитом, который меняет css или js. Иначе часть игроков
   получит смесь версий. */

const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

const hash = rel => crypto.createHash('md5')
  .update(fs.readFileSync(path.join(ROOT, rel)))
  .digest('hex').slice(0, 8);

let html = fs.readFileSync(HTML, 'utf8');
let changed = 0;

// href="css/style.css" и src="js/ui.js", с уже проставленной версией или без
html = html.replace(/(href|src)="((?:css|js)\/[\w.-]+)(?:\?v=[a-f0-9]+)?"/g, (m, attr, rel) => {
  const v = hash(rel);
  const out = `${attr}="${rel}?v=${v}"`;
  if (out !== m) changed++;
  return out;
});

fs.writeFileSync(HTML, html, 'utf8');

const stamped = [...html.matchAll(/(?:href|src)="((?:css|js)\/[\w.-]+)\?v=([a-f0-9]+)"/g)];
for (const [, rel, v] of stamped) console.log('  ' + v + '  ' + rel);
console.log(changed ? `обновлено адресов: ${changed}` : 'всё уже актуально');
