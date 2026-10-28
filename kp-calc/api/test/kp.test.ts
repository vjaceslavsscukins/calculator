// Этап 2: картинки, рендер без ключа, ссылки с сайтов (разбор и SSRF), КП-снимок, страница по ссылке, уведомления.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname } from 'node:os';
import { lookup } from 'node:dns/promises';
import { compute, DEFAULT_SETTINGS, kpItemPrice, kpTotals } from '../../engine/src/index.ts';
import type { CalcInput, Catalog } from '../../engine/src/index.ts';
import { CATALOG_FILE } from '../src/db.ts';
import { checkUrl, isPrivateAddress, linkPreview, parsePrice, parseProductHtml } from '../src/linkpreview.ts';
import { extractImage, RENDER_OFF } from '../src/ai.ts';
import { OWNER, SKIP, agent, keysDeep, makeUser, setup } from './helpers.ts';
import type { Agent, Ctx } from './helpers.ts';

const FIXTURE = new URL('./fixtures/product.html', import.meta.url);
// PNG 1×1
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('ссылки с сайтов: разбор страницы и защита от SSRF (без базы и без сети)', () => {
  test('JSON-LD Product важнее og; цена «45 990,00»; картинка — абсолютная ссылка', async () => {
    const html = await readFile(FIXTURE, 'utf8');
    const r = parseProductHtml(html, 'https://shop.example.ru/catalog/subline');
    assert.deepEqual(r, { name: 'Мойка Blanco Subline 500-U & сифон', price: 45990, currency: 'RUB', image: 'https://cdn.example.ru/subline-1.jpg' });
  });
  test('без JSON-LD: og:title, product:price:amount, og:image относительная; без og — <title>', () => {
    const html = '<html><head><meta content="Стул &laquo;Оскар&raquo;" property="og:title"><meta property="product:price:amount" content="12990.50"><meta property="og:image" content="/i/1.webp"><title>x</title></head></html>';
    assert.deepEqual(parseProductHtml(html, 'https://a.ru/p/1'), { name: 'Стул «Оскар»', price: 12990.5, image: 'https://a.ru/i/1.webp' });
    assert.deepEqual(parseProductHtml('<title>  Лампа\n Arte </title>', 'https://a.ru/'), { name: 'Лампа Arte' });
  });
  test('цены в разных записях', () => {
    assert.equal(parsePrice('12 990 ₽'), 12990);
    assert.equal(parsePrice('12,990.50'), 12990.5);
    assert.equal(parsePrice('1.234.567'), 1234567);
    assert.equal(parsePrice('0'), undefined);
    assert.equal(parsePrice('цена по запросу'), undefined);
  });
  test('частные и локальные адреса запрещены', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-ip']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '77.88.55.88', '2a00:1450:4010:c05::64', '::ffff:8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);
    for (const u of ['ftp://a.ru/x', 'file:///etc/passwd', 'http://127.0.0.1/', 'http://[::1]:8787/', 'http://localhost/', 'http://user:pass@a.ru/', 'javascript:alert(1)']) {
      assert.throws(() => checkUrl(u), u);
    }
  });
  test('DNS-имя, которое ведёт на локальный адрес, — отказ; с флагом теста — разбор с локального сервера', async () => {
    const html = await readFile(FIXTURE);
    const srv = createServer((req, res) => {
      if (req.url === '/go') { res.writeHead(302, { location: '/item' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as AddressInfo).port;
    try {
      // имя из /etc/hosts, которое ведёт на 127.0.0.1 (имя машины): отказ после DNS
      const host = hostname();
      const addrs = await lookup(host, { all: true }).catch(() => []);
      if (addrs.length && addrs.every((a) => isPrivateAddress(a.address))) await assert.rejects(linkPreview(`http://${host}:${port}/item`), /запрещён/);
      await assert.rejects(linkPreview(`http://127.0.0.1:${port}/item`), /запрещён/);
      const r = await linkPreview(`http://127.0.0.1:${port}/go`, { allowPrivate: true });
      assert.equal(r.name, 'Мойка Blanco Subline 500-U & сифон');
      assert.equal(r.price, 45990);
      assert.equal(r.url, `http://127.0.0.1:${port}/item`);
    } finally { srv.close(); }
  });
});

describe('рендер: разбор ответа шлюза', () => {
  const b64 = PNG.toString('base64');
  test('images[] (OpenRouter/AITunnel), content с data:URL, массив частей, b64_json', () => {
    const forms = [
      { choices: [{ message: { content: 'Готово', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] } }] },
      { choices: [{ message: { content: `Вот: ![render](data:image/png;base64,${b64})` } }] },
      { choices: [{ message: { content: [{ type: 'text', text: 'ok' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] } }] },
      { data: [{ b64_json: b64.repeat(3) }] },
    ];
    for (const f of forms) {
      const r = extractImage(f);
      assert.ok(r && r.kind === 'data', JSON.stringify(f).slice(0, 80));
    }
    assert.deepEqual(extractImage({ choices: [{ message: { content: 'https://cdn.x.ru/out.png' } }] }), { kind: 'url', url: 'https://cdn.x.ru/out.png' });
    assert.equal(extractImage({ choices: [{ message: { content: 'Не могу нарисовать' } }] }), null);
  });
});

describe('КП: картинки, снимок, страница по ссылке, уведомления', { skip: SKIP }, () => {
  let ctx: Ctx, owner: Agent, m1: Agent, m2: Agent, m1User: any;
  let catalogJson: Catalog, ldsp: string, hw: string;
  let client: string, calcA: string, calcB: string, sketch: string;
  const inputA = (itemLdsp: string, itemHw: string): CalcInput => ({
    kind: 'kitchen',
    rows: [
      { id: 'a1', block: 'up', qty: 5, itemId: itemLdsp },
      { id: 'a2', block: 'hw', qty: 10, itemId: itemHw },
    ],
    light: { enabled: false, profileId: 'inset', segments: [] },
    discountPct: 10,
    deliveryRub: 7000,
  });

  before(async () => {
    ctx = await setup();
    owner = agent(ctx.app);
    await owner.login(OWNER.email, OWNER.password);
    const msk = (await owner.get('/api/meta')).body.cities.find((c: any) => c.name === 'Москва').id;
    catalogJson = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
    ldsp = catalogJson.groups.find((g) => g.category === 'ЛДСП корпус')!.items.find((i) => !i.status && i.price > 0)!.id;
    hw = catalogJson.groups.find((g) => g.category === 'Фурнитура')!.items.find((i) => !i.status && i.price > 0)!.id;
    const r1 = await makeUser(ctx.app, owner, { firstName: 'Мария', lastName: 'Петрова', email: 'm1@kp.local', role: 'manager', cityId: msk });
    m1 = r1.agent; m1User = r1.user;
    m2 = (await makeUser(ctx.app, owner, { firstName: 'Михаил', email: 'm2@kp.local', role: 'manager', cityId: msk })).agent;
    const p = await owner.patch(`/api/users/${m1User.id}`, { phone: '+7 900 111-22-33', position: 'Менеджер салона' });
    assert.equal(p.body.user.phone, '+7 900 111-22-33');
    assert.equal(p.body.user.position, 'Менеджер салона');
    client = (await m1.post('/api/clients', { name: 'Анна Смирнова', phone: '+7 916 555-44-33' })).body.client.id;
    const a = (await m1.post('/api/calculations', { clientId: client, title: 'Кухня', kind: 'kitchen' })).body.calculation;
    calcA = a.id;
    assert.equal((await m1.put(`/api/calculations/${calcA}`, { rev: a.rev, status: 'saved', input: inputA(ldsp, hw) })).status, 200);
    const b = (await m1.post('/api/calculations', { clientId: client, title: 'Шкаф в прихожую', kind: 'cabinet' })).body.calculation;
    calcB = b.id;
    await m1.put(`/api/calculations/${calcB}`, { rev: b.rev, input: { ...inputA(ldsp, hw), kind: 'cabinet', discountPct: 0, deliveryRub: 0, rows: [{ id: 'b1', block: 'body', qty: 3, itemId: ldsp }] } });
  });
  after(async () => { await ctx?.close(); });

  test('картинки: загрузка png, проверка типа и размера, доступ только своим', async () => {
    const bad = await m1.upload(`/api/calculations/${calcA}/images`, Buffer.from('<svg/>'), 'image/png');
    assert.equal(bad.status, 400);
    const up = await m1.upload(`/api/calculations/${calcA}/images`, PNG, 'image/png', { 'x-file-name': encodeURIComponent('эскиз кухни.png') });
    assert.equal(up.status, 200, up.raw);
    sketch = up.body.image.id;
    assert.equal(up.body.image.title, 'эскиз кухни');
    assert.equal(up.body.image.kind, 'sketch');
    const big = await m1.upload(`/api/calculations/${calcA}/images`, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'image/png');
    assert.equal(big.status, 413);
    const list = await m1.get(`/api/calculations/${calcA}/images`);
    assert.equal(list.body.images.length, 1);
    assert.equal(list.body.renderEnabled, false);
    const img = await m1.get(`/api/images/${sketch}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.ok(img.bytes.equals(PNG));
    assert.equal((await m2.get(`/api/images/${sketch}`)).status, 404, 'чужой менеджер не видит картинку');
    assert.equal((await agent(ctx.app).get(`/api/images/${sketch}`)).status, 401);
    const pt = await m1.patch(`/api/images/${sketch}`, { inKp: false });
    assert.equal(pt.body.image.inKp, false);
    await m1.patch(`/api/images/${sketch}`, { inKp: true });
    const { rows } = await ctx.pool.query('select storage from images where id = $1', [sketch]);
    assert.equal(rows[0].storage, 'db', 'без S3 — в базе');
  });

  test('рендер без ключа нейросети: 503 и понятный текст', async () => {
    const r = await m1.post(`/api/calculations/${calcA}/render`, { imageId: sketch, comment: 'фасады темнее' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, RENDER_OFF);
    assert.equal((await m2.post(`/api/calculations/${calcA}/render`, { imageId: sketch })).status, 404);
  });

  test('link-preview: локальный адрес запрещён, неверная ссылка — 400', async () => {
    const r = await m1.post('/api/link-preview', { url: 'http://127.0.0.1:8787/api/settings' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /запрещён/);
    assert.equal((await m1.post('/api/link-preview', { url: 'ftp://x.ru' })).status, 400);
    assert.equal((await agent(ctx.app).post('/api/link-preview', { url: 'https://a.ru' })).status, 401);
  });

  let kp: any;
  test('сборка КП: черновик, текст по шаблону, снимок с ценами движка, статусы', async () => {
    const draft = await m1.get(`/api/clients/${client}/kp-draft`);
    assert.equal(draft.status, 200);
    assert.equal(draft.body.items.length, 2);
    const dA = draft.body.items.find((x: any) => x.calculationId === calcA);
    assert.ok(dA.materials.some((m: any) => m.role.startsWith('Корпус')));
    assert.equal(dA.imageId, sketch);
    assertNoCostKeys(draft.body, 'черновик КП');
    const txt = await m1.post(`/api/calculations/${calcA}/kp-text`, { title: 'Кухня', materials: dA.materials });
    assert.equal(txt.body.source, 'template');
    assert.match(txt.body.text, /производстве/);

    const prev = await m1.post('/api/kp/preview', { clientId: client, calculationIds: [calcA, calcB] });
    const engineTotal = (() => {
      const cat = catalogJson;
      const a = inputA(ldsp, hw);
      const b = { ...a, kind: 'cabinet' as const, discountPct: 0, deliveryRub: 0, rows: [{ id: 'b1', block: 'body', qty: 3, itemId: ldsp }] };
      return kpTotals([kpItemPrice(compute(a, cat, DEFAULT_SETTINGS), a), kpItemPrice(compute(b, cat, DEFAULT_SETTINGS), b)]);
    })();
    assert.deepEqual(prev.body.totals, engineTotal);

    const body = {
      clientId: client, theme: 'light',
      items: [
        { calculationId: calcA, title: 'Кухня с островом', dims: 'Высота 2140 мм · длина 2726 мм · глубина 600 мм', about: txt.body.text, materials: dA.materials, benefits: ['Плавное закрывание'], imageId: sketch },
        { calculationId: calcB, title: 'Шкаф в прихожую', dims: 'Шкаф · антресоль', about: '', materials: [], benefits: [], imageId: null },
      ],
    };
    assert.equal((await m2.post('/api/kp', body)).status, 404, 'чужой клиент');
    const r = await m1.post('/api/kp', body);
    assert.equal(r.status, 200, r.raw);
    kp = r.body.kp;
    assert.equal(kp.number, 'КП-0001');
    assert.equal(kp.version, 1);
    assert.equal(kp.total, engineTotal.total);
    assert.match(kp.url, /^https:\/\/kp\.test\/p\/[A-Za-z0-9_-]{43}$/);
    const token = kp.url.split('/p/')[1];
    assert.ok(token.length >= 32);
    const calcs = (await m1.get(`/api/clients/${client}`)).body.calculations;
    assert.ok(calcs.every((c: any) => c.status === 'in_kp'), 'статус расчётов — «в КП»');
    const det = await m1.get(`/api/kp/${kp.id}`);
    assert.equal(det.body.snapshot.manager.phone, '+7 900 111-22-33');
    assert.equal(det.body.snapshot.items[0].price.discountPct, 10);
    assertNoCostKeys(det.body.snapshot, 'снимок КП');
    // второй КП того же клиента — новый номер, токен другой
    const r2 = await m1.post('/api/kp', { ...body, items: [body.items[1]] });
    assert.equal(r2.body.kp.number, 'КП-0002');
    assert.notEqual(r2.body.kp.url, kp.url);
  });

  test('снимок не меняется после правки цены в прайсе; новая версия — по новым ценам', async () => {
    const token = kp.url.split('/p/')[1];
    const before = (await agent(ctx.app).get(`/p/${token}`)).raw;
    const item = catalogJson.groups.flatMap((g) => g.items).find((i) => i.id === ldsp)!;
    assert.equal((await owner.patch(`/api/catalog/items/${ldsp}`, { price: item.price * 3 })).status, 200);
    const calcNow = (await m1.get(`/api/calculations/${calcA}`)).body.view.total;
    assert.ok(calcNow > kp.total, 'расчёт пересчитался по новой цене');
    const det = await m1.get(`/api/kp/${kp.id}`);
    assert.equal(det.body.kp.total, kp.total);
    assert.equal(det.body.snapshot.totals.total, kp.total);
    const after = (await agent(ctx.app).get(`/p/${token}`)).raw;
    const strip = (s: string) => s.replace(/nonce-[^']+'|nonce="[^"]+"/g, '');
    assert.equal(strip(after), strip(before), 'страница КП не изменилась');
    const v2 = await m1.post('/api/kp', { clientId: client, baseKpId: kp.id, items: [{ calculationId: calcA, title: 'Кухня', materials: [], benefits: [] }] });
    assert.equal(v2.status, 200, v2.raw);
    assert.equal(v2.body.kp.number, 'КП-0001');
    assert.equal(v2.body.kp.version, 2);
    assert.ok(v2.body.kp.total > kp.total);
    const list = (await m1.get(`/api/clients/${client}/kps`)).body.kps;
    assert.deepEqual(list.map((k: any) => `${k.number} v${k.version}`), ['КП-0002 v1', 'КП-0001 v2', 'КП-0001 v1']);
  });

  test('страница по ссылке без входа: имя и город клиента, без телефона клиента и себестоимости; неверный токен — 404', async () => {
    const token = kp.url.split('/p/')[1];
    const guest = agent(ctx.app);
    const page = await guest.get(`/p/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.headers['content-security-policy'], /script-src 'nonce-/);
    assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
    const html = page.raw;
    assert.match(html, /Анна Смирнова/);
    assert.match(html, /Кухня с островом/);
    assert.match(html, /\+7 900 111-22-33/, 'телефон менеджера есть');
    assert.ok(!html.includes('916'), 'телефона клиента нет');
    assert.ok(!/себестоим|unitCost|costByGroup|"cost"|margin|маржа/i.test(html), 'себестоимости нет');
    assert.match(html, /data-kp="light"/);
    assert.match((await guest.get(`/p/${token}?theme=dark`)).raw, /data-kp="dark"/);
    assert.match(html, /Эскиз проекта/);
    // картинка КП — по ключу КП; чужая картинка по этому ключу — 404
    const img = await guest.get(`/p/${token}/img/${sketch}`);
    assert.equal(img.status, 200);
    assert.ok(img.bytes.equals(PNG));
    const other = (await m1.upload(`/api/calculations/${calcB}/images`, PNG, 'image/png')).body.image.id;
    assert.equal((await guest.get(`/p/${token}/img/${other}`)).status, 404);
    // удалённая из расчёта картинка в КП остаётся
    await m1.del(`/api/images/${sketch}`);
    assert.equal((await guest.get(`/p/${token}/img/${sketch}`)).status, 200);
    assert.equal((await guest.get(`/p/${'x'.repeat(43)}`)).status, 404);
    assert.equal((await guest.get('/p/short')).status, 404);
  });

  test('открытия, «Утвердить проект», «Задать вопрос» → уведомления менеджеру; «отправлено» → статус kp_sent', async () => {
    const token = kp.url.split('/p/')[1];
    const guest = agent(ctx.app);
    assert.equal((await guest.post(`/p/${token}/open`)).status, 200);
    assert.equal((await guest.post(`/p/${token}/open`)).status, 200);
    const det = (await m1.get(`/api/kp/${kp.id}`)).body;
    assert.equal(det.kp.views, 2);
    assert.ok(det.kp.firstViewedAt && det.kp.lastViewedAt);
    assert.equal((await guest.post(`/p/${token}/action`, { type: 'approve' })).status, 200);
    assert.equal((await guest.post(`/p/${token}/action`, { type: 'question', message: '' })).status, 400);
    assert.equal((await guest.post(`/p/${token}/action`, { type: 'question', message: 'Можно ли фасады темнее?' })).status, 200);
    assert.equal((await guest.post(`/p/${token}/action`, { type: 'hack' })).status, 400);
    const n = (await m1.get('/api/notifications')).body;
    assert.equal(n.unread, 3, 'первое открытие, утверждение, вопрос');
    assert.deepEqual(n.items.map((x: any) => x.type), ['question', 'approve', 'open']);
    assert.match(n.items[0].text, /фасады темнее/);
    assert.equal((await m2.get('/api/notifications')).body.unread, 0);
    await m1.post('/api/notifications/read', {});
    assert.equal((await m1.get('/api/notifications')).body.unread, 0);
    const { rows } = await ctx.pool.query('select * from kp_events where kp_id = $1', [kp.id]);
    assert.ok(rows.every((r) => !('ip' in r)), 'без IP');
    const s = await m1.post(`/api/kp/${kp.id}/sent`, { channel: 'whatsapp' });
    assert.ok(s.body.kp.sentAt);
    const calcs = (await m1.get(`/api/clients/${client}`)).body.calculations;
    assert.equal(calcs.find((c: any) => c.id === calcA).status, 'kp_sent');
  });

  test('компания: правит только владелец; фото обложки попадает в новое КП', async () => {
    const cur = (await m1.get('/api/company')).body;
    assert.equal(cur.company.warrantyBig, '10 лет');
    assert.equal((await m1.put('/api/company', { rev: cur.rev, company: cur.company })).status, 403);
    const up = await owner.put('/api/company', { rev: cur.rev, company: { ...cur.company, phone: '+7 800 000-00-00' } });
    assert.equal(up.status, 200, up.raw);
    assert.equal((await owner.put('/api/company', { rev: cur.rev, company: cur.company })).status, 409);
    const cov = await owner.upload('/api/company/cover', PNG, 'image/png');
    assert.ok(cov.body.company.coverImageId);
    const r = await m1.post('/api/kp', { clientId: client, items: [{ calculationId: calcB }] });
    const token = r.body.kp.url.split('/p/')[1];
    const html = (await agent(ctx.app).get(`/p/${token}`)).raw;
    assert.match(html, /\+7 800 000-00-00/);
    assert.equal((await agent(ctx.app).get(`/p/${token}/img/${cov.body.company.coverImageId}`)).status, 200);
  });

  test('настройки: базовый промт рендера правит владелец', async () => {
    const s = (await owner.get('/api/settings')).body;
    assert.match(s.renderPrompt, /PRO100/);
    const { rev, ...settings } = s;
    const r = await owner.put('/api/settings', { rev, settings: { ...settings, renderPrompt: 'Свой промт' } });
    assert.equal(r.status, 200, r.raw);
    assert.equal(r.body.settings.renderPrompt, 'Свой промт');
    assert.equal((await m1.get('/api/settings')).body.renderPrompt, undefined, 'менеджеру промт не нужен');
  });
});

function assertNoCostKeys(body: unknown, where: string) {
  const keys = keysDeep(body);
  for (const k of ['cost', 'prod', 'margin', 'costByGroup', 'unitCost', 'costNote']) assert.ok(!keys.has(k), `${where}: поле ${k}`);
}
