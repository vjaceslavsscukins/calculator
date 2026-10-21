"""Обход папки с моделями Базиса: по каждому модулю сохраняем состав. Запуск: python3 survey.py <папка .b3d> <выход .json>"""
import sys, json, glob, os, re
sys.path.insert(0, os.path.dirname(__file__))
from extract import modules_of, describe
from multiprocessing import Pool

def work(path):
    fid = os.path.basename(path).split('.')[0]
    try:
        mods = []
        for trail, nm, node in modules_of(path):
            d = describe(trail, nm, node)
            d['panels'] = [{k: p[k] for k in ('name', 'mat', 'thick', 'a', 'b', 'edges')} | {'y': round(p['lo'][1]), 'y2': round(p['hi'][1]), 'x': round(p['lo'][0]), 'x2': round(p['hi'][0]), 'z': round(p['lo'][2]), 'z2': round(p['hi'][2])} for p in d['panels']]
            d['trail'] = trail
            mods.append(d)
        return fid, mods
    except Exception as e:
        return fid, 'ERR ' + repr(e)[:200]

if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(sys.argv[1], '*.b3d')))
    with Pool(4) as p: res = p.map(work, files, chunksize=2)
    out = {fid: m for fid, m in res}
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False)
    bad = [k for k, v in out.items() if isinstance(v, str)]
    print('файлов', len(out), 'модулей', sum(len(v) for v in out.values() if not isinstance(v, str)), 'ошибок', len(bad), bad[:5])
