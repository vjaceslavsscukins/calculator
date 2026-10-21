// Эталон: расчёт из исходного прототипа (коммит af1d218). Менять нельзя: с ним сравнивается движок.
// CALC-START
const T = 16, SHEET_M2 = 2.8 * 2.07, BASE_Y = 100, UP_TOP = 2170, GOLA = 30;

const TYPES = {
  base_door:        {name:'С дверцами',            cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[300,400,450,500,600,800,900]},
  base_drawer_door: {name:'Ящик и дверцы',         cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[400,450,500,600,800,900]},
  base_drawers2:    {name:'2 ящика',               cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[400,450,500,600,800,900,1000]},
  base_drawers3:    {name:'3 ящика',               cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[400,450,500,600,800,900,1000]},
  base_sink:        {name:'Под мойку',             cat:'low',  row:'low',  w:800,  h:720,  d:560, widths:[600,800,900]},
  base_oven:        {name:'Под духовой шкаф',      cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[600]},
  base_dw:          {name:'Посудомойка',           cat:'low',  row:'low',  w:600,  h:720,  d:560, widths:[450,600]},
  base_cargo:       {name:'Бутылочница',           cat:'low',  row:'low',  w:200,  h:720,  d:560, widths:[150,200,300]},
  base_corner:      {name:'Угловой нижний',        cat:'low',  row:'low',  w:1050, h:720,  d:560, widths:[900,1000,1050,1100]},
  upper_door:       {name:'С дверцами',            cat:'up',   row:'up',   w:600,  h:720,  d:300, widths:[300,400,450,500,600,800,900]},
  upper_glass:      {name:'Витрина со стеклом',    cat:'up',   row:'up',   w:600,  h:720,  d:300, widths:[400,450,500,600,800]},
  upper_lift:       {name:'С подъёмником',         cat:'up',   row:'up',   w:600,  h:360,  d:300, widths:[500,600,800,900]},
  upper_open:       {name:'Открытая полка',        cat:'up',   row:'up',   w:600,  h:720,  d:300, widths:[300,400,600,800]},
  upper_corner:     {name:'Угловой верхний',       cat:'up',   row:'up',   w:620,  h:720,  d:300, widths:[620,650,700]},
  mezz_door:        {name:'Антресоль с дверцами',  cat:'mezz', row:'mezz', w:600,  h:360,  d:300, widths:[400,600,800,900]},
  mezz_lift:        {name:'Антресоль с подъёмником', cat:'mezz', row:'mezz', w:600, h:360,  d:300, widths:[600,800,900]},
  tall_door:        {name:'Пенал с дверцами',      cat:'tall', row:'low',  w:600,  h:2070, d:560, widths:[400,450,500,600], tall:true},
  tall_oven:        {name:'Под духовку и СВЧ',     cat:'tall', row:'low',  w:600,  h:2070, d:560, widths:[600], tall:true},
  tall_fridge:      {name:'Под встроенный холодильник', cat:'tall', row:'low', w:600, h:2070, d:560, widths:[600], tall:true},
  gap_low:          {name:'Проём внизу',           cat:'gap',  row:'low',  w:600,  h:0, d:0, widths:[600,700,900], gap:true},
  gap_up:           {name:'Проём вверху',          cat:'gap',  row:'up',   w:600,  h:0, d:0, widths:[400,600,800], gap:true},
  gap_mezz:         {name:'Проём на антресолях',   cat:'gap',  row:'mezz', w:600,  h:0, d:0, widths:[600,800,1200], gap:true},
};
const CATS = [['low','Нижние'],['up','Верхние'],['mezz','Антресоли'],['tall','Пеналы'],['gap','Проёмы']];
const ROWS = [['low','нижний ряд и пеналы'],['up','верхний ряд'],['mezz','антресоли']];

