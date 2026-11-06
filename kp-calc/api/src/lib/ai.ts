// Нейросети через OpenAI-совместимый шлюз (AITunnel, OpenRouter и т. п.): рендер по эскизу и текст «Об изделии».
import { fetchPublic } from './linkpreview.ts';

// Ключи только в окружении сервера: RENDER_PROVIDER, RENDER_API_URL, RENDER_API_KEY, RENDER_MODEL;
// AI_TEXT_API_URL, AI_TEXT_API_KEY, AI_TEXT_MODEL. Без ключа — понятная ошибка (рендер) или шаблонный текст.

export class AiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface AiEnv {
  RENDER_PROVIDER?: string; RENDER_API_URL?: string; RENDER_API_KEY?: string; RENDER_MODEL?: string;
  AI_TEXT_API_URL?: string; AI_TEXT_API_KEY?: string; AI_TEXT_MODEL?: string;
}

export const RENDER_OFF = 'Рендер не подключён: нужен ключ нейросети в настройках сервера';

export function renderConfigured(env: AiEnv): boolean {
  const p = (env.RENDER_PROVIDER || 'openai-compatible').toLowerCase();
  return p === 'openai-compatible' && !!(env.RENDER_API_URL && env.RENDER_API_KEY && env.RENDER_MODEL);
}
export const textConfigured = (env: AiEnv) => !!(env.AI_TEXT_API_URL && env.AI_TEXT_API_KEY && env.AI_TEXT_MODEL);

/** Адрес chat/completions: базовый адрес шлюза (…/v1) или уже полный путь. */
export function completionsUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : `${b}/chat/completions`;
}

export interface Material { role: string; value: string }

/**
 * Промт рендера: базовый промт из настроек (правит владелец) + изделие + материалы расчёта + что поправить (комментарий менеджера).
 * При перегенерации к эскизу прикладывается предыдущий рендер.
 */
export function renderPrompt(o: { base: string; kindTitle: string; title: string; materials: Material[]; comment?: string; withPrevious?: boolean }): string {
  const list = o.materials.map((m) => `- ${m.role}: ${m.value}`).join('\n') || '- материалы по эскизу';
  return [
    o.base.trim(),
    '',
    `Изделие: ${o.kindTitle.toLowerCase()} «${o.title}».`,
    'Материалы и комплектация из расчёта:',
    list,
    ...(o.withPrevious ? ['', 'Первая картинка — эскиз (главный источник расстановки и размеров), вторая — предыдущая визуализация: возьми её за основу и измени только то, что указано ниже.'] : []),
    ...(o.comment?.trim() ? ['', `Что поправить: ${o.comment.trim()}`] : []),
  ].join('\n');
}

const DATA_URL = /data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)/;
const HTTP_IMG = /(https?:\/\/[^\s)"'<>]+)/;

export type ExtractedImage = { kind: 'data'; mime: string; data: Buffer } | { kind: 'url'; url: string };

/**
 * Картинка из ответа шлюза. Разбираем типичные форматы:
 * choices[0].message.images[].image_url.url (OpenRouter, AITunnel) · content строкой с data:URL или ![](…) ·
 * content массивом частей (image_url / output_image / inline_data) · data[].b64_json / data[].url (images API).
 */
export function extractImage(json: any): ExtractedImage | null {
  const fromString = (s: unknown): ExtractedImage | null => {
    if (typeof s !== 'string') return null;
    const d = DATA_URL.exec(s);
    if (d) return { kind: 'data', mime: d[1].replace('jpg', 'jpeg'), data: Buffer.from(d[2].replace(/\s/g, ''), 'base64') };
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(s) ?? HTTP_IMG.exec(s);
    return md && /\.(png|jpe?g|webp)(\?|$)|image/i.test(md[1]) ? { kind: 'url', url: md[1] } : null;
  };
  const fromPart = (p: any): ExtractedImage | null => {
    if (!p) return null;
    if (typeof p === 'string') return fromString(p);
    const url = p.image_url?.url ?? p.image_url ?? p.url ?? p.image;
    if (typeof url === 'string') { const r = fromString(url); if (r) return r; }
    const b64 = p.b64_json ?? p.inline_data?.data ?? p.inlineData?.data ?? (p.type === 'output_image' || p.type === 'image' ? p.data ?? p.image_base64 : undefined);
    if (typeof b64 === 'string' && b64.length > 100) {
      const mime = p.inline_data?.mime_type ?? p.inlineData?.mimeType ?? p.mime_type ?? 'image/png';
      return { kind: 'data', mime, data: Buffer.from(b64, 'base64') };
    }
    if (typeof p.text === 'string') return fromString(p.text);
    return null;
  };
  for (const ch of json?.choices ?? []) {
    const msg = ch?.message ?? ch?.delta ?? {};
    for (const im of msg.images ?? []) { const r = fromPart(im); if (r) return r; }
    if (Array.isArray(msg.content)) { for (const p of msg.content) { const r = fromPart(p); if (r) return r; } }
    else { const r = fromString(msg.content); if (r) return r; }
  }
  for (const d of json?.data ?? []) { const r = fromPart(d); if (r) return r; }
  // Gemini-подобный ответ без шлюза
  for (const c of json?.candidates ?? []) for (const p of c?.content?.parts ?? []) { const r = fromPart(p); if (r) return r; }
  return null;
}

async function postJson(url: string, key: string, body: unknown, timeoutMs: number): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    throw new AiError(504, e?.name === 'TimeoutError' ? 'Нейросеть не ответила вовремя. Попробуйте ещё раз' : 'Не удалось связаться с нейросетью');
  }
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? '';
    const why = res.status === 401 || res.status === 403 ? 'неверный ключ нейросети'
      : res.status === 402 ? 'на счёте нейросети закончились деньги'
      : res.status === 429 ? 'нейросеть перегружена, попробуйте через минуту'
      : `ответ ${res.status}${typeof msg === 'string' && msg ? `: ${msg.slice(0, 200)}` : ''}`;
    throw new AiError(502, `Нейросеть не сделала работу: ${why}`);
  }
  if (!json) throw new AiError(502, 'Нейросеть вернула непонятный ответ');
  return json;
}

