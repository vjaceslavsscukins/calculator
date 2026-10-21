// Что можно спросить у Битрикса через сервис: только чтение, только нужные разделы.
const FAMILIES = new Set(['crm', 'disk', 'tasks', 'task', 'sonet_group', 'socialnetwork', 'lists']);
const VERBS = new Set(['list', 'get', 'getlist', 'getchildren', 'getfields', 'fields', 'getdata', 'getbyid']);

// Чат задачи: комментарии новых задач живут в чате, а не в task.commentitem. Разрешены только два метода чтения, остальной im.* закрыт.
const EXACT = new Set(['im.dialog.messages.get', 'im.dialog.get']);

export function isAllowedMethod(method) {
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(method)) return false;
  if (method.includes('externallink')) return false; // создаёт публичную ссылку, это уже запись
  if (EXACT.has(method)) return true;
  const parts = method.split('.');
  return FAMILIES.has(parts[0]) && VERBS.has(parts[parts.length - 1]);
}

// Вебхук вида https://портал/rest/<id>/<токен>/ — разбираем и запоминаем, что нельзя показывать в ответах.
export function normalizeWebhook(url, { allowInsecure = false } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error('BITRIX24_WEBHOOK_URL не похож на адрес'); }
  if (!(u.protocol === 'https:' || (allowInsecure && u.protocol === 'http:'))) throw new Error('Вебхук должен быть по https');
  const m = u.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9]+)\/?$/);
  if (!m) throw new Error('Ожидается адрес вида https://портал/rest/<id>/<токен>/');
  const base = `${u.origin}/rest/${m[1]}/${m[2]}/`;
  return { base, host: u.host, protocol: u.protocol, secrets: [base.replace(/\/$/, ''), m[2]] };
}

export function scrub(text, secrets) {
  let t = String(text);
  for (const s of secrets) if (s) t = t.split(s).join('***');
  return t;
}

// Копия строки запроса без параметров, которыми можно подменить авторизацию.
export function cleanQuery(searchParams) {
  const out = new URLSearchParams();
  for (const [k, v] of searchParams) if (!/^(auth|token)$/i.test(k)) out.append(k, v);
  return out.toString();
}