const DRAWERS = {
  legrabox:{n:'LEGRABOX', colors:[{id:'orion',name:'Орион серый',hex:'#8B9095'},{id:'silk',name:'Шёлковый белый',hex:'#E9E8E3'},{id:'carbon',name:'Карбон чёрный',hex:'#2A2A2B'},{id:'steel',name:'Нерж. сталь',hex:'#B9BCBE',metal:true}]},
  tandembox:{n:'TANDEMBOX', colors:[{id:'silk',name:'Шёлковый белый',hex:'#E9E8E3'},{id:'grey',name:'Серый',hex:'#9A9C9E'},{id:'terra',name:'Терра чёрный',hex:'#333230'}]},
};
const HANDLES = {bar:'Ручка-скоба', gola:'Профиль Gola', push:'Push, TIP-ON'};

const DEFAULT_CAT = {
  corpus:[
    {id:'c1', name:'Белый', hex:'#EDEDE8', pattern:'plain', price:1100},
    {id:'c2', name:'Серый камень', hex:'#A3A6A1', pattern:'plain', price:1150},
    {id:'c3', name:'Графит', hex:'#3D4042', pattern:'plain', price:1150},
    {id:'c4', name:'Дуб Сонома', hex:'#C9A57A', pattern:'wood', price:1200}],
  facade:[
    {id:'f1', name:'МДФ плёнка ПВХ', finish:'satin', price:6500},
    {id:'f2', name:'МДФ эмаль матовая', finish:'matte', price:11000},
    {id:'f3', name:'МДФ эмаль глянец', finish:'gloss', price:13500},
    {id:'f4', name:'Пластик AGT', finish:'satin', price:9000},
    {id:'f5', name:'ЛДСП 16 мм', finish:'matte', price:2600}],
  milling:[
    {id:'n0', name:'Без фрезеровки', style:'flat', add:0},
    {id:'n1', name:'Рамка «Шейкер»', style:'frame', add:1800},
    {id:'n2', name:'Классика', style:'classic', add:3200},
    {id:'n3', name:'Вертикальные пазы', style:'grooves', add:1500}],
  fcolor:[
    {id:'k1', name:'Белый', hex:'#F1F0EA', pattern:'plain'}, {id:'k2', name:'Кашемир', hex:'#C9BCAE', pattern:'plain'},
    {id:'k3', name:'Песочный', hex:'#D6C3A2', pattern:'plain'}, {id:'k4', name:'Шалфей', hex:'#9EAC95', pattern:'plain'},
    {id:'k5', name:'Оливковый', hex:'#6F7356', pattern:'plain'}, {id:'k6', name:'Тёмно-синий', hex:'#2C3B57', pattern:'plain'},
    {id:'k7', name:'Графит', hex:'#3A3E41', pattern:'plain'}, {id:'k8', name:'Дуб натуральный', hex:'#B98A57', pattern:'wood'}],
  top:[
    {id:'t1', name:'Постформинг 38 мм, бетон', hex:'#A9A7A1', pattern:'plain', t:38, price:3200, joint:2500, cut:800},
    {id:'t2', name:'Постформинг 38 мм, дуб', hex:'#B48A5A', pattern:'wood', t:38, price:3200, joint:2500, cut:800},
    {id:'t3', name:'Компакт-плита 12 мм, графит', hex:'#383735', pattern:'plain', t:12, price:9000, joint:3500, cut:2500},
    {id:'t4', name:'Кварц 20 мм, белый мрамор', hex:'#ECEBE6', pattern:'marble', t:20, price:28000, joint:9000, cut:6000}],
};
const DEFAULT_PRICES = {
  hdf:250, edge2:40, edge04:12,
  blum:{hinge:750, legrabox:9500, tandembox:6800, aventos:12500, tipon:1200, cargo:16000, fridgeMount:900},
  leg:70, hanger:90, shelfPin:10, fixings:200, dwMount:400, bar:350, gola:1800, glass:4500,
  led:2400, ledDriver:3800, cutPipe:300,
  plinth:450, splash:2500,
  work:{cut:150, edging:35, assembly:700},
  waste:{ldsp:1.2, hdf:1.15, edge:1.1},
  markup:100, install:10, delivery:3000,
};