/** Рендер: эскиз + промт → картинка. */
export async function renderImage(env: AiEnv, images: { mime: string; data: Buffer }[], prompt: string, opts: { allowPrivate?: boolean } = {}): Promise<{ mime: string; data: Buffer }> {
  if (!renderConfigured(env)) throw new AiError(503, RENDER_OFF);
  const json = await postJson(completionsUrl(env.RENDER_API_URL as string), env.RENDER_API_KEY as string, {
    model: env.RENDER_MODEL,
    modalities: ['image', 'text'],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data.toString('base64')}` } })),
      ],
    }],
  }, 180_000);
  const img = extractImage(json);
  if (!img) {
    const said = json?.choices?.[0]?.message?.content;
    throw new AiError(502, `Нейросеть не вернула картинку${typeof said === 'string' && said.trim() ? `: «${said.trim().slice(0, 160)}»` : ''}`);
  }
  if (img.kind === 'data') return { mime: img.mime, data: img.data };
  // ссылка на картинку у провайдера: скачиваем только https, через проверку адресов (не во внутреннюю сеть), до 20 МБ
  if (!img.url.startsWith('https://')) throw new AiError(502, 'Нейросеть вернула ссылку не по https');
  let got: { body: Buffer; contentType: string };
  try { got = await fetchPublic(img.url, { allowPrivate: !!opts.allowPrivate }); } catch { throw new AiError(502, 'Не удалось скачать картинку нейросети'); }
  return { mime: got.contentType || 'image/png', data: got.body };
}

/** Текст «Об изделии» нейросетью в стиле DESIGN.md §8. */
export async function aboutText(env: AiEnv, data: { kindTitle: string; title: string; dims: string; materials: Material[]; benefits: string[] }): Promise<string> {
  if (!textConfigured(env)) throw new AiError(503, 'Нейросеть для текста не подключена');
  const json = await postJson(completionsUrl(env.AI_TEXT_API_URL as string), env.AI_TEXT_API_KEY as string, {
    model: env.AI_TEXT_MODEL,
    temperature: 0.5,
    messages: [
      {
        role: 'system',
        content: [
          'Ты пишешь короткий текст «Об изделии» для коммерческого предложения салона мебели на заказ «Культура Групп».',
          'Правила: на «вы», тепло и по-человечески, полными связными предложениями; 3–4 предложения, до 80 слов.',
          'Факты вместо эпитетов: что даёт клиенту конкретный материал или фурнитура в быту. Никаких «уникальный», «идеальное решение», «не просто X, а Y».',
          'Нельзя: цены, скидки, «акция», «только сегодня», «бесплатно», выдуманные свойства, которых нет в данных. Пишем «производство», не «цех».',
          'Кавычки «ёлочки», длинное тире с пробелами. Только текст, без заголовка и списков.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Изделие: ${data.title} (${data.kindTitle}). ${data.dims ? `Габариты или состав: ${data.dims}.` : ''}\nМатериалы и комплектация:\n${data.materials.map((m) => `- ${m.role}: ${m.value}`).join('\n')}\nЧто получает клиент: ${data.benefits.join('; ')}`,
      },
    ],
  }, 60_000);
  const content = json?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((p: any) => p?.text ?? '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new AiError(502, 'Нейросеть вернула пустой текст');
  return text.trim().replace(/^["«]|["»]$/g, '').slice(0, 2000);
}

/** Шаблонный текст «Об изделии», если нейросеть не подключена. Только факты из расчёта. */
export function templateAbout(kind: 'kitchen' | 'cabinet', title: string, materials: Material[]): string {
  const get = (re: RegExp) => materials.filter((m) => re.test(m.role)).map((m) => m.value);
  // «Эмаль» → «эмаль», но аббревиатуры и бренды (ЛДСП, AGT, Blum) не трогаем
  const lc = (s: string) => (/^[А-ЯЁA-Z][а-яёa-z]/.test(s) && !/^(Blum|Hettich|Egger|Salice|Firmax|Boyard|Gola)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const parts: string[] = [];
  const body = get(/^Корпус/), fronts = get(/^Фасады/), top = get(/^Столешница/);
  const name = title.trim() || (kind === 'kitchen' ? 'Кухня' : 'Изделие');
  parts.push(`${name} изготавливается на нашем производстве по вашим размерам.`);
  if (body.length || fronts.length) {
    const s = [body.length ? `корпус — ${lc(body.join('; '))}` : '', fronts.length ? `фасады — ${lc(fronts.join('; '))}` : ''].filter(Boolean).join(', ');
    parts.push(`${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
  }
  if (top.length) parts.push(`Столешница — ${lc(top.join('; '))}.`);
  const hw = [...get(/^Петли/), ...get(/^Ящики/), ...get(/^Подъёмники/)];
  if (hw.length) parts.push(`Фурнитура: ${lc(hw.join('; '))}.`);
  const light = get(/^Подсветка/);
  if (light.length) parts.push(`Подсветка: ${lc(light[0])}.`);
  parts.push('Перед отгрузкой мы собираем изделие на производстве, поэтому к вам оно приезжает готовыми модулями.');
  return parts.join(' ');
}
