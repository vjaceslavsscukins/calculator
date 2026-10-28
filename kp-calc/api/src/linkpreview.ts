// «Ссылки с сайтов»: сервер скачивает страницу товара и достаёт название, цену и картинку.
// Защита от SSRF: только http/https, адрес хоста (и каждого редиректа) проверяется после DNS — частные, локальные
// и служебные сети запрещены; соединение идёт ровно на проверенный адрес. Таймаут 8 с, не больше 2 МБ.
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import zlib from 'node:zlib';

export class LinkPreviewError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface LinkPreview { url: string; name: string; price?: number; currency?: string; image?: string }

export interface LinkPreviewOptions {
  /** Только для тестов (LINK_PREVIEW_ALLOW_PRIVATE=1): разрешить локальные адреса. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

// ---------- адреса ----------

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, x) => a * 256 + Number(x), 0);
}
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

/** Разворачивает IPv6 в 8 групп по 16 бит (с поддержкой «::» и хвоста IPv4). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const v4tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const n = v4ToInt(v4tail[1]);
    s = s.slice(0, -v4tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  const all = [...h, ...Array(fill).fill('0'), ...t];
  if (all.length !== 8) return null;
  return all.map((x) => parseInt(x || '0', 16));
}

/** true — адрес нельзя запрашивать с сервера: частные, локальные, служебные, групповые сети. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0]);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKED.some(([net, bits]) => (n >>> (32 - bits)) === (v4ToInt(net) >>> (32 - bits))) || n === 0xffffffff;
  }
  if (kind === 6) {
    const g = v6Groups(ip);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    // IPv4, вложенный в IPv6: ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d
    const embedded = (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0))
      || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0));
    if (embedded) return isPrivateAddress(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 — уникальные локальные
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 — канальные
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 — устаревшие локальные
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 — групповые
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // документация
    return false;
  }
  return true;
}

/** Проверка ссылки до запроса: схема, хост, литеральный IP. */
export function checkUrl(raw: string, allowPrivate = false): URL {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new LinkPreviewError(400, 'Неверная ссылка'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new LinkPreviewError(400, 'Ссылка должна начинаться с http:// или https://');
  if (u.username || u.password) throw new LinkPreviewError(400, 'Ссылка с логином и паролем не поддерживается');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new LinkPreviewError(400, 'Неверная ссылка');
  if (!allowPrivate) {
    if (isIP(host) && isPrivateAddress(host)) throw new LinkPreviewError(400, 'Адрес запрещён: локальные и внутренние адреса не открываем');
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new LinkPreviewError(400, 'Адрес запрещён: локальные и внутренние адреса не открываем');
  }
  return u;
}

// ---------- скачивание ----------

function fetchOnce(u: URL, opts: Required<LinkPreviewOptions>, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const lookup = (hostname: string, o: any, cb: any) => {
      dnsLookup(hostname, { all: true }, (err, addrs) => {
        if (err) return cb(new LinkPreviewError(400, 'Сайт не найден: проверьте ссылку'));
        const list = (addrs as { address: string; family: number }[]) ?? [];
        if (!list.length) return cb(new LinkPreviewError(400, 'Сайт не найден: проверьте ссылку'));
        if (!opts.allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
          return cb(new LinkPreviewError(400, 'Адрес запрещён: локальные и внутренние адреса не открываем'));
        }
        // соединяемся ровно с проверенным адресом (защита от подмены DNS между проверкой и запросом)
        if (o?.all) cb(null, list); else cb(null, list[0].address, list[0].family);
      });
    };
    const req = lib.request(u, {
      method: 'GET',
      lookup,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; CulturaKP/1.0; +link-preview)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'accept-language': 'ru,en;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
      },
      timeout: Math.max(1, deadline - Date.now()),
    } as any, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, headers: res.headers, body: Buffer.alloc(0) }); }
      const len = Number(res.headers['content-length']);
      if (Number.isFinite(len) && len > opts.maxBytes) { res.destroy(); return reject(new LinkPreviewError(400, 'Страница слишком большая (больше 2 МБ)')); }
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.length;
        if (size > opts.maxBytes) { req.destroy(); reject(new LinkPreviewError(400, 'Страница слишком большая (больше 2 МБ)')); return; }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on('error', () => reject(new LinkPreviewError(502, 'Не удалось прочитать страницу')));
    });
    const timer = setTimeout(() => { req.destroy(new LinkPreviewError(504, 'Сайт не ответил за 8 секунд')); }, Math.max(1, deadline - Date.now()));
    req.on('timeout', () => req.destroy(new LinkPreviewError(504, 'Сайт не ответил за 8 секунд')));
    req.on('error', (e) => reject(e instanceof LinkPreviewError ? e : new LinkPreviewError(502, 'Не удалось открыть сайт')));
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function decodeBody(body: Buffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = body.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder((charset || 'utf-8').toLowerCase()).decode(body); } catch { return new TextDecoder('utf-8').decode(body); }
}