function catFind(list, id){ return list.find(r => r.id === id) || list[0]; }
function wallsOf(S){ return S.layout === 'U' ? ['A','B','C'] : S.layout === 'L' ? ['A','B'] : ['A']; }
function activeModules(S){ const w = wallsOf(S); return S.modules.filter(m => w.includes(m.wall)); }
function facadeColorId(m, S){ return m.facade || (TYPES[m.type].row === 'low' ? S.mat.fLow : S.mat.fUp); }

function shelvesOf(m){
  const H = m.h;
  switch (m.type){
    case 'base_door': case 'base_corner': return [Math.round(H / 2)];
    case 'base_drawer_door': return [Math.round(H * .39)];
    case 'base_oven': return [H - 600];
    case 'upper_door': case 'upper_glass': case 'upper_corner': case 'upper_open':
      return H > 760 ? [Math.round(H / 3), Math.round(H * 2 / 3)] : [Math.round(H / 2)];
    case 'mezz_door': return H > 450 ? [Math.round(H / 2)] : [];
    case 'tall_door': return [1, 2, 3, 4].map(i => Math.round(H * i / 5));
    case 'tall_oven': return [520, 1115, 1495];
    case 'tall_fridge': return [1770];
    default: return [];
  }
}

function facadesOf(m, S){
  const t = TYPES[m.type], W = m.w, H = m.h, out = [];
  const door = (x, y, w, h, hinge, ex = {}) => out.push(Object.assign({x, y, w, h, k:'door', hinge}, ex));
  const cols = (y, h, ex = {}) => { const n = W > 500 ? 2 : 1, cw = W / n; for (let i = 0; i < n; i++) door(i*cw + 2, y, cw - 4, h, n === 1 ? 'left' : (i ? 'right' : 'left'), ex); };
  const drw = (y, h) => out.push({x:2, y, w:W - 4, h, k:'drawer'});
  switch (m.type){
    case 'base_door': case 'base_sink': case 'upper_door': case 'mezz_door': cols(2, H - 4); break;
    case 'upper_glass': cols(2, H - 4, {glass:true}); break;
    case 'base_drawer_door': { const dh = Math.round(H * .22); cols(2, H - dh - 4); drw(H - dh + 2, dh - 4); break; }
    case 'base_drawers2': { const a = Math.round(H / 2); drw(2, a - 4); drw(a + 2, H - a - 4); break; }
    case 'base_drawers3': { const a = Math.round(H * .39), b = Math.round(H * .39); drw(2, a - 4); drw(a + 2, b - 4); drw(a + b + 2, H - a - b - 4); break; }
    case 'base_oven': drw(2, Math.max(H - 600, 60) - 4); break;
    case 'base_dw': out.push({x:2, y:2, w:W - 4, h:H - 4, k:'dw'}); break;
    case 'base_cargo': out.push({x:2, y:2, w:W - 4, h:H - 4, k:'cargo'}); break;
    case 'base_corner': case 'upper_corner': {
      const blind = m.type === 'base_corner' ? 600 : 320, dw = Math.max(W - blind, 250);
      if (m.blind === 'right') door(2, 2, dw - 4, H - 4, 'left'); else door(W - dw + 2, 2, dw - 4, H - 4, 'right');
      break; }
    case 'upper_lift': case 'mezz_lift': out.push({x:2, y:2, w:W - 4, h:H - 4, k:'lift'}); break;
    case 'tall_door': {
      const n = W > 500 ? 2 : 1, cw = W / n, hb = Math.round(H * .62);
      for (let i = 0; i < n; i++){ const hg = n === 1 ? 'left' : (i ? 'right' : 'left');
        door(i*cw + 2, 2, cw - 4, hb - 4, hg, {part:'bottom'}); door(i*cw + 2, hb + 2, cw - 4, H - hb - 4, hg, {part:'top'}); }
      break; }
    case 'tall_oven': { drw(2, 256); drw(262, 254); const y0 = 520 + 595 + 380; cols(y0 + 2, H - y0 - 4, {part:'top'}); break; }
    case 'tall_fridge': {
      out.push({x:2, y:2, w:W - 4, h:716, k:'fridge', hinge:'right', part:'bottom'}, {x:2, y:722, w:W - 4, h:1046, k:'fridge', hinge:'right', part:'bottom'});
      cols(1772, H - 1774, {part:'top'}); break; }
  }
  if (S.mat.handle === 'gola'){
    if (t.row === 'low' && !t.tall) out.forEach(f => { f.h -= GOLA; f.channel = true; });
    else if (t.tall) out.forEach(f => {
      if (f.k === 'drawer'){ f.h -= GOLA; f.channel = true; return; }
      if (f.hinge === 'left'){ f.w -= GOLA; f.vch = f.x + f.w + 2; } else { f.x += GOLA; f.w -= GOLA; f.vch = f.x - GOLA - 2; }
    });
    else out.forEach(f => { f.y -= 20; f.h += 20; });
  }
  return out;
}

