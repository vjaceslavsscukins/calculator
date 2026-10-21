"""Страница «База модулей: предложение для утверждения» из variants_dedup.json. Запуск: python3 proposal.py variants.json out.html"""
import sys, json, collections, statistics, html

rows = [r for r in json.load(open(sys.argv[1])) if r['W'] <= 1300]
kitchens = len({r['kitchen'] for r in json.load(open(sys.argv[1]))})
esc = html.escape

# (id, уровень, раскладки, название, текст для КП, рекомендация, заметка)
ENTRIES = [
 ('Н1', 'low', ['Д'], 'Нижний шкаф с дверцей', 'Нижний шкаф с одной распашной дверцей и полкой, петли с доводчиком.', 'оставить', 'Самый частый модуль. Петли слева или справа выбираются в модуле.'),
 ('Н2', 'low', ['Д×2'], 'Нижний шкаф с двумя дверцами', 'Нижний шкаф с двумя распашными дверцами и полкой, петли с доводчиком.', 'оставить', 'Под мойку и варочную: вырез в столешнице как оснащение этого модуля.'),
 ('Н3', 'low', ['Я / Я'], 'Нижний шкаф с двумя ящиками', 'Нижний шкаф с двумя полного выдвижения ящиками с доводчиком.', 'оставить', 'Вариант «с внутренним ящиком» (в верхнем ящике) отмечается опцией, не отдельным модулем.'),
 ('Н4', 'low', ['Я / Я / Я'], 'Нижний шкаф с тремя ящиками', 'Нижний шкаф с тремя ящиками полного выдвижения: два низких и один глубокий.', 'оставить', ''),
 ('Н5', 'low', ['Я / Я / Я / Я', 'Я / Я / Я / Я / Я'], 'Нижний шкаф с четырьмя ящиками', 'Нижний шкаф с четырьмя ящиками полного выдвижения.', 'можно оставить', 'Встречается редко (5 раз).'),
 ('Н6', 'low', ['Я'], 'Нижний шкаф с одним ящиком', 'Нижний шкаф с одним глубоким ящиком полного выдвижения.', 'спорно', 'Высоты в моделях разные (в том числе 120 мм), похоже на тумбы под технику. Предлагаю убрать в конструктор.'),
 ('Н7', 'low', ['без фасада'], 'Нижний открытый (без фасада)', 'Нижний открытый модуль с полками без фасада.', 'оставить', 'Ниша под технику (духовка, микроволновка, холодильник) делается этим же модулем с оснащением.'),
]
UP = [
 ('В1', 'up', ['Д'], 'Верхний шкаф с дверцей', 'Верхний шкаф с одной распашной дверцей и полками.', 'оставить', 'Высота и отметка низа задаются в модуле: в моделях от 600 до 1100 мм, обычно до потолка.'),
 ('В2', 'up', ['Д / Д'], 'Верхний шкаф с двумя фасадами по высоте', 'Высокий верхний шкаф с двумя дверцами одна над другой.', 'оставить', 'Высота 1050–1250 мм; нижний фасад может быть с подъёмником.'),
 ('В3', 'up', ['Д×2'], 'Верхний шкаф с двумя дверцами', 'Верхний шкаф с двумя распашными дверцами и полками.', 'оставить', ''),
 ('В4', 'up', ['Д×2 / Д×2', 'Д / Д×2'], 'Верхний шкаф с четырьмя дверцами (два яруса)', 'Верхний шкаф в два яруса, по две дверцы в ярусе.', 'можно оставить', ''),
 ('В5', 'up', ['без фасада'], 'Верхний открытый', 'Верхний открытый модуль с полками.', 'оставить', ''),
]
TALL = [
 ('П1', 'tall', ['Д'], 'Пенал с одной дверью', 'Пенал с одной дверью на всю высоту.', 'оставить', 'Высота пенала в моделях 2000–2990 мм.'),
 ('П2', 'tall', ['Д / Д'], 'Пенал с двумя дверями по высоте', 'Пенал с двумя дверями одна над другой.', 'оставить', 'Один из частых.'),
 ('П3', 'tall', ['Д / Д / Д'], 'Пенал с тремя дверями по высоте', 'Пенал с тремя дверями по высоте.', 'оставить', 'Нижние двери часто под холодильник.'),
 ('П4', 'tall', ['Д / Д / Я', 'Д / Я'], 'Пенал с дверями и ящиком внизу', 'Пенал с дверями и выдвижным ящиком внизу.', 'оставить', ''),
 ('П5', 'tall', ['Я / Я', 'Я / Я / Я'], 'Пенал с ящиками', 'Пенал с выдвижными ящиками.', 'оставить', ''),
 ('П6', 'tall', ['без фасада'], 'Пенал под технику (ниши)', 'Пенал с нишами под встраиваемую технику.', 'оставить', 'Духовка, микроволновка: оснащение секции.'),
]
MEZZ = [
 ('А1', 'mezz', ['Д'], 'Антресоль с дверцей', 'Антресоль над верхним рядом с одной дверцей.', 'оставить', 'Часто с подъёмником (16 из 28).'),
 ('А2', 'mezz', ['Д×2'], 'Антресоль с двумя дверцами', 'Антресоль с двумя дверцами.', 'оставить', 'Ширина 900–1200.'),
 ('А3', 'mezz', ['Д / Д'], 'Антресоль с двумя фасадами по высоте', 'Двухъярусная антресоль.', 'можно оставить', 'Редкий.'),
 ('А4', 'mezz', ['без фасада'], 'Антресоль открытая', 'Открытая антресоль.', 'оставить', ''),
]
GROUPS = [('Нижние модули', ENTRIES), ('Верхние модули', UP), ('Пеналы', TALL), ('Антресоли', MEZZ)]

