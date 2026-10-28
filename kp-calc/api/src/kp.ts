// Этап 2: картинки расчёта, рендер по эскизу, ссылки с сайтов, сборка КП (снимок), страница КП по ссылке,
// отправка, уведомления, данные компании. Цены — только из engine (compute → kpItemPrice → kpTotals).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { KIND_TITLES, compute, kpBenefits, kpItemPrice, kpMaterials, kpTotals } from '../../engine/src/index.ts';
import type { CalcInput, CatalogIndex, ProductKind, Settings } from '../../engine/src/index.ts';
import { AiError, RENDER_OFF, aboutText, renderConfigured, renderImage, renderPrompt, templateAbout, textConfigured } from './ai.ts';
import type { AiEnv } from './ai.ts';
import { tx } from './db.ts';
import { DEFAULT_COMPANY, cleanCompany, kpNumber, normalizeCompany } from './kpdata.ts';
import type { KpSnapshot, KpSnapshotItem } from './kpdata.ts';
import { renderKpPage } from './kppage.ts';
import { LinkPreviewError, linkPreview } from './linkpreview.ts';
import { newToken } from './security.ts';
import { MAX_IMAGE, createStorage, sniffImage } from './storage.ts';
import type { S3Env } from './storage.ts';
import { HttpError } from './view.ts';
import type { Role } from './view.ts';

export interface KpUser { id: string; firstName: string; lastName: string; email: string; role: Role; cityId: number | null; cityName: string | null }

export interface KpDeps {
  pool: pg.Pool;
  publicUrl?: string;
  env: AiEnv & S3Env & { LINK_PREVIEW_ALLOW_PRIVATE?: string };
  pricing(): Promise<{ idx: CatalogIndex; settings: Settings }>;
  me(req: FastifyRequest): KpUser;
  need(req: FastifyRequest, ...roles: Role[]): KpUser;
  visibleCalc(u: KpUser, id: string, db?: pg.Pool | pg.PoolClient): Promise<any>;
  visibleClient(u: KpUser, id: string, db?: pg.Pool | pg.PoolClient): Promise<any>;
  scope(u: KpUser, params: unknown[]): string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{32,100}$/;
const notFound = () => new HttpError(404, 'Не найдено');
const uuid = (v: unknown, msg = 'Не найдено') => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(404, msg);
  return v;
};
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v: unknown, max: number, len = 200) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const fullName = (a: string, b: string) => `${a ?? ''} ${b ?? ''}`.trim();
const KP_MAX_ITEMS = 20;

const imageJson = (r: any) => ({
  id: r.id, kind: r.kind, title: r.title, mime: r.mime, size: r.size, inKp: r.in_kp, createdAt: r.created_at, url: `/api/images/${r.id}`,
});

