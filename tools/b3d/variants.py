"""Сводка вариантов модулей для продаж: раскладка фасадов (двери, ящики по рядам), уровень, размеры, оснащение.
Запуск: python3 variants.py survey.json out.json"""
import sys, json, re, collections, statistics, os
sys.path.insert(0, os.path.dirname(__file__))
from classify import role

BOX_WORDS = ('atira', 'quadro', 'newline', 'actro', 'tandem', 'legrabox', 'avantech', 'antaro')

def brand_hinge(h):
    hl = h.lower()
    if 'sensys' in hl or 'hettich' in hl: return 'Hettich'
    if 'blum' in hl or 'clip' in hl or 'modul' in hl: return 'Blum'
    if 'firmax' in hl: return 'Firmax'
    return 'без марки'

def analyse(m):
    ps = m['panels']; hw = m['hw']
    sx, sy, sz = m['size']
    W, D = max(sx, sz), min(sx, sz)
    y0 = min([p['y'] for p in ps] or [0])
    facs = [p for p in ps if role(p) in ('facade', 'drawer_front')]
    hasbox = any(w in h.lower() for h in hw for w in BOX_WORDS) or any(role(p) == 'drawer_part' and p['name'].strip().upper() in ('ЗСЯ', 'БСЯ') for p in ps)
    names = [p['name'].strip() for p in facs]
    has_df = any(n.lower().startswith('фасад ящика') for n in names)
    items = []
    for p in facs:
        n = p['name'].strip().lower()
        w = max(p['x2'] - p['x'], p['z2'] - p['z']); h = p['y2'] - p['y']
        if n.startswith('фасад ящика'): t = 'Я'
        elif n.startswith('фасад заглушка') or 'сушк' in n or 'фальш' in n: t = None
        elif hasbox and not has_df: t = 'Я'
        else: t = 'Д'
        if t: items.append({'t': t, 'yc': (p['y'] + p['y2']) / 2, 'h': h, 'w': w, 'xc': (p['x'] + p['x2'] + p['z'] + p['z2']) / 2})
    items.sort(key=lambda i: -i['yc'])
    rows = []
    for it in items:
        if rows and abs(rows[-1][0]['yc'] - it['yc']) < min(it['h'], rows[-1][0]['h']) / 2: rows[-1].append(it)
        else: rows.append([it])
    layout = ' / '.join(f"{r[0]['t']}×{len(r)}" if len(r) > 1 else r[0]['t'] for r in rows) if rows else 'без фасада'
    lift = any(re.search(r'(?i)(aventos|подъ[её]мн|газ патрон|шток)', h) for h in hw)
    hinges = collections.Counter(brand_hinge(h) for h, v in hw.items() if re.search(r'(?i)петля', h) for _ in range(v))
    boxsys = sorted({nm for h in hw for key, nm in (('atira', 'Hettich Atira'), ('quadro', 'Hettich Quadro'), ('actro', 'Hettich Actro'), ('avantech', 'Hettich AvanTech'), ('newline', 'Firmax Newline'), ('tandem', 'Blum TANDEMBOX'), ('legrabox', 'Blum LEGRABOX')) if key in h.lower()})
    legs = sorted({int(re.search(r'(\d+)мм', h).group(1)) for h in hw if h.startswith('Ножка') and re.search(r'(\d+)мм', h)})
    inner = any('внутр' in h.lower() for h in hw) or any('внутр' in k.lower() for k in m.get('kids', []))
    gola = any(role(p) == 'profile' for p in ps) or any('gola' in p['name'].lower() for p in ps)
    appliance = [k for k in m.get('kids', []) if k in ('Техника',) or re.search(r'(?i)(духов|варочн|холодил|мойк|посудомо|вытяжк|сушк)', k)]
    shelves = sum(1 for p in ps if role(p) == 'shelf')
    bottle = any('бутыл' in k.lower() for k in m.get('kids', []))
    if sy >= 1500: level = 'tall'
    elif y0 >= 1900 and sy < 1100: level = 'mezz'
    elif y0 >= 800: level = 'up'
    else: level = 'low'
    return {'level': level, 'W': W, 'H': sy, 'D': D, 'y0': y0, 'layout': layout, 'rows': len(rows), 'drawers': sum(1 for i in items if i['t'] == 'Я'), 'doors': sum(1 for i in items if i['t'] == 'Д'),
            'lift': lift, 'hinges': dict(hinges), 'boxsys': boxsys, 'legs': legs, 'inner': inner, 'gola': gola, 'appliance': appliance, 'bottle': bottle, 'shelves': shelves, 'name': m['name'], 'section': m['section'],
            'facades': [(round(i['w']), round(i['h']), i['t'], round(i['yc'])) for i in items]}

if __name__ == '__main__':
    d = json.load(open(sys.argv[1])); rows = []
    for fid, mods in d.items():
        if isinstance(mods, str): continue
        for m in mods:
            a = analyse(m); a['file'] = fid; rows.append(a)
    if len(sys.argv) > 3:   # список файлов Битрикса (ID, NAME, SIZE): оставляем по каждой кухне самую большую версию файла
        meta = {x['ID']: x for x in json.load(open(sys.argv[3]))}
        key = lambda n: ('К-' + re.match(r'К-(\d+)', n).group(1)) if re.match(r'К-(\d+)', n) else re.sub(r'\s*\(\d+\)', '', n).replace('.b3d', '')
        best = {}
        for r in rows:
            k = key(meta[r['file']]['NAME'])
            if k not in best or int(meta[r['file']]['SIZE']) > int(meta[best[k]]['SIZE']): best[k] = r['file']
        rows = [dict(r, kitchen=key(meta[r['file']]['NAME'])) for r in rows if best[key(meta[r['file']]['NAME'])] == r['file']]
    json.dump(rows, open(sys.argv[2], 'w'), ensure_ascii=False)
    std = [r for r in rows if r['W'] <= 1300]
    print('всего', len(rows), 'обычных (ширина до 1300)', len(std), 'составных', len(rows) - len(std))
    for lv in ('low', 'up', 'tall', 'mezz'):
        c = collections.Counter(r['layout'] for r in std if r['level'] == lv)
        print(lv, sum(c.values()), c.most_common(14))