def top(c, n=5, fmt=lambda k: str(k)):
    return ', '.join(f'{fmt(k)} ({v})' for k, v in c.most_common(n))

def scheme(r):
    """Схема фасада: ряды сверху вниз по раскладке и высотам фасадов."""
    fs = sorted(r['facades'], key=lambda f: -f[3]); rowsx = []
    for f in fs:
        if rowsx and abs(rowsx[-1][0][3] - f[3]) < min(f[1], rowsx[-1][0][1]) / 2: rowsx[-1].append(f)
        else: rowsx.append([f])
    Wd, Hd = 120.0, 120.0 * r['H'] / max(r['W'], 1)
    Hd = max(60.0, min(Hd, 190.0))
    sc = min(Hd / r['H'], 120.0 / r['W'])
    w, h = r['W'] * sc, r['H'] * sc; ox, oy = (150 - w) / 2, 8
    s = f'<rect x="{ox:.1f}" y="{oy}" width="{w:.1f}" height="{h:.1f}" rx="2" class="body"/>'
    tot = sum(max(rw[0][1], 1) for rw in rowsx) or 1; y = oy + 2
    for rw in rowsx:
        rh = (h - 4) * max(rw[0][1], 1) / tot; n = len(rw); cw = (w - 4) / n
        for i, f in enumerate(rw):
            x = ox + 2 + i * cw
            s += f'<rect x="{x + 1:.1f}" y="{y + 1:.1f}" width="{cw - 2:.1f}" height="{rh - 2:.1f}" rx="1.5" class="fac"/>'
            if f[2] == 'Я': s += f'<line x1="{x + cw / 2 - 8:.1f}" x2="{x + cw / 2 + 8:.1f}" y1="{y + 6:.1f}" y2="{y + 6:.1f}" class="hd"/>'
            else:
                hx = x + (cw - 6 if i == 0 and n > 1 or n == 1 else 6); s += f'<line x1="{hx:.1f}" x2="{hx:.1f}" y1="{y + rh / 2 - 6:.1f}" y2="{y + rh / 2 + 6:.1f}" class="hd"/>'
        y += rh
    return f'<svg viewBox="0 0 150 {h + 16:.0f}" role="img" aria-label="Схема фасада">{s}</svg>'

