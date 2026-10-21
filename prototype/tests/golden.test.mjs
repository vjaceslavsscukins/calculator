// Сравнение движка из kitchen.html (блок CALC) с эталоном из исходного прототипа и проверки формул и шаблонов.
// Запуск: node --test prototype/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const EXPORTS = 'TYPES, DEFAULT_PRICES, DEFAULT_CAT, calcAll, bomOf, layoutOf, wallsOf, facadesOf, panelsOf, hwOf, shelvesOf';
function load(code, extra = '') {
  const ctx = vm.createContext({ console });
  vm.runInContext(`${code}\n;globalThis.__api = { ${EXPORTS}${extra} };`, ctx);
  return ctx.__api;
}
const ref = load(fs.readFileSync(path.join(dir, 'fixtures/calc-v0.js'), 'utf8'));
const html = fs.readFileSync(path.join(dir, '../kitchen.html'), 'utf8');
const block = html.slice(html.indexOf('// CALC-START'), html.indexOf('// CALC-END') + '// CALC-END'.length);
const cur = load(block, ', compileExpr, evalExpr, validateTemplate, setTemplates, BUILTIN_TEMPLATES');

// простой генератор случайных чисел с зерном, чтобы тест был воспроизводимым
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

function randomState(r) {
  const layout = pick(r, ['I', 'L', 'U']), walls = { A: 2400 + Math.floor(r() * 3000), B: 1800 + Math.floor(r() * 2000), C: 1800 + Math.floor(r() * 2000) };
  const names = Object.keys(ref.TYPES), mods = [];
  const n = 4 + Math.floor(r() * 14);
  for (let i = 0; i < n; i++) {
    const type = pick(r, names), t = ref.TYPES[type];
    mods.push({
      id: 'm' + i, type, wall: pick(r, ['A', 'A', 'B', 'C']),
      w: r() < 0.7 ? pick(r, t.widths) : Math.round(t.w + (r() - 0.5) * 200),
      h: t.gap ? 0 : r() < 0.6 ? t.h : Math.round(t.h * (0.85 + r() * 0.3)),
      d: t.gap ? 0 : r() < 0.7 ? t.d : Math.round(t.d + (r() - 0.5) * 100),
      blind: pick(r, ['left', 'right']), corpus: r() < 0.2 ? pick(r, ref.DEFAULT_CAT.corpus).id : null, facade: r() < 0.2 ? pick(r, ref.DEFAULT_CAT.fcolor).id : null,
      light: r() < 0.4, cut: { sink: r() < 0.3, hob: r() < 0.3, pipe: r() < 0.3 },
    });
  }
  return {
    layout, walls, room: { height: 2500 + Math.floor(r() * 500), wall: '#fff', floor: 'oakL' }, modules: mods, disc: pick(r, [0, 5, 12.5]), extra: [],
    mat: { corpus: pick(r, ref.DEFAULT_CAT.corpus).id, facade: pick(r, ref.DEFAULT_CAT.facade).id, milling: pick(r, ref.DEFAULT_CAT.milling).id, fLow: 'k1', fUp: 'k4',
      handle: pick(r, ['bar', 'gola', 'push']), // TANDEMBOX здесь не берём: его детали ящика заменены размерами из ведомостей технолога, они проверяются отдельным тестом ниже
      drawers: 'legrabox', drawerColor: 'silk', top: pick(r, ref.DEFAULT_CAT.top).id, splash: r() < 0.5 },
  };
}
// числа сравниваем с допуском на порядок сложения, остальное — строго
function same(a, b, where = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${where}: ${a} ≠ ${b}`);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    assert.deepEqual(ka.sort(), kb.sort(), `${where}: набор полей`);
    ka.forEach((k) => same(a[k], b[k], `${where}.${k}`));
  } else assert.equal(a, b, where);
}

test('22 исходных модуля: размеры и свойства совпадают с эталоном', () => {
  for (const [code, t] of Object.entries(ref.TYPES)) {
    const c = cur.TYPES[code];
    assert.ok(c, `нет модуля ${code}`);
    for (const f of ['name', 'cat', 'row', 'w', 'h', 'd']) assert.equal(c[f], t[f], `${code}.${f}`);
    assert.equal(JSON.stringify(c.widths), JSON.stringify(t.widths), `${code}.widths`);
    assert.equal(!!c.tall, !!t.tall, `${code}.tall`);
    assert.equal(!!c.gap, !!t.gap, `${code}.gap`);
  }
});

test('смета и ведомость совпадают с эталоном на 600 случайных кухнях', () => {
  const r = rng(20261021);
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const S = randomState(r), a = ref.calcAll(JSON.parse(JSON.stringify(S)), ref.DEFAULT_PRICES, ref.DEFAULT_CAT);
    const b = cur.calcAll(JSON.parse(JSON.stringify(S)), cur.DEFAULT_PRICES, cur.DEFAULT_CAT);
    S.modules.forEach((m) => {
      seen.add(m.type);
      // высоты полок и фасады влияют на 3D, но не на цену, поэтому сравниваем их отдельно
      same(cur.shelvesOf(m), ref.shelvesOf(m), `полки ${m.type} (кухня ${i})`);
      same(cur.facadesOf(m, S), ref.facadesOf(m, S), `фасады ${m.type} (кухня ${i})`);
      same(cur.panelsOf(m, S), ref.panelsOf(m, S), `детали ${m.type} (кухня ${i})`);
    });
    const strip = (x) => { const y = { ...x }; for (const k of ['extras', 'extrasCost', 'exDisc', 'exFree']) delete y[k]; return y; };
    same(strip(b), a, `кухня ${i}`);
    same(cur.bomOf(b, S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT), ref.bomOf(a, S, ref.DEFAULT_PRICES, ref.DEFAULT_CAT), `ведомость ${i}`);
  }
  assert.equal(seen.size, Object.keys(ref.TYPES).length, 'в выборке были все исходные типы модулей');
});

test('все встроенные шаблоны проходят проверку', () => {
  for (const t of cur.BUILTIN_TEMPLATES) assert.equal(cur.validateTemplate(t).join('; '), '', t.code);
  assert.ok(cur.BUILTIN_TEMPLATES.length >= 28);
});

test('новые модули считаются без пустых и нечисловых значений при любой допустимой ширине', () => {
  const origin = new Set(Object.keys(ref.TYPES));
  const r = rng(7);
  for (const t of cur.BUILTIN_TEMPLATES.filter((x) => !origin.has(x.code))) {
    for (const w of t.widths) for (const handle of ['bar', 'gola', 'push']) {
      const S = { layout: 'I', walls: { A: 4000, B: 2400, C: 2400 }, room: { height: 2700 }, disc: 0, extra: [],
        mat: { corpus: 'c1', facade: 'f2', milling: 'n1', fLow: 'k1', fUp: 'k1', handle, drawers: 'legrabox', drawerColor: 'silk', top: 't1', splash: false },
        modules: [{ id: 'm1', type: t.code, wall: 'A', w, h: t.h, d: t.d, blind: 'left', corpus: null, facade: null, light: false, cut: { sink: false, hob: false, pipe: false } }] };
      const out = cur.calcAll(S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT);
      assert.ok(Number.isFinite(out.total), `${t.code} ${w} ${handle}: итог ${out.total}`);
      out.mods.forEach((m) => { assert.ok(Number.isFinite(m.cost) && m.cost >= 0, `${t.code}: себестоимость`); m.facs.forEach((f) => assert.ok(f.h > 0 && f.w > 0, `${t.code}: фасад ${JSON.stringify(f)}`)); });
    }
  }
  assert.ok(r() > 0);
});

test('формулы: порядок действий, условия, функции', () => {
  const E = (s, V = {}) => cur.evalExpr(s, V);
  assert.equal(E('2 + 3 * 4'), 14);
  assert.equal(E('(2 + 3) * 4'), 20);
  assert.equal(E('10 - 2 - 3'), 5);
  assert.equal(E('-W + 10', { W: 4 }), 6);
  assert.equal(E('W >= 800 ? 6 : 4', { W: 800 }), 6);
  assert.equal(E('W >= 800 ? 6 : 4', { W: 799 }), 4);
  assert.equal(E('round(H * 0.39)', { H: 720 }), 281);
  assert.equal(E('max(H - 600, 60) - 4', { H: 600 }), 56);
  assert.equal(E('min(1, 2, 3) + abs(-5)'), 6);
  assert.equal(E('H > 760 && W > 500 ? 1 : 0', { H: 800, W: 600 }), 1);
  assert.equal(E('!(H > 5)', { H: 3 }), true);
  assert.equal(E(42), 42);
});

test('формулы: чужой код не выполняется', () => {
  const bad = ['process.exit()', 'constructor', 'this', '__proto__', 'Math.max(1,2)', 'W.toString()', 'eval("1")', 'Function("return 1")()', 'W[0]', '1; 2', 'alert(1)', '`x`', 'W =', '(1 + ', '1 +', 'round(', 'foo(1)'];
  for (const s of bad) assert.throws(() => cur.evalExpr(s, { W: 1 }), (e) => e && /Формула/.test(e.message), s);
});

test('шаблон: понятные сообщения об ошибках', () => {
  const ok = JSON.parse(JSON.stringify(cur.BUILTIN_TEMPLATES.find((t) => t.code === 'base_door')));
  ok.code = 'my_door';
  assert.equal(cur.validateTemplate(ok, []).join('; '), '');
  const msgs = (patch) => cur.validateTemplate({ ...ok, ...patch }, ['base_door']);
  assert.match(msgs({ code: 'base_door' }).join(), /уже занят/);
  assert.match(msgs({ code: 'X' }).join(), /code/);
  assert.match(msgs({ cat: 'zzz' }).join(), /cat/);
  assert.match(msgs({ widths: [600, 400] }).join(), /widths/);
  assert.match(msgs({ w: 650 }).join(), /widths/);
  assert.match(msgs({ facades: [{ kind: 'doors', y: '2', h: 'H-4-Q' }] }).join(), /неизвестная переменная «Q»/);
  assert.match(msgs({ facades: [{ kind: 'doors', y: '2', h: '0-5' }] }).join(), /недопустимое значение/);
  assert.match(msgs({ facades: [{ kind: 'drawer', y: '2', h: 'process.exit()' }] }).join(), /facades\[0\]\.h/);
  assert.match(msgs({ facades: [{ kind: 'corner', blind: 600 }] }).join(), /corner/);
  assert.match(msgs({ facades: [{ kind: 'magic' }] }).join(), /kind/);
  assert.match(msgs({ shelves: [{ y: 'H+10' }] }).join(), /shelves\[0\]/);
});

test('библиотека: свой шаблон появляется в каталоге, плохой пропускается', () => {
  const t = JSON.parse(JSON.stringify(cur.BUILTIN_TEMPLATES.find((x) => x.code === 'base_drawers3')));
  t.code = 'my_drawers3'; t.name = 'Мои 3 ящика';
  const broken = { ...t, code: 'broken_one', facades: [{ kind: 'drawer', y: 'zzz', h: '10' }] };
  cur.setTemplates([t, broken]);
  assert.ok(cur.TYPES.my_drawers3 && cur.TYPES.my_drawers3.custom);
  assert.equal(cur.TYPES.broken_one, undefined);
  assert.ok(cur.TYPES.base_door, 'встроенные остались');
  cur.setTemplates([]);
  assert.equal(cur.TYPES.my_drawers3, undefined);
});

test('фасадный бок: боковина из ЛДСП заменяется панелью фасада, цена и ведомость считаются по фасаду', () => {
  const mk = (extra) => ({
    layout: 'I', walls: { A: 3000, B: 2000, C: 2000 }, room: { height: 2700, wall: '#fff', floor: 'oakL' }, disc: 0, extra: [], nextId: 5,
    modules: [{ id: 'm1', type: 'base_door', wall: 'A', w: 600, h: 720, d: 560, blind: 'left', corpus: null, facade: null, light: false, cut: { sink: false, hob: false, pipe: false }, ...extra }],
    mat: { corpus: cur.DEFAULT_CAT.corpus[0].id, facade: cur.DEFAULT_CAT.facade[0].id, milling: cur.DEFAULT_CAT.milling[0].id, fLow: 'k1', fUp: 'k4', handle: 'bar', drawers: 'legrabox', drawerColor: 'silk', top: cur.DEFAULT_CAT.top[0].id, splash: false },
  });
  const run = (S) => ({ S, A: cur.calcAll(S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT) });
  const base = run(mk({})), one = run(mk({ endL: true })), both = run(mk({ endL: true, endR: true }));
  const sides = (r) => r.A.mods[0].panels.filter((p) => p.n === 'Боковина' || p.n === 'Фасадный бок').map((p) => `${p.n}:${p.q}:${p.mat}`).join(' | ');
  assert.equal(sides(base), 'Боковина:2:ldsp');
  assert.equal(sides(one), 'Боковина:1:ldsp | Фасадный бок:1:facade');
  assert.equal(sides(both), 'Фасадный бок:2:facade');
  // размер фасадного бока пока как у боковины (В × Г), правило технолога не описано
  const fs = both.A.mods[0].panels.find((p) => p.n === 'Фасадный бок');
  assert.deepEqual([fs.a, fs.b], [720, 560]);
  // ЛДСП и кромки стало меньше, фасадная часть стоит по цене фасадного материала
  assert.ok(both.A.mods[0].ldsp < one.A.mods[0].ldsp && one.A.mods[0].ldsp < base.A.mods[0].ldsp);
  const fm = cur.DEFAULT_CAT.facade[0];
  const extra = both.A.mods[0].c.facade - base.A.mods[0].c.facade;
  assert.ok(Math.abs(extra - 2 * 0.72 * 0.56 * fm.price) < 1e-6, `доплата за фасад: ${extra}`);
  const bom = cur.bomOf(both.A, both.S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT).find((r) => /Фасадные боковины/.test(r.n || ''));
  assert.ok(bom && bom.u === 'м²' && Math.abs(bom.q - 2 * 0.72 * 0.56) < 1e-9);
  assert.ok(!cur.bomOf(base.A, base.S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT).some((r) => /Фасадные боковины/.test(r.n || '')));
  // у модуля без корпуса (посудомойка) опция ничего не меняет
  const dw = run({ ...mk({}), modules: [{ ...mk({}).modules[0], type: 'base_dw', w: 600, endL: true }] });
  assert.equal(dw.A.mods[0].panels.length, 0);
});

// Эталон: комплектовочные ведомости технолога (Blum TANDEMBOX antaro, длина направляющих 500, модули глубиной 510).
// Дно ящика (Ш − 108) × 492, задняя стенка из ЛДСП (Ш − 120) × 183 (D), 151 (C), 68 (M).
test('ящики TANDEMBOX: детали совпадают с ведомостями технолога, внутренний ящик считается отдельно', () => {
  const mk = (type, w) => ({
    layout: 'I', walls: { A: 3000, B: 2000, C: 2000 }, room: { height: 2700, wall: '#fff', floor: 'oakL' }, disc: 0, extra: [], nextId: 5,
    modules: [{ id: 'm1', type, wall: 'A', w, h: 720, d: 510, blind: 'left', corpus: null, facade: null, light: false, cut: { sink: false, hob: false, pipe: false } }],
    mat: { corpus: cur.DEFAULT_CAT.corpus[0].id, facade: cur.DEFAULT_CAT.facade[0].id, milling: cur.DEFAULT_CAT.milling[0].id, fLow: 'k1', fUp: 'k4', handle: 'bar', drawers: 'tandembox', drawerColor: 'silk', top: cur.DEFAULT_CAT.top[0].id, splash: false },
  });
  const parts = (type, w) => {
    const S = mk(type, w);
    return cur.panelsOf(S.modules[0], S).filter((p) => /ящика/.test(p.n)).map((p) => `${p.n} ${p.a}×${p.b} ×${p.q}`).sort().join(' | ');
  };
  // 2 ящика: два высоких ящика D
  assert.equal(parts('base_drawers2', 600), 'Дно ящика 492×492 ×2 | Задняя стенка ящика 480×183 ×2');
  assert.equal(parts('base_drawers2', 500), 'Дно ящика 392×492 ×2 | Задняя стенка ящика 380×183 ×2');
  // 2 ящика с внутренним: C сверху, D снизу, внутри D ящик M (задние стенки 151, 183 и 68)
  const exp = (w) => ['Дно ящика ' + (w - 108) + '×492 ×1', 'Дно ящика ' + (w - 108) + '×492 ×1', 'Дно ящика ' + (w - 108) + '×492 ×1',
    'Задняя стенка ящика ' + (w - 120) + '×151 ×1', 'Задняя стенка ящика ' + (w - 120) + '×183 ×1', 'Задняя стенка ящика ' + (w - 120) + '×68 ×1'].sort().join(' | ');
  assert.equal(parts('base_drawers2_inner', 600), exp(600));
  assert.equal(parts('base_drawers2_inner', 800), exp(800));
  // внутренний ящик — отдельный комплект ящика в фурнитуре (3 ящика на 2 фасада)
  const S = mk('base_drawers2_inner', 600), A = cur.calcAll(S, cur.DEFAULT_PRICES, cur.DEFAULT_CAT);
  assert.equal(A.mods[0].hw.slide, 3);
  assert.equal(A.mods[0].facs.length, 2);
  const two = mk('base_drawers2', 600), B = cur.calcAll(two, cur.DEFAULT_PRICES, cur.DEFAULT_CAT);
  assert.equal(B.mods[0].hw.slide, 2);
});

test('шаблон ящика: неверный класс ящика отклоняется', () => {
  const t = JSON.parse(JSON.stringify(cur.BUILTIN_TEMPLATES.find((x) => x.code === 'base_drawers2_inner')));
  assert.equal(cur.validateTemplate({ ...t, code: 'my_inner_ok' }).join(';'), '');
  t.code = 'my_inner_bad'; t.facades[0].box = 'X';
  assert.match(cur.validateTemplate(t).join(';'), /класс ящика/);
});

// Эталон: настоящие модули из комплектовочных ведомостей технолога (кухни К-1878, К-1974, К-18xx и др.).
// Каждый случай: что получилось у технолога. Проверяем, что шаблон даёт те же детали и фасады до миллиметра.
const SHOP_CASES = [
  { name: 'без Gola: тумба с одной дверцей 600', type: 's_base_door', W: 600, H: 720, D: 510, handle: 'bar',
    parts: ['Боковина 704×510 ×2', 'Дно 600×510 ×1', 'М-планка 567×80 ×2', 'Задняя стенка 716×595 ×1', 'Полка 565×500 ×1'], facades: ['716×596'] },
  { name: 'без Gola: 2 ящика с внутренним 600', type: 's_base_drawers2_inner', W: 600, H: 720, D: 510, handle: 'bar', drawers: 'tandembox',
    parts: ['Боковина 704×510 ×2', 'Дно 600×510 ×1', 'М-планка 567×80 ×2', 'Задняя стенка 716×595 ×1', 'Дно ящика 492×492 ×3', 'Задняя стенка ящика 480×183 ×1', 'Задняя стенка ящика 480×151 ×1', 'Задняя стенка ящика 480×68 ×1'], facades: ['356×596', '356×596'] },
  { name: 'без Gola: 2 ящика с внутренним 800', type: 's_base_drawers2_inner', W: 800, H: 720, D: 510, handle: 'bar', drawers: 'tandembox',
    parts: ['Боковина 704×510 ×2', 'Дно 800×510 ×1', 'М-планка 767×80 ×2', 'Дно ящика 692×492 ×3', 'Задняя стенка ящика 680×183 ×1', 'Задняя стенка ящика 680×151 ×1', 'Задняя стенка ящика 680×68 ×1'], facades: ['356×796', '356×796'] },
  { name: 'без Gola: 3 ящика 600 (176 + 176 + 356)', type: 's_base_drawers3', W: 600, H: 720, D: 510, handle: 'bar', drawers: 'tandembox',
    parts: ['Боковина 704×510 ×2', 'Дно 600×510 ×1', 'М-планка 567×80 ×2', 'Дно ящика 492×492 ×3', 'Задняя стенка ящика 480×183 ×1', 'Задняя стенка ящика 480×68 ×2'], facades: ['356×596', '176×596', '176×596'] },
  { name: 'Gola (К-1878): 2 ящика 900', type: 's_base_drawers2', W: 900, H: 720, D: 510, handle: 'gola', drawers: 'tandembox',
    parts: ['Боковина 764×510 ×2', 'Дно 900×510 ×1', 'М-планка 867×80 ×2', 'Задняя стенка 776×895 ×1', 'Дно ящика 792×492 ×2', 'Задняя стенка ящика 780×183 ×2'], facades: ['356×896', '356×896'] },
  { name: 'Gola (К-1878): две дверцы 884', type: 's_base_door2', W: 884, H: 720, D: 510, handle: 'gola',
    parts: ['Боковина 764×510 ×2', 'Дно 884×510 ×1', 'М-планка 851×80 ×2'], facades: ['746×438', '746×438'] },
  { name: 'без Gola: посудомойка 600 (только фасад)', type: 's_base_dw', W: 600, H: 720, D: 510, handle: 'bar', parts: [], facades: ['716×596'] },
  { name: 'Gola: посудомойка 600 (фасад выше на 30)', type: 's_base_dw', W: 600, H: 720, D: 510, handle: 'gola', parts: [], facades: ['746×596'] },
  { name: 'без Gola: бутылочница 200', type: 's_base_cargo', W: 200, H: 720, D: 510, handle: 'bar',
    parts: ['Боковина 704×510 ×2', 'Дно 200×510 ×1', 'Горизонт 167×510 ×1', 'Задняя стенка 716×195 ×1'], facades: ['716×196'] },
  { name: 'Gola: бутылочница 200', type: 's_base_cargo', W: 200, H: 720, D: 510, handle: 'gola',
    parts: ['Боковина 764×510 ×2', 'Дно 200×510 ×1', 'Горизонт 167×485 ×1', 'Задняя стенка 776×195 ×1'], facades: ['746×196'] },
  { name: 'верхний (К-1974): одна дверца 600, высота 926, глубина 336', type: 's_up_door', W: 600, H: 926, D: 336, handle: 'bar',
    parts: ['Боковина 926×336 ×2', 'Дно 566×320 ×1', 'Горизонт 566×316 ×1', 'Ребро жёсткости 566×80 ×1', 'Задняя стенка 914×580 ×1'], facadeH: [923] },
];
for (const c of SHOP_CASES) {
  test('конструкция цеха совпадает с ведомостью: ' + c.name, () => {
    const S = {
      layout: 'I', walls: { A: 4000, B: 2000, C: 2000 }, room: { height: 2700, wall: '#fff', floor: 'oakL' }, disc: 0, extra: [], nextId: 5,
      modules: [{ id: 'm1', type: c.type, wall: 'A', w: c.W, h: c.H, d: c.D, blind: 'left', corpus: null, facade: null, light: false, cut: { sink: false, hob: false, pipe: false } }],
      mat: { corpus: cur.DEFAULT_CAT.corpus[0].id, facade: cur.DEFAULT_CAT.facade[0].id, milling: cur.DEFAULT_CAT.milling[0].id, fLow: 'k1', fUp: 'k4', handle: c.handle, drawers: c.drawers || 'legrabox', drawerColor: 'silk', top: cur.DEFAULT_CAT.top[0].id, splash: false },
    };
    const m = S.modules[0], got = {};
    cur.panelsOf(m, S).forEach((p) => { const k = `${p.n} ${p.a}×${p.b}`; got[k] = (got[k] || 0) + p.q; });
    for (const e of c.parts) { const [, name, dims, q] = /^(.+?) (\d+×\d+) ×(\d+)$/.exec(e); assert.equal(got[`${name} ${dims}`] || 0, +q, `${e}; получено: ${JSON.stringify(got)}`); }
    const facs = cur.facadesOf(m, S);
    if (c.facades) assert.equal(facs.map((f) => `${Math.round(f.h)}×${Math.round(f.w)}`).sort().join(' | '), [...c.facades].sort().join(' | '), 'фасады');
    if (c.facadeH) assert.equal(facs.map((f) => Math.round(f.h)).join(','), c.facadeH.join(','), 'высота фасадов');
  });
}

test('шаблон с деталями: плохая формула и неверное количество отклоняются', () => {
  const t = JSON.parse(JSON.stringify(cur.BUILTIN_TEMPLATES.find((x) => x.code === 's_base_door')));
  assert.equal(cur.validateTemplate({ ...t, code: 'my_shop_ok' }).join(';'), '');
  const bad1 = JSON.parse(JSON.stringify(t)); bad1.code = 'my_shop_1'; bad1.panels[0].a = 'W - X';
  assert.match(cur.validateTemplate(bad1).join(';'), /неизвестная переменная/);
  const bad2 = JSON.parse(JSON.stringify(t)); bad2.code = 'my_shop_2'; bad2.panels[1].b = '0-5';
  assert.match(cur.validateTemplate(bad2).join(';'), /размеры/);
  const bad3 = JSON.parse(JSON.stringify(t)); bad3.code = 'my_shop_3'; bad3.panels[2].q = '1.5';
  assert.match(cur.validateTemplate(bad3).join(';'), /количество/);
});
