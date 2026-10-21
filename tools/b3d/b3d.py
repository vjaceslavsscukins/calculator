"""Чтение моделей Базис-Мебельщика (.b3d) без самого Базиса. Формат разобран по файлам технолога, документации нет.

Файл: заголовок BZ85, затем потоки zlib. Нужный поток самый большой: таблица имён полей (uint32 число+1, uint32 0,
затем строки «uint32 длина + текст cp1251») и дерево узлов подряд до конца потока.
Узел: uint32 номер имени (с единицы; 0xFFFFFFFF — безымянный), uint32 число детей, байт типа, значение, дети.
Типы: 0 нет значения, 1 логическое (иногда без байта), 2 без значения (метка), 3 байт, 4 int32, 5 double,
6 строка UTF-16 (uint32 число символов), 7 байты (uint32 длина), 9 дата-время (double).
Что видно: Document → FurnList (справочник фурнитуры), Model → Obj «Кухня» → «Низ», «Верх», «Цоколь» → модули (T1, Sk1…) →
«Корпус», «Фасад», ящики и фурнитура. Деталь (Type 4002): Name, Mat, Thick, Trans (X, Y, Z и кватернион), Butts (кромка),
Contour (сжатый контур, размеры по нему пока не извлечены: размеры берём из комплектовочных ведомостей).
"""
import struct, json, zlib, sys, re
class B3D:
    def __init__(self, path):
        d = open(path, 'rb').read()
        assert d[:4] == b'BZ85'
        # потоки zlib: ищем второй крупный
        self.streams = []
        for m in re.finditer(b'\x78[\x01\x5e\x9c\xda]', d):
            try:
                x = zlib.decompressobj().decompress(d[m.start():])
                if len(x) > 1000: self.streams.append((m.start(), x))
            except Exception: pass
    def tree(self, x):
        n, = struct.unpack_from('<I', x, 0)
        q = 8; names = []
        for i in range(n - 1):
            l, = struct.unpack_from('<I', x, q); q += 4
            names.append(x[q:q+l].decode('cp1251', 'replace')); q += l
        self.names = names; self.x = x; self.p = q
        # корень: несколько узлов подряд до конца
        out = []
        while self.p < len(x) - 8:
            out.append(self.node())
        return out
    def ok(self, p):
        x = self.x
        if p == len(x): return True
        if p + 9 > len(x): return False
        idx, nch, typ = struct.unpack_from('<IIB', x, p)
        return (0 < idx <= len(self.names) or idx == 0xffffffff) and nch < 3000 and typ in (0, 1, 2, 3, 4, 5, 6, 7, 9)
    def node(self, depth=0):
        x = self.x; p = self.p
        idx, nch, typ = struct.unpack_from('<IIB', x, p); p += 9
        val = None
        if typ == 0: pass
        elif typ == 1:
            if self.ok(p + 1) and p + 1 <= len(x): val = x[p]; p += 1
            else: val = True
        elif typ == 2: pass   # без значения
        elif typ == 3: val = x[p]; p += 1
        elif typ == 9: val, = struct.unpack_from('<d', x, p); p += 8
        elif typ == 4: val, = struct.unpack_from('<i', x, p); p += 4
        elif typ == 5: val, = struct.unpack_from('<d', x, p); p += 8
        elif typ == 6:
            l, = struct.unpack_from('<I', x, p); p += 4; val = x[p:p+2*l].decode('utf-16le', 'replace'); p += 2*l
        elif typ == 7:
            l, = struct.unpack_from('<I', x, p); p += 4; val = bytes(x[p:p+l]); p += l
        else:
            raise ValueError(f'тип {typ} на {p}')
        self.p = p
        kids = [self.node(depth+1) for _ in range(nch)]
        name = self.names[idx-1] if 0 < idx <= len(self.names) else (f'#{idx}' if idx != 0xffffffff else '-')
        return {'n': name, 'v': val, 'k': kids, 't': typ}
