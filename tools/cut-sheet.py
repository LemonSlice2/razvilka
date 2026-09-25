# -*- coding: utf-8 -*-
"""Нарезка листа иконок из нейросети на отдельные webp с прозрачным фоном.

Раньше это делалось в браузере через canvas, потому что на машине не было
ни ffmpeg, ни ImageMagick. Pillow оказался установлен — он делает то же самое
скриптом, повторяемо и без открытого браузера.

Фон вычищается заливкой от краёв, а не заменой цвета по всему кадру: у знаков
чёрный контур, и глобальная замена по близости съела бы его вместе с фоном.
Заливка от края трогает только то, что с краем связано.

Сетку модель держит плохо: просили 4x2, пришло 4x4 с повторами. Поэтому нужные
клетки перечисляются вручную парами (ряд, столбец) — так лист любой разметки
можно разобрать, не переспрашивая модель.

Запуск:  python tools/cut-sheet.py
"""
import os
from PIL import Image, ImageDraw

HERE  = os.path.dirname(os.path.abspath(__file__))
ROOT  = os.path.dirname(HERE)
SHEET = os.path.join(ROOT, 'img', '_source', 'ranks-sheet.webp')
OUT   = os.path.join(ROOT, 'img')

COLS, ROWS = 4, 4        # какая сетка пришла на самом деле
SEAM       = 10          # сколько пикселей от края клетки отрезать: там шов
TOLERANCE  = 34          # допуск заливки. Больше — съест контур, меньше — оставит кайму
MARGIN     = 0.06        # поля вокруг знака, доля от стороны
SIZE       = 128         # сторона готовой иконки

# (ряд, столбец, имя файла) — какую клетку куда. Порядок = порядок званий.
CELLS = [
    (0, 0, 'rank-rostok'),    # Первая жизнь — росток
    (0, 1, 'rank-pesok'),     # Вторая попытка — песочные часы
    (0, 2, 'rank-klyuch'),    # Кое-что помнит — ключ
    (0, 3, 'rank-karta'),     # Знает наизусть — свёрнутая карта
    (1, 0, 'rank-mayatnik'),  # Считает круги — маятник
    (1, 1, 'rank-uzel'),      # Сбился со счёта — спутанный узел
    (3, 2, 'rank-koltso'),    # Живёт по кругу — змея, кусающая хвост
    (1, 3, 'rank-solntse'),   # Ничего нового под солнцем — солнце
]


def cut(sheet, row, col):
    """Одна клетка: вырезать, выбить фон, обрезать по знаку, привести к квадрату."""
    w, h = sheet.size
    cw, ch = w // COLS, h // ROWS
    cell = sheet.crop((col * cw + SEAM, row * ch + SEAM,
                       (col + 1) * cw - SEAM, (row + 1) * ch - SEAM)).convert('RGB')

    # Цвет фона берём из угла клетки, а не задаём числом: у разных листов он
    # разный, и прошлый раз два листа пришли с несовпадающим фоном.
    orig_bg = cell.getpixel((0, 0))

    # Заливаем фон заведомо невозможным цветом от всех четырёх углов, потом
    # переводим его в прозрачность. Углы, а не один: знак может касаться края.
    KEY = (255, 0, 255)
    d = ImageDraw.Draw(cell)
    cw2, ch2 = cell.size
    for pt in [(0, 0), (cw2 - 1, 0), (0, ch2 - 1), (cw2 - 1, ch2 - 1)]:
        if cell.getpixel(pt) != KEY:
            ImageDraw.floodfill(cell, pt, KEY, thresh=TOLERANCE)

    # Второй проход по всему кадру. Заливка от углов не попадает внутрь замкнутых
    # фигур: у кольца-змеи середина оставалась залитой, и на фоне игры там
    # светлело пятно. Цвет фона далеко от чёрного контура (расстояние около 58),
    # поэтому допуска в 30 хватает, чтобы выбить фон и не тронуть обводку.
    bg = orig_bg
    out = cell.convert('RGBA')
    px = out.load()
    for y in range(ch2):
        for x in range(cw2):
            r, g, b = px[x, y][:3]
            if (r, g, b) == KEY:
                px[x, y] = (0, 0, 0, 0)
            elif (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2 <= 30 ** 2:
                px[x, y] = (0, 0, 0, 0)

    box = out.getbbox()
    if box:
        out = out.crop(box)

    # Квадрат с полями: иначе широкий знак и высокий сядут в интерфейсе по-разному
    side = int(max(out.size) * (1 + MARGIN * 2))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(out, ((side - out.size[0]) // 2, (side - out.size[1]) // 2), out)
    return sq.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    sheet = Image.open(SHEET)
    total = 0
    for row, col, name in CELLS:
        img = cut(sheet, row, col)
        path = os.path.join(OUT, name + '.webp')
        img.save(path, 'WEBP', quality=90, method=6)
        size = os.path.getsize(path)
        total += size
        print('  %-18s %5d байт' % (name + '.webp', size))
    print('всего: %d байт на %d иконок' % (total, len(CELLS)))


if __name__ == '__main__':
    main()
