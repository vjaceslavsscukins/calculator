"""Разбор модулей из survey.json: признаки, ключ варианта, сводка. Запуск: python3 classify.py survey.json [выход.json]"""
import sys, json, re, collections

def role(p):
    n = p['name'].strip(); m = p['mat']
    ldsp = 'ЛДСП' in m
    if re.match(r'(?i)^фасад ящика', n): return 'drawer_front'
    if re.match(r'(?i)^(зсянаходится)$', n): return 'x'
    if re.search(r'(?i)(^зсд?я?$|^бся$|дно ящика|дно выдв|выдв\.? ящика|лоток)', n): return 'drawer_part'
    if re.match(r'(?i)^профиль', n): return 'profile'
    if re.match(r'(?i)^бок', n): return 'side'
    if re.match(r'(?i)^дно', n): return 'bottom'
    if re.match(r'(?i)^(горизонт|гориз|ср гориз|крыша)', n): return 'horizontal'
    if re.match(r'(?i)^м ?-? ?планка', n): return 'rail'
    if re.match(r'(?i)^(полка|вставка)', n) and ldsp: return 'shelf'
    if re.match(r'(?i)^(задняя стенка|зад ст|задн)', n): return 'back'
    if re.match(r'(?i)^ребро', n): return 'rib'
    if re.match(r'(?i)^средник', n): return 'mullion'
    if re.search(r'(?i)(фас планка|фальш|проставка|заглушка|планка|цоколь|фас бок)', n): return 'strip'
    if re.match(r'(?i)^(фасад|дверь)', n) and not ldsp: return 'facade'
    if re.match(r'(?i)^(фасад|дверь)', n): return 'facade'
    return 'other'

def features(m):
    ps = m['panels']
    sx, sy, sz = m['size']
    W, D = max(sx, sz), min(sx, sz)
    low_y = min([p['y'] for p in ps] or [0])
    c = collections.Counter(role(p) for p in ps)
    facs = [p for p in ps if role(p) == 'facade']
    drawers = c['drawer_front']
    doors = len(facs)
    hw = m['hw']
    systems = []
    for h in hw:
        for key, nm in (('Atira', 'Hettich InnoTech Atira'), ('Quadro', 'Hettich Quadro'), ('Actro', 'Hettich Actro'), ('TANDEM', 'Blum TANDEMBOX'), ('LEGRABOX', 'Blum LEGRABOX'), ('Firmax', 'Firmax'), ('Newline', 'Firmax Newline')):
            if key.lower() in h.lower() and nm not in systems: systems.append(nm)
    hinges = sum(v for h, v in hw.items() if re.search(r'(?i)петля', h))
    lift = [h for h in hw if re.search(r'(?i)(aventos|подъ[её]мн|газ патрон|газлифт)', h)]
    gola = c['profile'] > 0 or any('gola' in p['name'].lower() for p in ps)
    legs = [int(re.search(r'(\d+)мм', h).group(1)) for h in hw if h.startswith('Ножка') and re.search(r'(\d+)мм', h)]
    return {'W': W, 'H': sy, 'D': D, 'y0': low_y, 'roles': dict(c), 'doors': doors, 'drawers': drawers, 'systems': systems, 'hinges': hinges,
            'lift': bool(lift), 'gola': gola, 'legs': legs, 'shelves': c['shelf'], 'section': m['section'], 'name': m['name']}

def level(f):
    if f['H'] >= 1500: return 'tall'
    if f['y0'] >= 1900 and f['H'] < 1100: return 'mezz'
    if f['y0'] >= 800: return 'up'
    return 'low'

if __name__ == '__main__':
    d = json.load(open(sys.argv[1]))
    rows = []
    for fid, mods in d.items():
        if isinstance(mods, str): continue
        for m in mods:
            f = features(m); f['file'] = fid; f['level'] = level(f); rows.append(f)
    print('модулей', len(rows), collections.Counter(r['level'] for r in rows))
    key = lambda f: (f['level'], f['doors'], f['drawers'], bool(f['shelves']), f['gola'], tuple(f['systems']))
    cl = collections.defaultdict(list)
    for r in rows: cl[key(r)].append(r)
    for k, v in sorted(cl.items(), key=lambda kv: -len(kv[1]))[:40]:
        Ws = sorted(set(x['W'] for x in v)); print(len(v), k, 'W', Ws[:6], '..', Ws[-2:])
    if len(sys.argv) > 2: json.dump(rows, open(sys.argv[2], 'w'), ensure_ascii=False)