def card(e):
    id_, lv, lays, name, kp, rec, note = e
    v = [r for r in rows if r['level'] == lv and r['layout'] in lays]
    if id_ == 'Н7': v = [r for r in v if not r['bottle']]
    if not v: return ''
    ks = len({r['kitchen'] for r in v})
    pool = [r for r in v if r['W'] <= 1000 and r['facades']] or [r for r in v if r['facades']] or v
    medW = statistics.median(r['W'] for r in pool); rep = min(pool, key=lambda r: (abs(r['W'] - medW), abs(r['H'] - statistics.median(x['H'] for x in pool))))
    W = collections.Counter(r['W'] for r in v); H = collections.Counter(r['H'] for r in v); D = collections.Counter(r['D'] for r in v)
    gola = sum(r['gola'] for r in v); lift = sum(r['lift'] for r in v); inner = sum(r['inner'] for r in v)
    sys_ = collections.Counter(s for r in v for s in r['boxsys']); hin = collections.Counter(k for r in v for k, n in r['hinges'].items() for _ in range(1 if n else 0))
    legs = collections.Counter(l for r in v for l in r['legs'])
    wr = sorted(W)
    cls = {'оставить': 'ok', 'можно оставить': 'ok2', 'спорно': 'warn'}.get(rec, 'ok')
    rows_ = [('Ширины', f'{wr[0]}–{wr[-1]}; чаще: ' + top(W, 6)), ('Высота корпуса', top(H, 4)), ('Глубина', top(D, 3))]
    if lv == 'up' or lv == 'mezz' or lv == 'tall':
        y0 = collections.Counter(r['y0'] for r in v); rows_.append(('Низ от пола', top(y0, 3)))
    rows_.append(('Gola', f'{gola} из {len(v)}'))
    if sys_: rows_.append(('Ящики', top(sys_, 4)))
    if hin: rows_.append(('Петли', top(hin, 3)))
    if lift: rows_.append(('С подъёмником', f'{lift}'))
    if inner: rows_.append(('С внутренним ящиком', f'{inner}'))
    if lv == 'low' and legs: rows_.append(('Ножки', top(legs, 3, lambda k: f'{k} мм')))
    t = ''.join(f'<tr><th>{esc(a)}</th><td>{esc(b)}</td></tr>' for a, b in rows_)
    return f'''<article class="card">
  <div class="top"><span class="id">{id_}</span><span class="tag {cls}">{esc(rec)}</span></div>
  <h3>{esc(name)}</h3>
  <div class="cnt">{len(v)} модулей в {ks} кухнях</div>
  <div class="vis">{scheme(rep)}<div class="repdim">пример: {rep['W']}×{rep['H']}×{rep['D']}</div></div>
  <table>{t}</table>
  <p class="kp"><b>В КП:</b> {esc(kp)}</p>
  {f'<p class="note">{esc(note)}</p>' if note else ''}
</article>'''

sections = ''
for title, es in GROUPS:
    cs = ''.join(card(e) for e in es)
    n = sum(1 for r in rows if r['level'] == es[0][1])
    sections += f'<section><h2>{title} <span class="n">{n} в моделях</span></h2><div class="grid">{cs}</div></section>'

