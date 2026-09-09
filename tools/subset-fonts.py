# -*- coding: utf-8 -*-
"""
Урезание шрифтов до символов, которые реально встречаются в игре.

Полные шрифты Google тащат все европейские диакритики и служебные знаки —
для игры это лишние сотни килобайт на первом открытии в Telegram.

Запуск:  python tools/subset-fonts.py
Нужен:   pip install fonttools brotli
Гонять после того, как в игре появились новые символы — например новый путь
с необычным знаком в названии. Иначе символ просто не отрисуется.
"""
import os, re, glob, subprocess, sys, urllib.request

# Консоль Windows по умолчанию не в UTF-8, иначе весь вывод — каша
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'fonts')
CACHE = os.path.join(FONTS, '_source')

SOURCES = [
    ('GolosText[wght].ttf',      'golostext'),
    ('PT_Serif-Web-Regular.ttf', 'ptserif'),
    ('PT_Serif-Web-Bold.ttf',    'ptserif'),
]
OUT = {
    'GolosText[wght].ttf':      'golos.woff2',
    'PT_Serif-Web-Regular.ttf': 'ptserif-400.woff2',
    'PT_Serif-Web-Bold.ttf':    'ptserif-700.woff2',
}

# Базовый набор: весь русский алфавит целиком, а не только встреченные буквы.
# Тексты меняются чаще, чем кто-то вспоминает про этот скрипт.
BASE = set(
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
    'abcdefghijklmnopqrstuvwxyz'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    '0123456789'
    ' .,:;!?-—–…()[]{}«»""\'\u2019/|@#$%^&*_+=<>~`'
    '×·✦№°'
)

def used_chars():
    chars = set()
    for pat in ('index.html', 'css/*.css', 'js/*.js'):
        for path in glob.glob(os.path.join(ROOT, pat)):
            with open(path, encoding='utf-8') as f:
                chars |= set(f.read())
    # из кода в интерфейс попадают только печатаемые знаки
    return {c for c in chars if c.isprintable() and c != ' '}

def fetch(name, family):
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, name)
    if os.path.exists(dst):
        return dst
    url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/%s/%s' % (family, name)
    print('  качаю', name)
    urllib.request.urlretrieve(url, dst)
    return dst

def main():
    chars = sorted(BASE | used_chars())
    unicodes = ','.join('U+%04X' % ord(c) for c in chars)
    print('символов в наборе:', len(chars))

    total_before = total_after = 0
    for name, family in SOURCES:
        src = fetch(name, family)
        dst = os.path.join(FONTS, OUT[name])
        before = os.path.getsize(src)
        subprocess.run([
            sys.executable, '-m', 'fontTools.subset', src,
            '--unicodes=' + unicodes,
            '--layout-features=kern,liga,calt,tnum',
            '--flavor=woff2',
            '--output-file=' + dst,
        ], check=True)
        after = os.path.getsize(dst)
        total_before += before; total_after += after
        print('  %-26s %4d КБ -> %3d КБ' % (OUT[name], before // 1024, after // 1024))

    print('-----')
    print('итого %d КБ -> %d КБ' % (total_before // 1024, total_after // 1024))

if __name__ == '__main__':
    main()