function panelsOf(m, S){
  const t = TYPES[m.type], p = [];
  if (t.gap || m.type === 'base_dw') return p;
  const W = m.w, H = m.h, D = m.d, wi = W - 2*T;
  const add = (n, a, b, q, mat, e2) => { if (q > 0) p.push({n, a:Math.round(a), b:Math.round(b), q, mat, e2:e2 || 0}); };
  add('Боковина', H, D, 2, 'ldsp', H);
  if (t.row === 'low' && !t.tall){ add('Дно', wi, D, 1, 'ldsp', wi); add('Царга', wi, 100, 2, 'ldsp', wi); }
  else add('Дно и крыша', wi, D, 2, 'ldsp', wi);
  add('Полка', wi - 2, D - 20, shelvesOf(m).length, 'ldsp', wi - 2);
  const nd = facadesOf(m, S).filter(f => f.k === 'drawer').length;
  add('Дно ящика', wi - 26, D - 70, nd, 'ldsp', 0);
  if (S.mat.drawers === 'tandembox') add('Задняя стенка ящика', wi - 38, 120, nd, 'ldsp', 0);
  if (m.type !== 'base_sink') add('Задняя стенка', W - 2, H - 2, 1, 'hdf');
  return p;
}

function hwOf(m, facs, S){
  const t = TYPES[m.type];
  const h = {hinge:0, slide:0, lift:0, cargo:0, fridge:0, dw:0, bar:0, push:0, gola:0, leg:0, hanger:0, pin:0, fix:0, glass:0};
  facs.forEach(f => {
    if (f.k === 'door') h.hinge += f.h <= 900 ? 2 : f.h <= 1600 ? 3 : 4;
    if (f.k === 'drawer') h.slide++;
    if (f.k === 'lift') h.lift++;
    if (f.k === 'cargo') h.cargo++;
    if (f.k === 'fridge') h.fridge++;
    if (f.k === 'dw') h.dw++;
    if (f.glass) h.glass += Math.max(0, f.w - 120) * Math.max(0, f.h - 120) / 1e6;
    if (S.mat.handle === 'bar') h.bar++;
    if (S.mat.handle === 'push' && f.k !== 'dw' && f.k !== 'fridge') h.push++;
    if (f.channel) h.gola += (f.w + 4) / 1000;
    if (f.vch !== undefined) h.gola += (f.h + 4) / 1000;
  });
  if (!t.gap && m.type !== 'base_dw'){
    h.fix = 1;
    if (t.row === 'low') h.leg = m.w >= 800 ? 6 : 4; else h.hanger = 2;
  }
  h.pin = shelvesOf(m).length * 4;
  return h;
}