bottle = len([r for r in rows if r['level'] == 'low' and r['bottle']])
html_out = f'''<title>База модулей</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{{--bg:#F6F4EF;--surface:#FFFFFF;--fg:#26231E;--muted:#6B655B;--line:#E2DDD2;--accent:#A9532A;--ok:#3F7D4E;--ok2:#7A7A2E;--warn:#B5651D;--fac:#EFEAE0;--body:#D9D2C3;--ink:#4A463F}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#1B1A17;--surface:#24231F;--fg:#ECE8DF;--muted:#A39C8E;--line:#37342D;--accent:#E08A5C;--ok:#7CC48E;--ok2:#C8C870;--warn:#E8A15C;--fac:#34312A;--body:#4A463C;--ink:#CFC8B8;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#1B1A17;--surface:#24231F;--fg:#ECE8DF;--muted:#A39C8E;--line:#37342D;--accent:#E08A5C;--ok:#7CC48E;--ok2:#C8C870;--warn:#E8A15C;--fac:#34312A;--body:#4A463C;--ink:#CFC8B8;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding-block:28px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}}
main{{max-width:1180px;margin:0 auto}}
h1{{font-size:26px;margin:0 0 6px;text-wrap:balance}} h2{{font-size:19px;margin:34px 0 12px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}} h2 .n{{font-size:13px;color:var(--muted);font-weight:400}}
.lead{{color:var(--muted);max-width:70ch;margin:0 0 14px}} .how{{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;max-width:78ch}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:8px;min-width:0}}
.top{{display:flex;justify-content:space-between;align-items:center}} .id{{font:600 13px ui-monospace,monospace;color:var(--accent)}}
.tag{{font-size:12px;border:1px solid currentColor;border-radius:99px;padding:1px 9px}} .tag.ok{{color:var(--ok)}} .tag.ok2{{color:var(--ok2)}} .tag.warn{{color:var(--warn)}}
.card h3{{margin:0;font-size:16px;text-wrap:balance}} .cnt{{color:var(--muted);font-size:13px}}
.vis{{background:var(--bg);border-radius:10px;padding:8px;text-align:center}} .vis svg{{max-width:100%;height:150px}} .repdim{{font-size:12px;color:var(--muted)}}
.body{{fill:var(--body);stroke:var(--ink);stroke-width:.8}} .fac{{fill:var(--fac);stroke:var(--ink);stroke-width:.6}} .hd{{stroke:var(--ink);stroke-width:1.6;stroke-linecap:round}}
table{{border-collapse:collapse;font-size:13px;width:100%}} th{{text-align:left;color:var(--muted);font-weight:400;padding:3px 8px 3px 0;white-space:nowrap;vertical-align:top}} td{{padding:3px 0;overflow-wrap:anywhere}}
.kp{{margin:4px 0 0;font-size:13px}} .note{{margin:0;font-size:13px;color:var(--muted)}}
ul{{max-width:78ch;padding-left:20px}} li{{margin:4px 0}}
</style>
<main>
<h1>База модулей: предложение для утверждения</h1>
<p class="lead">Разобрано {kitchens} кухонь из моделей Базиса Лидии (около 600 модулей). Ниже варианты модулей, которые я предлагаю сделать в библиотеке. Числа в карточках из реальных кухонь: сколько раз такой модуль встречается, какие у него ширины, высоты и что стоит внутри.</p>
<div class="how"><b>Как ответить.</b> Напишите коротко, например: «оставить всё, Н6 убрать, В4 убрать, пеналы оставить». Метка «оставить» мой совет, «спорно» значит я не уверен.<br>
Открывание (ручка, Gola, Push), ножки (100/150), система ящиков (Blum, Hettich, Firmax), петли слева/справа, мойка, варочная и духовка — это <b>опции модуля</b>, а не отдельные модули.</div>
{sections}
<section><h2>Отдельно</h2><ul>
<li><b>Бутылочница</b> ({bottle} в моделях): узкий нижний модуль 150–300 мм с выдвижной корзиной. Оставить.</li>
<li><b>Посудомойка</b>: в моделях это фасад на встроенную технику, отдельного модуля нет. Предлагаю фасад ПММ как оснащение нижнего модуля шириной 450 или 600.</li>
<li><b>Угловые</b>: в моделях угловой модуль собирается из нескольких обычных (глухая часть + фальшпланка). Предлагаю один угловой модуль с глухой частью и угловой фальшпланкой по умолчанию (как сейчас в программе).</li>
<li><b>Планки и доборы</b> (в моделях очень частые): фасадная планка (206 раз, ширины 50, 90, 100, 250), проставка (143, чаще 80), фальш-фасад (68), планка на верх (62), цоколь (36, высота 98 или 148 мм под ножки 100 и 150), заглушка (89), фальш-бок (21). Предлагаю отдельный список планок и доборов с размером, материалом и количеством, как «Планки и доборы» в смете.</li>
<li><b>Широкие и составные</b> модули (острова, тумбы 1300–2100 мм, антресоли на всю стену, шкафы-купе): сюда относятся 42 модуля. Их предлагаю делать конструктором нестандартного модуля, а не библиотекой.</li>
</ul></section>
<section><h2>Что заметил в данных</h2><ul>
<li>Фурнитура ящиков в этих кухнях: Hettich (Atira, Quadro, Actro) и Firmax Newline, Blum почти нет. В библиотеке система ящиков выбирается у модуля.</li>
<li>Верхние шкафы почти всегда с Gola (у Д — 75 из 75) и тянутся высоко (700–1250 мм), низ около 1450–1530 мм от пола; высота задаётся параметром.</li>
<li>Нижние шкафы с Gola выше на 60 мм, ножки 100 или 150 мм.</li>
<li>Внутренний ящик есть у {sum(1 for r in rows if r['inner'])} модулей.</li>
</ul></section>
</main>'''
open(sys.argv[2], 'w', encoding='utf8').write(html_out)
print('готово', len(html_out))