export async function linkPreview(raw: string, options: LinkPreviewOptions = {}): Promise<LinkPreview> {
  const opts: Required<LinkPreviewOptions> = { allowPrivate: false, timeoutMs: 8000, maxBytes: 2 * 1024 * 1024, ...options };
  const deadline = Date.now() + opts.timeoutMs;
  let u = checkUrl(raw, opts.allowPrivate);
  for (let hop = 0; hop <= 4; hop++) {
    const r = await fetchOnce(u, opts, deadline);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.location;
      if (!loc || hop === 4) throw new LinkPreviewError(502, 'Слишком много перенаправлений');
      u = checkUrl(new URL(loc, u).toString(), opts.allowPrivate);
      continue;
    }
    if (r.status >= 400) throw new LinkPreviewError(502, `Сайт ответил ошибкой ${r.status}`);
    const ct = String(r.headers['content-type'] ?? '');
    if (ct && !/html|xml/i.test(ct)) throw new LinkPreviewError(400, 'По ссылке не страница, а файл');
    const parsed = parseProductHtml(decodeBody(r.body, ct), u.toString());
    if (!parsed.name) throw new LinkPreviewError(422, 'Не нашли название на странице: введите его вручную');
    return { url: u.toString(), ...parsed };
  }
  throw new LinkPreviewError(502, 'Слишком много перенаправлений');
}

// ---------- разбор страницы ----------

const ENT: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', times: '×', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const clean = (s: unknown, max = 300) => (typeof s === 'string' ? decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** «12 990,50 ₽», «12,990.50», 12990 → число; иначе undefined. */
export function parsePrice(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v !== 'string') return undefined;
  let s = v.replace(/[\s  ]/g, '').replace(/[^\d.,]/g, '');
  if (!s) return undefined;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '') : s.replace(/,/g, '');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

const isType = (node: any, t: string) => [].concat(node?.['@type'] ?? []).some((x: unknown) => typeof x === 'string' && x.toLowerCase() === t.toLowerCase());

function findProduct(node: any, depth = 0): any {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const x of node) { const p = findProduct(x, depth + 1); if (p) return p; } return null; }
  if (isType(node, 'Product') || isType(node, 'ProductGroup')) return node;
  for (const k of ['@graph', 'mainEntity', 'itemOffered', 'itemListElement', 'item']) {
    const p = findProduct(node[k], depth + 1);
    if (p) return p;
  }
  return null;
}

function offerOf(p: any): { price?: number; currency?: string } {
  const list = [].concat(p?.offers ?? []).concat(p?.hasVariant ? [].concat(p.hasVariant).flatMap((v: any) => [].concat(v?.offers ?? [])) : []);
  for (const o of list as any[]) {
    if (!o || typeof o !== 'object') continue;
    const price = parsePrice(o.price) ?? parsePrice(o.lowPrice) ?? parsePrice(o.priceSpecification?.price)
      ?? parsePrice([].concat(o.priceSpecification ?? [])[0]?.['price']);
    if (price) return { price, currency: clean(o.priceCurrency ?? o.priceSpecification?.priceCurrency, 10) || undefined };
    const inner = offerOf({ offers: o.offers });
    if (inner.price) return inner;
  }
  return {};
}

function imageOf(v: any): string | undefined {
  for (const x of [].concat(v ?? []) as any[]) {
    if (typeof x === 'string' && x.trim()) return x.trim();
    if (x && typeof x === 'object') { const u = x.url ?? x.contentUrl; if (typeof u === 'string' && u.trim()) return u.trim(); }
  }
  return undefined;
}

function absImage(src: string | undefined, base: string): string | undefined {
  if (!src) return undefined;
  try {
    const u = new URL(decodeEntities(src), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 2000) : undefined;
  } catch { return undefined; }
}

/** Разбор страницы товара: JSON-LD Product (name, offers.price), og:title / og:image / product:price:amount, <title>. */
export function parseProductHtml(html: string, baseUrl: string): Omit<LinkPreview, 'url'> {
  let product: any = null;
  const ld = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while (!product && (m = ld.exec(html))) {
    const txt = m[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, '').trim();
    try { product = findProduct(JSON.parse(txt)); } catch { /* битый JSON-LD — пропускаем */ }
  }
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content != null && meta[key] == null) meta[key] = a.content;
  }
  // itemprop="price" бывает не в <meta>, а в <span content="…">
  const ip = /<[^>]+itemprop\s*=\s*["']price["'][^>]*>/i.exec(html);
  if (ip && meta.price == null) { const a = attrs(ip[0]); if (a.content) meta.price = a.content; }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  const name = clean(product?.name) || clean(meta['og:title']) || clean(meta['twitter:title']) || clean(title);
  const offer = product ? offerOf(product) : {};
  const price = offer.price ?? parsePrice(meta['product:price:amount']) ?? parsePrice(meta['og:price:amount']) ?? parsePrice(meta.price);
  const currency = offer.currency || clean(meta['product:price:currency'] ?? meta['og:price:currency'] ?? meta.pricecurrency, 10) || undefined;
  const image = absImage(imageOf(product?.image) ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'], baseUrl);
  const out: Omit<LinkPreview, 'url'> = { name };
  if (price) out.price = price;
  if (currency) out.currency = currency.toUpperCase();
  if (image) out.image = image;
  return out;
}