function calcModule(m, S, P, C){
  const facs = facadesOf(m, S), panels = panelsOf(m, S), hw = hwOf(m, facs, S), t = TYPES[m.type];
  let ldsp = 0, hdf = 0, e2 = 0, e04 = 0;
  panels.forEach(p => { const a = p.a * p.b / 1e6 * p.q;
    if (p.mat === 'ldsp'){ ldsp += a; e2 += p.e2 * p.q / 1000; e04 += (2*(p.a + p.b) - p.e2) * p.q / 1000; } else hdf += a; });
  const facArea = facs.reduce((s, f) => s + f.w * f.h / 1e6, 0);
  const decor = catFind(C.corpus, m.corpus || S.mat.corpus);
  const fm = catFind(C.facade, S.mat.facade), ml = catFind(C.milling, S.mat.milling);
  const Wt = P.waste, B = P.blum;
  const corpus = ldsp*Wt.ldsp*decor.price + hdf*Wt.hdf*P.hdf + (e2*P.edge2 + e04*P.edge04)*Wt.edge;
  const facade = facArea * (fm.price + ml.add) + hw.glass * P.glass;
  const light = m.light && t.row === 'up' && !t.gap ? m.w / 1000 * P.led : 0;
  const hwc = hw.hinge*B.hinge + hw.slide*B[S.mat.drawers] + hw.lift*B.aventos + hw.cargo*B.cargo + hw.fridge*B.fridgeMount
    + hw.dw*P.dwMount + hw.bar*P.bar + hw.push*B.tipon + hw.gola*P.gola + hw.leg*P.leg + hw.hanger*P.hanger
    + hw.pin*P.shelfPin + hw.fix*P.fixings + light;
  const work = ldsp*P.work.cut + (e2 + e04)*P.work.edging + (hw.fix ? P.work.assembly : 0) + (m.cut && m.cut.pipe ? P.cutPipe : 0);
  const cost = corpus + facade + hwc + work;
  return {m, facs, panels, hw, ldsp, hdf, e2, e04, facArea, light, decor, c:{corpus, facade, hw:hwc, work}, cost, price:cost * (1 + P.markup / 100)};
}

function layoutOf(S){
  const res = {pos:{}, walls:{}, tops:[], warnings:[]};
  const ws = wallsOf(S);
  ws.forEach(wl => {
    const L = S.walls[wl], side = wl !== 'A';
    const mods = S.modules.filter(m => m.wall === wl);
    const by = r => mods.filter(m => TYPES[m.type].row === r);
    const offL = side ? 600 : 0, offU = side ? 320 : 0;
    let x = offL; const tallI = [];
    by('low').forEach(m => { res.pos[m.id] = {x, wall:wl}; if (TYPES[m.type].tall) tallI.push([x, x + m.w]); x += m.w; });
    let u = offU;
    by('up').forEach(m => {
      let moved = true;
      while (moved){ moved = false; for (const [a, b] of tallI) if (u < b && u + m.w > a){ u = b; moved = true; } }
      res.pos[m.id] = {x:u, wall:wl}; u += m.w; });
    let z = offU;
    by('mezz').forEach(m => { res.pos[m.id] = {x:z, wall:wl}; z += m.w; });
    const upEnd = Math.max(u, offU, ...tallI.map(i => i[1]));
    res.walls[wl] = {L, lowEnd:x, upEnd, mezzEnd:z, nLow:by('low').length, nUp:by('up').length, nMezz:by('mezz').length, offL, offU, lows:by('low'), ups:by('up')};
    let seg = null;
    by('low').forEach(m => {
      const t = TYPES[m.type], p = res.pos[m.id];
      if (t.tall || t.gap){ if (seg){ res.tops.push(seg); seg = null; } return; }
      if (!seg) seg = {wall:wl, x0:p.x, x1:p.x + m.w, h:m.h}; else { seg.x1 = p.x + m.w; seg.h = Math.max(seg.h, m.h); }
    });
    if (seg) res.tops.push(seg);
    const nm = {A:'А', B:'Б', C:'В'}[wl];
    if (x > L) res.warnings.push(`Стена ${nm}: нижний ряд длиннее стены на ${x - L} мм`);
    if (upEnd > L) res.warnings.push(`Стена ${nm}: верхний ряд длиннее стены на ${upEnd - L} мм`);
    if (z > L) res.warnings.push(`Стена ${nm}: антресоли длиннее стены на ${z - L} мм`);
  });
  const A = res.walls.A;
  if (ws.includes('B')){
    if (res.walls.B.nLow && A.lows[0] && !(A.lows[0].type === 'base_corner' && A.lows[0].blind !== 'right')) res.warnings.push('Угол со стеной Б: первым внизу на стене А поставьте «Угловой нижний» с глухой частью слева');
    if (res.walls.B.nUp && A.ups[0] && !(A.ups[0].type === 'upper_corner' && A.ups[0].blind !== 'right')) res.warnings.push('Угол со стеной Б: первым вверху на стене А поставьте «Угловой верхний» с глухой частью слева');
  }
  if (ws.includes('C')){
    const ll = A.lows[A.lows.length - 1], lu = A.ups[A.ups.length - 1];
    if (res.walls.C.nLow && ll && !(ll.type === 'base_corner' && ll.blind === 'right')) res.warnings.push('Угол со стеной В: последним внизу на стене А поставьте «Угловой нижний» с глухой частью справа');
    if (res.walls.C.nUp && lu && !(lu.type === 'upper_corner' && lu.blind === 'right')) res.warnings.push('Угол со стеной В: последним вверху на стене А поставьте «Угловой верхний» с глухой частью справа');
  }
  const hiMezz = S.modules.filter(m => ws.includes(m.wall) && TYPES[m.type].row === 'mezz' && !TYPES[m.type].gap && UP_TOP + m.h > S.room.height);
  if (hiMezz.length) res.warnings.push(`Антресоли выше потолка ${S.room.height} мм: уменьшите высоту антресолей`);
  return res;
}

