"""Состав модулей из модели Базиса: детали с размерами и положением, фасады, ящики, фурнитура.
Модуль — узел, внутри которого есть узел «Корпус». Размеры детали берутся по контуру (ломаная из отрезков),
положение — композицией преобразований вложенных узлов (Trans: X, Y, Z и кватернион Rx, Ry, Rz, Rw)."""
import struct, math, re
from b3d import B3D

def kid(n, key):
    for k in n['k']:
        if k['n'] == key: return k
def val(n, key, d=None):
    k = kid(n, key); return k['v'] if k is not None and k['v'] is not None else d
def text(v):
    return v.decode('utf-8', 'replace') if isinstance(v, bytes) else (v or '')

def contour(b):
    """Отрезки контура: [(x1, y1, x2, y2)]; дуги и прочее пропускаем."""
    if not isinstance(b, bytes) or len(b) < 5: return []
    n, = struct.unpack_from('<I', b, 0)
    if n == 0 or (len(b) - 4) % n: return []
    sz = (len(b) - 4) // n
    out = []
    for i in range(n):
        rec = b[4 + i*sz: 4 + (i+1)*sz]
        if sz == 33 and rec[0] == 0x10: out.append(struct.unpack('<4d', rec[1:33]))
    return out

def trans(n):
    t = kid(n, 'Trans')
    if t is None: return None
    g = lambda k: val(t, k, 0.0)
    return (g('X'), g('Y'), g('Z')), (g('Rx'), g('Ry'), g('Rz'), g('Rw') if kid(t, 'Rw') is not None else 1.0)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx, aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
def qrot(q, v):
    x, y, z, w = q; vx, vy, vz = v
    # v' = q v q^-1
    tx = 2*(y*vz - z*vy); ty = 2*(z*vx - x*vz); tz = 2*(x*vy - y*vx)
    return (vx + w*tx + (y*tz - z*ty), vy + w*ty + (z*tx - x*tz), vz + w*tz + (x*ty - y*tx))
IDQ = (0.0, 0.0, 0.0, 1.0)
def compose(parent, n):
    """Положение узла в координатах модели: (смещение, поворот)."""
    t = trans(n)
    if t is None: return parent
    (p, q) = parent; (tp, tq) = t
    r = qrot(q, tp)
    return ((p[0] + r[0], p[1] + r[1], p[2] + r[2]), qmul(q, tq))

def short_mat(m):
    m = text(m)
    return re.sub(r'\s+', ' ', m).strip()

def panels_of(node, pose=((0.0, 0.0, 0.0), IDQ)):
    """Все детали под узлом: имя, материал, толщина, размеры a×b, габарит в модели."""
    out = []
    objs = kid(node, 'Objs')
    for o in (objs['k'] if objs else []):
        p = compose(pose, o)
        name = text(val(o, 'Name', ''))
        c = kid(o, 'Contour')
        if c is not None and kid(o, 'Mat') is not None:
            segs = contour(c['v'])
            if segs:
                xs = [s[0] for s in segs] + [s[2] for s in segs]; ys = [s[1] for s in segs] + [s[3] for s in segs]
                a, b = max(xs) - min(xs), max(ys) - min(ys); th = val(o, 'Thick', 0.0)
                pts = []
                for x in (min(xs), max(xs)):
                    for y in (min(ys), max(ys)):
                        for z in (0.0, th):
                            r = qrot(p[1], (x, y, z)); pts.append((p[0][0] + r[0], p[0][1] + r[1], p[0][2] + r[2]))
                lo = tuple(min(q[i] for q in pts) for i in range(3)); hi = tuple(max(q[i] for q in pts) for i in range(3))
                butts = kid(o, 'Butts')
                out.append({'name': name, 'mat': short_mat(val(o, 'Mat', '')), 'thick': th, 'a': round(max(a, b), 1), 'b': round(min(a, b), 1),
                            'lo': lo, 'hi': hi, 'edges': len(butts['k']) if butts else 0})
        out += panels_of(o, p)
    return out

def hardware_of(node):
    """Фурнитура и покупные изделия: узлы типа 3001/4001 и т. п. без контура, считаем по названию."""
    cnt = {}
    def walk(n):
        objs = kid(n, 'Objs')
        for o in (objs['k'] if objs else []):
            if kid(o, 'Contour') is None and kid(o, 'Objs') is None and kid(o, 'FastID') is not None:
                nm = text(val(o, 'Name', '')); cnt[nm] = cnt.get(nm, 0) + 1
            walk(o)
    walk(node)
    return cnt

def modules_of(path):
    b = B3D(path); x = b.streams[-1][1]; t = b.tree(x)
    doc = t[0]; model = kid(doc, 'Model')
    res = []
    def walk(n, trail):
        objs = kid(n, 'Objs')
        for o in (objs['k'] if objs else []):
            nm = text(val(o, 'Name', ''))
            sub = kid(o, 'Objs')
            if sub and any(text(val(c, 'Name', '')) == 'Корпус' for c in sub['k']):
                res.append((trail, nm, o))
            else:
                walk(o, trail + [nm])
    for root in model['k']:
        if root['n'] == 'Obj': walk(root, [text(val(root, 'Name', ''))])
    return res

def describe(trail, name, node):
    ps = panels_of(node)
    lo = [min(p['lo'][i] for p in ps) for i in range(3)] if ps else [0, 0, 0]
    hi = [max(p['hi'][i] for p in ps) for i in range(3)] if ps else [0, 0, 0]
    sub = kid(node, 'Objs')
    kids = [text(val(c, 'Name', '')) for c in (sub['k'] if sub else [])]
    return {'section': trail[-1] if trail else '', 'name': name, 'size': [round(hi[i] - lo[i]) for i in range(3)], 'panels': ps, 'hw': hardware_of(node), 'kids': kids}