export async function registerKp(app: FastifyInstance, d: KpDeps): Promise<void> {
  const { pool, env } = d;
  const storage = createStorage(pool, env);
  const allowPrivate = /^(1|true|yes)$/i.test(env.LINK_PREVIEW_ALLOW_PRIVATE ?? '');
  const origin = (req: FastifyRequest) => (d.publicUrl || `${req.protocol}://${req.host}`).replace(/\/$/, '');

  // картинки приходят телом запроса как есть (image/png, image/jpeg, image/webp) — без multipart и нативных зависимостей
  app.addContentTypeParser(['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_IMAGE },
    (req, body, done) => done(null, body));

  async function saveImage(db: pg.Pool | pg.PoolClient, data: Buffer, o: { calcId: string | null; kind: 'sketch' | 'render' | 'cover'; title: string; userId: string; inKp?: boolean; sourceId?: string }) {
    const mime = sniffImage(data);
    if (!mime) throw new HttpError(400, 'Нужна картинка PNG, JPG или WebP');
    if (data.length > MAX_IMAGE) throw new HttpError(413, 'Картинка больше 10 МБ');
    const id = crypto.randomUUID();
    // сначала содержимое, потом запись: картинка без содержимого в списке не появится
    await storage.put(id, data, mime);
    const { rows: [r] } = await db.query(
      `insert into images (id, calculation_id, kind, title, mime, size, storage, in_kp, source_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [id, o.calcId, o.kind, o.title.slice(0, 200), mime, data.length, storage.kind, o.inKp ?? false, o.sourceId ?? null, o.userId]);
    return r;
  }

  async function sendImage(reply: FastifyReply, r: any) {
    const data = await storage.get(r.id, r.storage);
    if (!data) throw notFound();
    reply.header('content-type', r.mime);
    reply.header('cache-control', 'private, max-age=86400, immutable');
    reply.header('content-security-policy', "default-src 'none'");
    reply.header('content-disposition', 'inline');
    return reply.send(data);
  }

  /** Картинка, которую пользователь видит: картинка расчёта — по видимости клиента; фото обложки — всем вошедшим. */
  async function visibleImage(u: KpUser, id: string, withDeleted = false) {
    const { rows: [r] } = await pool.query('select * from images where id = $1', [id]);
    if (!r || (!withDeleted && r.deleted_at)) throw notFound();
    if (r.calculation_id) await d.visibleCalc(u, r.calculation_id);
    return r;
  }

  // ========== Картинки расчёта ==========
  app.get('/api/calculations/:id/images', async (req: any) => {
    const u = d.me(req);
    const c = await d.visibleCalc(u, uuid(req.params.id));
    const { rows } = await pool.query('select * from images where calculation_id = $1 and deleted_at is null order by created_at', [c.id]);
    return { images: rows.map(imageJson), renderEnabled: renderConfigured(env) };
  });

  app.post('/api/calculations/:id/images', { bodyLimit: MAX_IMAGE }, async (req: any) => {
    const u = d.me(req);
    const c = await d.visibleCalc(u, uuid(req.params.id));
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Нужна картинка PNG, JPG или WebP');
    let title = '';
    try { title = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).replace(/\.[a-z0-9]+$/i, ''); } catch { /* имя файла не обязательно */ }
    if (!title) {
      const { rows: [{ n }] } = await pool.query(`select count(*)::int as n from images where calculation_id = $1 and kind = 'sketch'`, [c.id]);
      title = `Эскиз ${n + 1}`;
    }
    const r = await saveImage(pool, req.body, { calcId: c.id, kind: 'sketch', title, userId: u.id, inKp: true });
    return { image: imageJson(r) };
  });

  app.get('/api/images/:id', async (req: any, reply) => {
    const r = await visibleImage(d.me(req), uuid(req.params.id), true);
    return sendImage(reply, r);
  });

  app.patch('/api/images/:id', async (req: any) => {
    const u = d.me(req);
    const r = await visibleImage(u, uuid(req.params.id));
    if (!r.calculation_id) throw new HttpError(400, 'Это фото обложки: меняется в разделе «Компания»');
    const b = req.body ?? {};
    const inKp = typeof b.inKp === 'boolean' ? b.inKp : r.in_kp;
    const title = b.title !== undefined ? str(b.title, 200) || r.title : r.title;
    const { rows: [n] } = await pool.query('update images set in_kp = $1, title = $2 where id = $3 returning *', [inKp, title, r.id]);
    return { image: imageJson(n) };
  });

  // «удалить» = скрыть из расчёта; в отправленных КП картинка остаётся (снимок)
  app.delete('/api/images/:id', async (req: any) => {
    const u = d.me(req);
    const r = await visibleImage(u, uuid(req.params.id));
    if (!r.calculation_id) throw new HttpError(400, 'Это фото обложки: меняется в разделе «Компания»');
    await pool.query('update images set deleted_at = now(), in_kp = false where id = $1', [r.id]);
    return {};
  });

  // ========== Рендер по эскизу ==========
  async function materialsOf(input: CalcInput) {
    const p = await d.pricing();
    return kpMaterials(input, p.idx, p.settings);
  }

  /**
   * Рендер: эскиз + базовый промт из настроек + материалы + «что поправить». previousId — предыдущий рендер (перегенерация):
   * прикладывается вторым изображением. Каждая генерация — новая картинка «Рендер N»; в журнал — кто и что генерировал.
   */
  app.post('/api/calculations/:id/render', async (req: any) => {
    const u = d.me(req);
    const c = await d.visibleCalc(u, uuid(req.params.id));
    if (!renderConfigured(env)) throw new HttpError(503, RENDER_OFF);
    const b = req.body ?? {};
    const imageId = uuid(b.imageId, 'Выберите эскиз для рендера');
    const load = async (id: string, what: string) => {
      const { rows: [img] } = await pool.query('select * from images where id = $1 and calculation_id = $2 and deleted_at is null', [id, c.id]);
      const data = img ? await storage.get(img.id, img.storage) : null;
      if (!img || !data) throw new HttpError(404, `${what} не найден`);
      return { img, data };
    };
    const src = await load(imageId, 'Эскиз');
    const prev = b.previousId ? await load(uuid(b.previousId, 'Предыдущий рендер не найден'), 'Предыдущий рендер') : null;
    const comment = str(b.comment, 1000);
    const p = await d.pricing();
    const prompt = renderPrompt({
      base: p.settings.renderPrompt, kindTitle: KIND_TITLES[c.kind as ProductKind] ?? 'Мебель', title: c.title,
      materials: kpMaterials(c.input, p.idx, p.settings), comment, withPrevious: !!prev,
    });
    let out: { mime: string; data: Buffer };
    try {
      out = await renderImage(env, [{ mime: src.img.mime, data: src.data }, ...(prev ? [{ mime: prev.img.mime, data: prev.data }] : [])], prompt);
    } catch (e) {
      if (e instanceof AiError) throw new HttpError(e.status, e.message);
      throw e;
    }
    if (!sniffImage(out.data)) throw new HttpError(502, 'Нейросеть вернула не картинку');
    const { rows: [{ n }] } = await pool.query(`select count(*)::int as n from images where calculation_id = $1 and kind = 'render'`, [c.id]);
    const r = await saveImage(pool, out.data, { calcId: c.id, kind: 'render', title: `Рендер ${n + 1}`, userId: u.id, inKp: false, sourceId: src.img.id });
    await pool.query('insert into audit_log (user_id, user_name, action, entity, details) values ($1,$2,$3,$4,$5)', [
      u.id, fullName(u.firstName, u.lastName) || u.email, prev ? 'Перегенерация рендера' : 'Рендер по эскизу', 'Рендер',
      JSON.stringify({ calculationId: c.id, calculation: c.title, client: c.client_name, image: r.title, comment: comment || undefined }),
    ]);
    return { image: imageJson(r) };
  });

  // ========== Ссылки с сайтов ==========
  app.post('/api/link-preview', async (req: any) => {
    d.me(req);
    const url = str(req.body?.url, 2000);
    if (!url) throw new HttpError(400, 'Вставьте ссылку на товар');
    try {
      const r = await linkPreview(url, { allowPrivate });
      return { name: r.name, ...(r.price != null ? { price: r.price } : {}), ...(r.currency ? { currency: r.currency } : {}), ...(r.image ? { image: r.image } : {}) };
    } catch (e) {
      if (e instanceof LinkPreviewError) throw new HttpError(e.status, e.message);
      throw e;
    }
  });

  // ========== Данные изделия для КП ==========
  async function itemDraft(c: any) {
    const p = await d.pricing();
    const materials = kpMaterials(c.input, p.idx, p.settings);
    const info = c.kp_info ?? {};
    const { rows: imgs } = await pool.query('select * from images where calculation_id = $1 and deleted_at is null order by in_kp desc, (kind = \'render\') desc, created_at desc', [c.id]);
    const price = kpItemPrice(compute(c.input, p.idx, p.settings), c.input);
    return {
      calculationId: c.id, kind: c.kind, calcTitle: c.title, status: c.status,
      title: str(info.title, 200) || c.title,
      dims: str(info.dims, 300),
      about: str(info.about, 3000),
      materials,
      benefits: Array.isArray(info.benefits) ? strList(info.benefits, 8) : kpBenefits(materials),
      images: imgs.map(imageJson),
      imageId: imgs.find((x) => x.in_kp)?.id ?? imgs[0]?.id ?? null,
      price,
    };
  }

  app.get('/api/clients/:id/kp-draft', async (req: any) => {
    const u = d.me(req);
    const cl = await d.visibleClient(u, uuid(req.params.id));
    const params: unknown[] = [cl.id];
    const { rows } = await pool.query(
      `select k.* from calculations k join clients cl on cl.id = k.client_id where k.client_id = $1 and k.status <> 'archived' and ${d.scope(u, params)} order by k.updated_at desc`, params);
    const items = [] as any[];
    for (const c of rows) items.push(await itemDraft(c));
    let base: any = null;
    if (req.query?.base) {
      const k = await visibleKp(u, uuid(req.query.base));
      if (k.client_id !== cl.id) throw notFound();
      const snap = k.snapshot as KpSnapshot;
      base = { id: k.id, number: snap.number, version: snap.version, theme: k.theme, items: snap.items.map((it) => ({ calculationId: it.calculationId, title: it.title, dims: it.dims, about: it.about, materials: it.materials, benefits: it.benefits, imageId: it.image?.id ?? null })) };
    }
    const validUntil = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    return { client: { id: cl.id, name: cl.name, cityName: cl.city_name }, items, base, validUntil, aiText: textConfigured(env) };
  });

  app.post('/api/calculations/:id/kp-text', async (req: any) => {
    const u = d.me(req);
    const c = await d.visibleCalc(u, uuid(req.params.id));
    const b = req.body ?? {};
    const materials = Array.isArray(b.materials)
      ? b.materials.map((m: any) => ({ role: str(m?.role, 80), value: str(m?.value, 300) })).filter((m: any) => m.role && m.value).slice(0, 30)
      : await materialsOf(c.input);
    const title = str(b.title, 200) || c.title;
    const kind = c.kind as ProductKind;
    if (textConfigured(env)) {
      try {
        const text = await aboutText(env, { kindTitle: KIND_TITLES[kind], title, dims: str(b.dims, 300), materials, benefits: strList(b.benefits, 8) });
        return { text, source: 'ai' };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        return { text: templateAbout(kind, title, materials), source: 'template', note: `${e.message}. Подставили шаблонный текст.` };
      }
    }
    return { text: templateAbout(kind, title, materials), source: 'template', note: 'Нейросеть для текста не подключена: подставили шаблонный текст по материалам.' };
  });

  /** Цены изделий и итог КП — из движка, по текущему прайсу (до формирования). */
  async function pricedCalcs(u: KpUser, clientId: string, ids: string[]) {
    if (!ids.length) throw new HttpError(400, 'Отметьте хотя бы один расчёт');
    if (ids.length > KP_MAX_ITEMS) throw new HttpError(400, `В одном КП не больше ${KP_MAX_ITEMS} изделий`);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Расчёт отмечен дважды');
    const p = await d.pricing();
    const out = [] as { c: any; price: ReturnType<typeof kpItemPrice> }[];
    for (const id of ids) {
      const c = await d.visibleCalc(u, uuid(id, 'Расчёт не найден'));
      if (c.client_id !== clientId) throw new HttpError(400, 'Расчёт другого клиента');
      out.push({ c, price: kpItemPrice(compute(c.input, p.idx, p.settings), c.input) });
    }
    return { list: out, settings: p.settings };
  }

  app.post('/api/kp/preview', async (req: any) => {
    const u = d.me(req);
    const cl = await d.visibleClient(u, uuid(req.body?.clientId));
    const ids = Array.isArray(req.body?.calculationIds) ? req.body.calculationIds : [];
    const { list } = await pricedCalcs(u, cl.id, ids);
    return { items: list.map((x) => ({ calculationId: x.c.id, price: x.price })), totals: kpTotals(list.map((x) => x.price)) };
  });

  // ========== КП ==========
  const KP_SQL = `select k.*, cl.name as client_name, cl.manager_id, cl.city_id, ub.first_name as ub_first, ub.last_name as ub_last
    from kps k join clients cl on cl.id = k.client_id left join users ub on ub.id = k.created_by`;
  async function visibleKp(u: KpUser, id: string) {
    const params: unknown[] = [id];
    const { rows: [r] } = await pool.query(`${KP_SQL} where k.id = $1 and ${d.scope(u, params)}`, params);
    if (!r) throw notFound();
    return r;
  }
  const kpJson = (req: FastifyRequest, r: any) => ({
    id: r.id, number: kpNumber(r.number), version: r.version, clientId: r.client_id, clientName: r.client_name,
    url: `${origin(req)}/p/${r.token}`, total: r.total, theme: r.theme, validUntil: String(r.valid_until).slice(0, 10),
    createdAt: r.created_at, createdBy: r.ub_first != null ? fullName(r.ub_first, r.ub_last) : null,
    sentAt: r.sent_at, views: r.views, firstViewedAt: r.first_viewed_at, lastViewedAt: r.last_viewed_at, approvedAt: r.approved_at,
    items: ((r.snapshot?.items ?? []) as KpSnapshotItem[]).map((it) => ({ calculationId: it.calculationId, title: it.title })),
  });

  app.get('/api/clients/:id/kps', async (req: any) => {
    const u = d.me(req);
    const cl = await d.visibleClient(u, uuid(req.params.id));
    const { rows } = await pool.query(`${KP_SQL} where k.client_id = $1 order by k.number desc, k.version desc`, [cl.id]);
    return { kps: rows.map((r) => kpJson(req, r)) };
  });

  app.get('/api/kp/:id', async (req: any) => {
    const u = d.me(req);
    const r = await visibleKp(u, uuid(req.params.id));
    const { rows: events } = await pool.query('select type, message, created_at from kp_events where kp_id = $1 order by created_at desc limit 200', [r.id]);
    const { rows: versions } = await pool.query(`${KP_SQL} where k.number = $1 order by k.version desc`, [r.number]);
    return {
      kp: kpJson(req, r), snapshot: r.snapshot, clientPhone: (await d.visibleClient(u, r.client_id)).phone,
      events: events.map((e) => ({ type: e.type, message: e.message, at: e.created_at })),
      versions: versions.map((v) => kpJson(req, v)),
    };
  });

  app.post('/api/kp', async (req: any) => {
    const u = d.me(req);
    const b = req.body ?? {};
    const cl = await d.visibleClient(u, uuid(b.clientId, 'Клиент не найден'));
    const raw: any[] = Array.isArray(b.items) ? b.items : [];
    const { list, settings } = await pricedCalcs(u, cl.id, raw.map((x) => x?.calculationId));
    const theme = b.theme === 'light' ? 'light' : 'dark';
    const today = new Date().toISOString().slice(0, 10);
    let validUntil = typeof b.validUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(validUntil)) || validUntil < today) throw new HttpError(400, 'Срок действия КП — не раньше сегодняшнего дня');
    if (validUntil > new Date(Date.now() + 366 * 86400_000).toISOString().slice(0, 10)) throw new HttpError(400, 'Срок действия КП — не больше года');

    const items: KpSnapshotItem[] = [];
    for (let i = 0; i < list.length; i++) {
      const { c, price } = list[i];
      const x = raw[i] ?? {};
      let image: KpSnapshotItem['image'] = null;
      if (x.imageId) {
        const { rows: [img] } = await pool.query(`select id, kind from images where id = $1 and calculation_id = $2 and deleted_at is null and kind in ('sketch','render')`,
          [uuid(x.imageId, 'Картинка не найдена'), c.id]);
        if (!img) throw new HttpError(400, `Картинка для «${c.title}» не найдена`);
        image = { id: img.id, kind: img.kind };
      }
      const materials = (Array.isArray(x.materials) ? x.materials : [])
        .map((m: any) => ({ role: str(m?.role, 80), value: str(m?.value, 300) })).filter((m: any) => m.role || m.value).slice(0, 30);
      items.push({
        calculationId: c.id, kind: c.kind, title: str(x.title, 200) || c.title, dims: str(x.dims, 300), about: str(x.about, 3000),
        materials, benefits: strList(x.benefits, 8, 120), image, price,
      });
    }

    const kp = await tx(pool, async (db) => {
      let number: number, version = 1;
      if (b.baseKpId) {
        const base = await visibleKp(u, uuid(b.baseKpId, 'Исходное КП не найдено'));
        if (base.client_id !== cl.id) throw new HttpError(400, 'Исходное КП другого клиента');
        number = base.number;
        await db.query('select pg_advisory_xact_lock(482100, $1)', [number]);
        version = (await db.query('select max(version)::int as v from kps where number = $1', [number])).rows[0].v + 1;
      } else {
        number = (await db.query(`select nextval('kp_number_seq')::int as n`)).rows[0].n;
      }
      const { rows: [mgr] } = await db.query(`select u.first_name, u.last_name, u.position, u.phone, ci.name as city from users u left join cities ci on ci.id = u.city_id where u.id = $1`, [cl.manager_id]);
      const { rows: [co] } = await db.query('select data from company where id = 1');
      const snapshot: KpSnapshot = {
        number: kpNumber(number), version, createdAt: new Date().toISOString(), validUntil, theme, roundTo: settings.roundTo || 100,
        client: { name: cl.name, city: cl.city_name ?? '' },
        manager: { name: fullName(mgr?.first_name, mgr?.last_name), position: mgr?.position ?? '', phone: mgr?.phone ?? '', city: mgr?.city ?? cl.city_name ?? '' },
        company: normalizeCompany(co?.data ?? DEFAULT_COMPANY),
        items,
        totals: kpTotals(items.map((it) => it.price)),
      };
      const { rows: [r] } = await db.query(
        `insert into kps (number, version, client_id, token, snapshot, total, theme, valid_until, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [number, version, cl.id, newToken(), JSON.stringify(snapshot), snapshot.totals.total, theme, validUntil, u.id]);
      for (const it of items) {
        // статус «в КП» (если ещё не дальше) и тексты для следующей версии; rev растёт, чтобы открытый расчёт не затёр статус
        await db.query(
          `update calculations set status = case when status in ('draft','saved') then 'in_kp' else status end,
             kp_info = $1, rev = rev + 1, updated_at = now() where id = $2`,
          [JSON.stringify({ title: it.title, dims: it.dims, about: it.about, benefits: it.benefits }), it.calculationId]);
      }
      await db.query('update clients set updated_at = now() where id = $1', [cl.id]);
      return r.id as string;
    });
    return { kp: kpJson(req, await visibleKp(u, kp)) };
  });

  app.post('/api/kp/:id/sent', async (req: any) => {
    const u = d.me(req);
    const r = await visibleKp(u, uuid(req.params.id));
    const channel = ['link', 'whatsapp', 'telegram', 'pdf'].includes(req.body?.channel) ? req.body.channel : 'link';
    await tx(pool, async (db) => {
      await db.query('update kps set sent_at = coalesce(sent_at, now()) where id = $1', [r.id]);
      await db.query(`insert into kp_events (kp_id, type, message) values ($1, 'sent', $2)`, [r.id, channel]);
      const ids = ((r.snapshot?.items ?? []) as KpSnapshotItem[]).map((it) => it.calculationId);
      await db.query(`update calculations set status = 'kp_sent', rev = rev + 1, updated_at = now() where id = any($1::uuid[]) and status in ('draft','saved','in_kp')`, [ids]);
    });
    return { kp: kpJson(req, await visibleKp(u, r.id)) };
  });

  // ========== Уведомления ==========
  async function notify(db: pg.Pool | pg.PoolClient, kp: any, type: string, text: string) {
    await db.query('insert into notifications (user_id, kp_id, type, text) values ($1,$2,$3,$4)', [kp.manager_id, kp.id, type, text]);
  }

  app.get('/api/notifications', async (req: any) => {
    const u = d.me(req);
    const { rows } = await pool.query(
      `select n.*, k.client_id from notifications n left join kps k on k.id = n.kp_id where n.user_id = $1 order by n.created_at desc, n.id desc limit 30`, [u.id]);
    const { rows: [{ unread }] } = await pool.query('select count(*)::int as unread from notifications where user_id = $1 and read_at is null', [u.id]);
    return { items: rows.map((n) => ({ id: n.id, type: n.type, text: n.text, kpId: n.kp_id, clientId: n.client_id, createdAt: n.created_at, read: !!n.read_at })), unread };
  });

  app.post('/api/notifications/read', async (req: any) => {
    const u = d.me(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => Number.isInteger(x)).slice(0, 200) : null;
    if (ids) await pool.query('update notifications set read_at = now() where user_id = $1 and id = any($2::bigint[]) and read_at is null', [u.id, ids]);
    else await pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [u.id]);
    return {};
  });

  // ========== Компания (постоянная часть КП) ==========
  async function companyRow() {
    await pool.query('insert into company (id, data) values (1, $1) on conflict (id) do nothing', [JSON.stringify(DEFAULT_COMPANY)]);
    const { rows: [r] } = await pool.query('select data, rev from company where id = 1');
    return { company: normalizeCompany(r.data), rev: r.rev as number };
  }
  const companyJson = (c: { company: ReturnType<typeof normalizeCompany>; rev: number }) => ({
    company: c.company, rev: c.rev, coverUrl: c.company.coverImageId ? `/api/images/${c.company.coverImageId}` : null,
  });

  app.get('/api/company', async (req) => { d.me(req); return companyJson(await companyRow()); });

  app.put('/api/company', async (req: any) => {
    const u = d.need(req, 'owner');
    const cur = await companyRow();
    if (req.body?.rev !== cur.rev) throw new HttpError(409, 'Данные компании уже изменили. Обновите страницу', { rev: cur.rev });
    const next = cleanCompany(req.body?.company, cur.company.coverImageId);
    const { rowCount } = await pool.query('update company set data = $1, rev = rev + 1, updated_at = now(), updated_by = $2 where id = 1 and rev = $3',
      [JSON.stringify(next), u.id, cur.rev]);
    if (!rowCount) throw new HttpError(409, 'Данные компании уже изменили. Обновите страницу');
    return companyJson(await companyRow());
  });

  app.post('/api/company/cover', { bodyLimit: MAX_IMAGE }, async (req: any) => {
    const u = d.need(req, 'owner');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Нужна картинка PNG, JPG или WebP');
    await companyRow();
    const img = await saveImage(pool, req.body, { calcId: null, kind: 'cover', title: 'Фото обложки', userId: u.id });
    await pool.query(`update company set data = jsonb_set(data, '{coverImageId}', to_jsonb($1::text)), rev = rev + 1, updated_at = now(), updated_by = $2 where id = 1`, [img.id, u.id]);
    return companyJson(await companyRow());
  });

  app.delete('/api/company/cover', async (req: any) => {
    const u = d.need(req, 'owner');
    await companyRow();
    await pool.query(`update company set data = jsonb_set(data, '{coverImageId}', 'null'::jsonb), rev = rev + 1, updated_at = now(), updated_by = $1 where id = 1`, [u.id]);
    return companyJson(await companyRow());
  });

  // ========== Страница КП по ссылке (без входа) ==========
  async function kpByToken(token: unknown) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const { rows: [r] } = await pool.query('select k.*, cl.manager_id, cl.name as client_name from kps k join clients cl on cl.id = k.client_id where k.token = $1', [token]);
    return r ?? null;
  }
  const publicHeaders = (reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('x-frame-options', 'DENY');
  };
  const notFoundPage = (reply: FastifyReply) => {
    publicHeaders(reply);
    return reply.code(404).type('text/html; charset=utf-8').send(
      '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Предложение не найдено</title>'
      + '<body style="margin:0;background:#232322;color:#f1f0ed;font:16px/1.5 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">'
      + '<p>Предложение не найдено. Проверьте ссылку или попросите менеджера прислать её ещё раз.</p></body></html>');
  };

  app.get('/p/:token', async (req: any, reply) => {
    const r = await kpByToken(req.params.token);
    if (!r) return notFoundPage(reply);
    const q = req.query ?? {};
    const nonce = randomBytes(16).toString('base64');
    const theme = q.theme === 'light' || q.theme === 'dark' ? q.theme : r.theme;
    publicHeaders(reply);
    reply.header('content-security-policy',
      `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    return reply.type('text/html; charset=utf-8').send(renderKpPage(r.snapshot as KpSnapshot, {
      token: req.params.token, theme, preview: q.preview === '1', print: q.print === '1', nonce,
    }));
  });

  app.get('/p/:token/img/:imageId', async (req: any, reply) => {
    const r = await kpByToken(req.params.token);
    if (!r || typeof req.params.imageId !== 'string' || !UUID.test(req.params.imageId)) throw notFound();
    const snap = r.snapshot as KpSnapshot;
    const allowed = new Set([...snap.items.map((it) => it.image?.id).filter(Boolean), snap.company.coverImageId].filter(Boolean));
    if (!allowed.has(req.params.imageId)) throw notFound();
    const { rows: [img] } = await pool.query('select * from images where id = $1', [req.params.imageId]);
    if (!img) throw notFound();
    return sendImage(reply, img);
  });

  app.post('/p/:token/open', async (req: any) => {
    const r = await kpByToken(req.params.token);
    if (!r) throw notFound();
    await tx(pool, async (db) => {
      const { rows: [k] } = await db.query(
        `update kps set views = views + 1, first_viewed_at = coalesce(first_viewed_at, now()), last_viewed_at = now() where id = $1 returning views`, [r.id]);
      await db.query(`insert into kp_events (kp_id, type) values ($1, 'open')`, [r.id]);
      if (k.views === 1) await notify(db, r, 'open', `${r.client_name} впервые открыл(а) ${kpNumber(r.number)}${r.version > 1 ? ` (версия ${r.version})` : ''}`);
    });
    return {};
  });

  app.post('/p/:token/action', async (req: any) => {
    const r = await kpByToken(req.params.token);
    if (!r) throw notFound();
    const type = req.body?.type;
    if (type !== 'approve' && type !== 'question') throw new HttpError(400, 'Неизвестное действие');
    const message = type === 'question' ? str(req.body?.message, 1000) : '';
    if (type === 'question' && !message) throw new HttpError(400, 'Напишите вопрос');
    const { rows: [{ n }] } = await pool.query(
      `select count(*)::int as n from kp_events where kp_id = $1 and type in ('approve','question') and created_at > now() - interval '1 hour'`, [r.id]);
    if (n >= 20) throw new HttpError(429, 'Слишком много сообщений. Позвоните менеджеру');
    const num = `${kpNumber(r.number)}${r.version > 1 ? ` (версия ${r.version})` : ''}`;
    await tx(pool, async (db) => {
      await db.query('insert into kp_events (kp_id, type, message) values ($1,$2,$3)', [r.id, type, message]);
      if (type === 'approve') {
        await db.query('update kps set approved_at = coalesce(approved_at, now()) where id = $1', [r.id]);
        await notify(db, r, 'approve', `${r.client_name} нажал(а) «Утвердить проект» в ${num}`);
      } else {
        await notify(db, r, 'question', `${r.client_name} задал(а) вопрос по ${num}: «${message.length > 160 ? `${message.slice(0, 160)}…` : message}»`);
      }
    });
    return {};
  });
}