function calcAll(S, P, C){
  const R = layoutOf(S);
  const mods = activeModules(S).map(m => calcModule(m, S, P, C));
  const k = 1 + P.markup / 100, top = catFind(C.top, S.mat.top);
  const topLen = R.tops.reduce((s, t) => s + (t.x1 - t.x0), 0) / 1000;
  let joints = 0;
  if (R.walls.B && R.tops.some(t => t.wall === 'A' && t.x0 === 0) && R.tops.some(t => t.wall === 'B' && t.x0 === R.walls.B.offL)) joints++;
  if (R.walls.C && R.tops.some(t => t.wall === 'A' && t.x1 >= S.walls.A - 1) && R.tops.some(t => t.wall === 'C' && t.x0 === R.walls.C.offL)) joints++;
  const lowNonGap = mods.filter(r => TYPES[r.m.type].row === 'low' && !TYPES[r.m.type].gap);
  const plinthLen = lowNonGap.reduce((s, r) => s + r.m.w, 0) / 1000;
  const cuts = lowNonGap.reduce((s, r) => s + (r.m.cut && !TYPES[r.m.type].tall ? (r.m.cut.sink ? 1 : 0) + (r.m.cut.hob ? 1 : 0) : 0), 0);
  const ledLen = mods.reduce((s, r) => s + (r.light ? r.m.w : 0), 0) / 1000;
  const common = [];
  if (topLen > 0) common.push({n:'Столешница ' + top.name, q:topLen, u:'м.п.', unit:top.price});
  if (joints) common.push({n:'Угловое соединение столешницы', q:joints, u:'шт', unit:top.joint});
  if (cuts && topLen > 0) common.push({n:'Вырезы в столешнице под мойку и варочную', q:cuts, u:'шт', unit:top.cut});
  if (plinthLen > 0) common.push({n:'Цоколь', q:plinthLen, u:'м.п.', unit:P.plinth});
  if (S.mat.splash && topLen > 0) common.push({n:'Стеновая панель (фартук)', q:topLen, u:'м.п.', unit:P.splash});
  if (ledLen > 0) common.push({n:'Подсветка: блок питания и сенсорный выключатель', q:Math.ceil(ledLen / 4), u:'шт', unit:P.ledDriver});
  common.forEach(c => { c.cost = c.q * c.unit; c.price = c.cost * k; });
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const furnCost = sum(mods, r => r.cost), furnPrice = sum(mods, r => r.price);
  const commonCost = sum(common, c => c.cost), commonPrice = sum(common, c => c.price);
  const sub = furnPrice + commonPrice, disc = sub * (S.disc || 0) / 100, after = sub - disc;
  const install = after * P.install / 100, delivery = +P.delivery || 0, total = after + install + delivery;
  return {R, mods, common, topLen, plinthLen, ledLen, joints, cuts, furnCost, furnPrice, commonCost, commonPrice, sub, disc, after, install, delivery, total, totalCost:furnCost + commonCost, margin:after - furnCost - commonCost};
}

function bomOf(A, S, P, C){
  const rows = [], s = f => A.mods.reduce((t, r) => t + f(r), 0), Wt = P.waste, B = P.blum;
  rows.push({g:'Корпус'});
  const byDecor = {};
  A.mods.forEach(r => { if (!r.ldsp) return; byDecor[r.decor.id] = (byDecor[r.decor.id] || 0) + r.ldsp; });
  Object.entries(byDecor).forEach(([id, a]) => { const d = catFind(C.corpus, id);
    rows.push({n:`ЛДСП 16 мм ${d.name} (чисто ${a.toFixed(2)} м², ≈ ${Math.ceil(a * Wt.ldsp / SHEET_M2)} лист.)`, q:a * Wt.ldsp, u:'м²', p:d.price}); });
  rows.push({n:'ХДФ 3 мм, задние стенки', q:s(r => r.hdf) * Wt.hdf, u:'м²', p:P.hdf});
  rows.push({n:'Кромка ПВХ 2 мм', q:s(r => r.e2) * Wt.edge, u:'м', p:P.edge2});
  rows.push({n:'Кромка ПВХ 0,4 мм', q:s(r => r.e04) * Wt.edge, u:'м', p:P.edge04});
  rows.push({g:'Фасады'});
  const fm = catFind(C.facade, S.mat.facade), ml = catFind(C.milling, S.mat.milling), fg = {};
  A.mods.forEach(r => { if (!r.facs.length) return; const cid = facadeColorId(r.m, S); fg[cid] = fg[cid] || {a:0, n:0}; fg[cid].a += r.facArea; fg[cid].n += r.facs.length; });
  Object.entries(fg).forEach(([cid, v]) => rows.push({n:`${fm.name}, ${ml.name.toLowerCase()}, ${catFind(C.fcolor, cid).name.toLowerCase()} (${v.n} шт)`, q:v.a, u:'м²', p:fm.price + ml.add}));
  const glass = s(r => r.hw.glass); if (glass) rows.push({n:'Стекло для витрин', q:glass, u:'м²', p:P.glass});
  rows.push({g:'Фурнитура Blum и комплектующие'});
  const H = k => s(r => r.hw[k]), dr = DRAWERS[S.mat.drawers], dc = dr.colors.find(c => c.id === S.mat.drawerColor) || dr.colors[0];
  [['Петля CLIP top BLUMOTION', H('hinge'), B.hinge, 'шт'], [`Ящик ${dr.n}, ${dc.name.toLowerCase()}`, H('slide'), B[S.mat.drawers], 'шт'],
   ['Подъёмник AVENTOS HK top', H('lift'), B.aventos, 'шт'], ['Карго для бутылочницы', H('cargo'), B.cargo, 'шт'],
   ['Крепление фасада холодильника', H('fridge'), B.fridgeMount, 'шт'], ['Крепление фасада посудомойки', H('dw'), P.dwMount, 'шт'],
   ['Ручка-скоба', H('bar'), P.bar, 'шт'], ['Толкатель TIP-ON', H('push'), B.tipon, 'шт'], ['Профиль Gola', H('gola'), P.gola, 'м'],
   ['Светодиодная лента с профилем', A.ledLen, P.led, 'м'],
   ['Опора регулируемая', H('leg'), P.leg, 'шт'], ['Навес для верхнего модуля', H('hanger'), P.hanger, 'шт'],
   ['Полкодержатель', H('pin'), P.shelfPin, 'шт'], ['Крепёж, комплект на модуль', H('fix'), P.fixings, 'шт']]
    .forEach(([n, q, p, u]) => { if (q) rows.push({n, q, u, p}); });
  if (A.common.length){ rows.push({g:'Столешница и отделка'}); A.common.forEach(c => rows.push({n:c.n, q:c.q, u:c.u, p:c.unit})); }
  rows.forEach(r => { if (!r.g) r.sum = r.q * r.p; });
  return rows;
}
// CALC-END
