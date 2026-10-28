// Страница КП для клиента (/p/:token): вёрстка утверждённого макета mockups/kp-example.html, светлый и тёмный вид,
// печать в PDF (A4 альбомная, светлый вид). Всё содержимое — из снимка КП; персональные данные — только имя и город клиента.
import type { KpSnapshot, KpSnapshotItem } from './kpdata.ts';

const NBSP = ' ';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const nl = (v: unknown) => esc(v).replace(/\n/g, '<br>');

/** Округление только при выводе: шаг из настроек на момент формирования (обычно 100 ₽). */
export function rubText(n: number, step = 100): string {
  const st = step > 0 ? step : 1;
  const r = Math.round(n / st) * st;
  return `${(r === 0 ? 0 : r).toLocaleString('ru-RU', { maximumFractionDigits: 0 }).replace(/\s/g, NBSP)}${NBSP}₽`;
}
export function dateText(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
}
const pct = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${NBSP}%`;

const CSS = String.raw`
:root{
  --paper:#f5f3ef; --card:#fbfaf8; --ink:#262625; --muted:#6b6a66; --line:#d8d5cf;
  --accent:#7d1e2b; --accent-hover:#9a3246; --accent-soft:#f3e6e6; --graphite:#232322; --on-dark:#f1f0ed; --on-dark-muted:#a9a8a3; --rose:#e0aab6;
  --f-head:"Prata","Times New Roman",Georgia,serif;
  --f-body:"Golos Text",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  --pic:#fff; --body:#e9e6e0; --notebg:#f2efe9;
  color-scheme:light;
}
:root[data-kp="dark"]{
  --paper:#232322; --card:#2b2b2a; --ink:#f1f0ed; --muted:#a9a8a3; --line:rgba(241,240,237,.18);
  --accent:#c4405a; --accent-soft:rgba(179,45,71,.18); --pic:#2f2f2e; --body:#171716; --notebg:#232322;
  color-scheme:dark;
}
:root[data-kp="dark"] .page{border:1px solid rgba(241,240,237,.12)}
:root[data-kp="dark"] .cover,:root[data-kp="dark"] .final{background:#1d1d1c}
:root[data-kp="dark"] .btn.solid{background:#7d1e2b;border-color:#7d1e2b}
:root[data-kp="dark"] .btn.solid:hover{background:#9a3246}
.lg-g{display:block}.lg-w{display:none}
:root[data-kp="dark"] .lg-g{display:none}:root[data-kp="dark"] .lg-w{display:block}
.cover .lg-g,.final .lg-g{display:none}.cover .lg-w,.final .lg-w{display:block}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--body);color:var(--ink)}
body{font:15px/1.55 var(--f-body);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{display:flex;flex-direction:column;gap:22px;padding-block:22px 60px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.note{max-width:1120px;margin-inline:auto;width:100%;font-size:13px;color:var(--muted);border:1px solid var(--line);padding:10px 14px;background:var(--notebg);display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between}
.note b{color:var(--ink);font-weight:500}
.note.preview{border-style:dashed}
.tool{height:36px;padding:0 16px;border:1px solid var(--muted);background:transparent;color:var(--ink);border-radius:2px;font:600 11.5px var(--f-body);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.tool:hover{background:rgba(127,127,127,.12)}
.page{max-width:1120px;width:100%;margin-inline:auto;background:var(--paper);padding:clamp(20px,4vw,48px);display:flex;flex-direction:column;gap:22px;box-shadow:0 1px 0 rgba(0,0,0,.06)}
.ph{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid var(--accent);padding-bottom:14px}
.ph h2{font:400 clamp(24px,3vw,36px)/1.15 var(--f-head);margin:0;text-wrap:balance}
.ph .sub{font-size:13px;color:var(--muted);margin-top:6px}
.ph .lg{height:26px;width:auto;flex:none}
.foot{display:flex;justify-content:space-between;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#a3a09a;margin-top:auto}
.eb{font:500 12px/1 var(--f-body);letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.cover{background:var(--graphite);color:var(--on-dark);min-height:620px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0;padding:0}
.cover .l{padding:clamp(24px,4vw,52px);display:flex;flex-direction:column;gap:20px}
.cover .lg{height:46px;width:auto;align-self:flex-start}
.cover h1{font:400 clamp(30px,4.2vw,56px)/1.08 var(--f-head);text-transform:uppercase;margin:auto 0 0;letter-spacing:.005em}
.cover h1 i{font-style:normal;color:#b32d47}
.cover .for{color:var(--on-dark-muted);font-size:15px}
.cover .for b{color:var(--on-dark);font-weight:500}
.cover .addr{border-top:1px solid rgba(241,240,237,.2);padding-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 20px;font-size:12.5px;color:var(--on-dark-muted)}
.cover .addr b{display:block;color:var(--on-dark);font-weight:500;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px}
.cover .r{position:relative;background:linear-gradient(160deg,#3b3b3a,#2a2a29);min-height:320px;overflow:hidden}
.cover .r img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.cover .r span{position:absolute;left:18px;bottom:16px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--on-dark-muted)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));border:1px solid var(--line);background:var(--card)}
.facts div{padding:20px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
.facts b{font:400 30px/1 var(--f-head);color:var(--accent);font-variant-numeric:lining-nums}
.facts span{font-size:14px;color:var(--muted)}
.lead{font-size:17px;max-width:68ch;margin:0}
.prod{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start}
.pic{background:var(--pic);border:1px solid var(--line);border-radius:4px;padding:18px;display:flex;flex-direction:column;gap:8px}
.pic img{width:100%;height:auto;display:block;max-height:560px;object-fit:contain}
.pic small{font-size:11px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:22px;display:flex;flex-direction:column;gap:14px}
.card h3{font:500 15px var(--f-body);color:var(--accent);margin:0;border-bottom:1px solid var(--line);padding-bottom:10px}
.about{margin:0;font-size:15px;white-space:pre-line}
.ai{font-size:11px;color:var(--muted)}
.mat{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;font-size:14px}
.mat li{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.mat li span{color:var(--muted)}
.gets{display:flex;flex-wrap:wrap;gap:8px}
.gets span{background:var(--accent-soft);color:var(--accent);font-size:13px;padding:6px 10px;border-radius:2px}
.price{border-top:1px solid var(--line);padding-top:14px;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 16px;font-variant-numeric:lining-nums tabular-nums}
.price s{color:var(--muted);font-size:16px}
.price b{font:400 30px var(--f-head);color:var(--ink)}
.price em{font-style:normal;font-size:12px;color:var(--accent);background:var(--accent-soft);padding:3px 8px}
.price small{flex-basis:100%;font-size:12px;color:var(--muted)}
.notin{font-size:12px;color:var(--muted)}
.notin b{color:var(--ink);font-weight:500}
.sum{width:100%;border-collapse:collapse;font-size:15px;font-variant-numeric:tabular-nums}
.sum td{padding:12px 4px;border-bottom:1px solid var(--line)}
.sum td.n{text-align:right;white-space:nowrap}
.sum tr.disc td{color:var(--accent)}
.sum tr.tot td{border-bottom:0;border-top:2px solid var(--ink);font:400 26px var(--f-head);padding-top:16px}
.fix{background:var(--accent-soft);color:var(--accent);padding:14px 18px;font-size:14px;border-radius:2px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
.box{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:20px;display:flex;flex-direction:column;gap:8px}
.box h3{font:500 14px var(--f-body);color:var(--accent);margin:0}
.box .big{font:400 34px/1 var(--f-head)}
.box ul{margin:0;padding-left:18px;font-size:14px;display:flex;flex-direction:column;gap:6px}
.box p{margin:0;font-size:14px;color:var(--muted)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;border-top:1px solid rgba(241,240,237,.2)}
.steps div{padding:18px 18px 18px 0;display:flex;flex-direction:column;gap:6px}
.steps b{font:400 30px/1 var(--f-head);color:#c4405a}
.steps span{font-size:14px}
.final{background:var(--graphite);color:var(--on-dark)}
.final .ph{border-bottom-color:#b32d47}
.final .ph .sub{color:var(--on-dark-muted)}
.final .foot{color:#77766f}
.mgr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;border-top:1px solid rgba(241,240,237,.2);padding-top:22px}
.mgr .who b{display:block;font:400 24px var(--f-head)}
.mgr .who span{color:var(--on-dark-muted);font-size:14px}
.mgr .tel{font:400 22px var(--f-head);text-align:right;color:var(--on-dark);text-decoration:none}
.mgr .tel small{display:block;font:400 12px var(--f-body);color:var(--on-dark-muted)}
.cta{display:flex;flex-wrap:wrap;gap:12px}
.btn{height:52px;padding:0 28px;border:1px solid rgba(241,240,237,.5);background:transparent;color:var(--on-dark);border-radius:2px;font:600 12.5px var(--f-body);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
.btn.solid{background:#7d1e2b;border-color:#7d1e2b}
.btn.solid:hover{background:#9a3246}
.btn:disabled{opacity:.55;cursor:default}
.btn:focus-visible,.tool:focus-visible{outline:2px solid var(--rose);outline-offset:2px}
.ask{display:flex;flex-direction:column;gap:10px;max-width:640px}
.ask textarea{min-height:96px;background:transparent;color:var(--on-dark);border:1px solid rgba(241,240,237,.5);border-radius:2px;padding:10px 12px;font:inherit;resize:vertical}
.tot-dark{font:400 clamp(34px,4.5vw,58px)/1 var(--f-head);font-variant-numeric:lining-nums}
.ok{font-size:13px;color:var(--on-dark-muted)}
.print-only{display:none}
@media screen and (max-width:820px){.cover,.prod{grid-template-columns:minmax(0,1fr)}.mat li{grid-template-columns:minmax(0,1fr)}.mgr{grid-template-columns:minmax(0,1fr)}.mgr .tel{text-align:left}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@page{size:A4 landscape;margin:0}
@media print{
  :root,:root[data-kp="dark"]{
    --paper:#f5f3ef; --card:#fbfaf8; --ink:#262625; --muted:#6b6a66; --line:#d8d5cf;
    --accent:#7d1e2b; --accent-soft:#f3e6e6; --pic:#fff; --body:#fff; color-scheme:light;
  }
  :root[data-kp="dark"] .page{border:0}
  :root[data-kp="dark"] .cover,:root[data-kp="dark"] .final{background:#232322}
  :root[data-kp="dark"] .lg-g{display:block}:root[data-kp="dark"] .lg-w{display:none}
  .cover .lg-g,.final .lg-g{display:none!important}.cover .lg-w,.final .lg-w{display:block!important}
  html,body{background:#fff}
  body{font-size:12.5px}
  .doc{padding:0;gap:0}
  .no-print{display:none!important}
  .print-only{display:block}
  .page{max-width:none;width:297mm;height:209mm;margin:0;padding:12mm 14mm;gap:5mm;box-shadow:none;overflow:hidden;break-after:page;page-break-after:always}
  .page:last-child{break-after:auto;page-break-after:auto}
  .cover{padding:0;min-height:0}
  .cover .l{padding:14mm}
  .ph h2{font-size:24px}
  .prod{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6mm}
  .pic{padding:4mm}
  .pic img{max-height:105mm}
  .card{padding:5mm;gap:3mm}
  .mat{font-size:11.5px;gap:3px}
  .mat li{grid-template-columns:38mm minmax(0,1fr);padding-bottom:2px}
  .about{font-size:12px}
  .price b{font-size:24px}
  .sum td{padding:6px 4px}
  .tot-dark{font-size:40px}
  .facts b{font-size:24px}
}
`;

function logo(cls = 'lg') {
  return `<img class="${cls} lg-g" src="/logo/cultura-group-logo-gray.svg" alt="cultura group"><img class="${cls} lg-w" src="/logo/cultura-group-logo-white.svg" alt="cultura group">`;
}
function head(title: string, sub: string, eyebrow = '') {
  return `<div class="ph"><div>${eyebrow ? `<div class="eb">${esc(eyebrow)}</div>` : ''}<h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${logo()}</div>`;
}
const foot = (n: number) => `<div class="foot"><span>cultura group</span><span>${n}</span></div>`;

function itemPage(k: KpSnapshot, it: KpSnapshotItem, i: number, imgUrl: (id: string) => string, page: number): string {
  const p = it.price;
  const step = k.roundTo;
  const pic = it.image
    ? `<div class="pic"><img src="${esc(imgUrl(it.image.id))}" alt="${esc(it.title)}" loading="lazy"><small>${it.image.kind === 'render' ? 'Визуализация, возможны отличия' : 'Эскиз проекта'}</small></div>`
    : '';
  const gets = it.benefits.length ? `<div class="gets">${it.benefits.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : '';
  const price = p.discount > 0
    ? `<s>${rubText(p.retail, step)}</s><b>${rubText(p.price, step)}</b><em>скидка ${pct(p.discountPct)}</em>`
    : `<b>${rubText(p.retail, step)}</b>`;
  const left = pic || gets ? `<div style="display:flex;flex-direction:column;gap:14px">${pic}${gets}</div>` : '<div></div>';
  return `<section class="page" aria-label="${esc(it.title)}">
  ${head(it.title, it.dims, `Изделие ${String(i + 1).padStart(2, '0')}`)}
  <div class="prod">
    ${left}
    <div class="card">
      ${it.about ? `<h3>Об изделии</h3><p class="about">${esc(it.about)}</p><span class="ai">Текст подготовлен по расчёту, менеджер проверил.</span>` : ''}
      ${it.materials.length ? `<h3>Материалы и комплектация</h3><ul class="mat">${it.materials.map((m) => `<li><span>${esc(m.role)}</span>${esc(m.value)}</li>`).join('')}</ul>` : ''}
      <div class="price">${price}<small>стоимость изделия без доставки и монтажа</small></div>
    </div>
  </div>
  ${k.company.notIncluded ? `<div class="notin"><b>Не входит в стоимость изделия:</b> ${esc(k.company.notIncluded)}</div>` : ''}
  ${foot(page)}
</section>`;
}

export interface KpPageOptions {
  token: string;
  /** Вид страницы: из КП или ?theme= в ссылке. */
  theme: 'dark' | 'light';
  /** Просмотр менеджера: открытия не считаются, кнопки ничего не отправляют. */
  preview: boolean;
  /** Сразу открыть печать (кнопка «Скачать PDF» в портале). */
  print: boolean;
  nonce: string;
}

export function renderKpPage(k: KpSnapshot, o: KpPageOptions): string {
  const c = k.company;
  const step = k.roundTo;
  const base = `/p/${encodeURIComponent(o.token)}`;
  const imgUrl = (id: string) => `${base}/img/${encodeURIComponent(id)}`;
  const t = k.totals;
  const valid = dateText(k.validUntil);
  const title = c.coverTitle.replace(/\.$/, '');
  let page = 1;

  const cover = `<section class="page cover" aria-label="Обложка">
    <div class="l">
      ${logo()}
      <h1>${esc(title).replace(/ с /, '<br>с ')}<i>.</i></h1>
      <div class="for">Коммерческое предложение ${esc(k.number)}${k.version > 1 ? ` (версия ${k.version})` : ''}<br>Подготовлено для: <b>${esc(k.client.name)}</b>${k.client.city ? `, ${esc(k.client.city)}` : ''}<br>Проект от ${dateText(k.createdAt)} · цена зафиксирована до ${valid}</div>
      <div class="addr">
        ${c.addresses.map((a) => `<div><b>${esc(a.city)}</b>${nl(a.lines)}</div>`).join('')}
        ${c.phone ? `<div><b>Телефон</b>${esc(c.phone)}</div>` : ''}
      </div>
    </div>
    <div class="r">${c.coverImageId ? `<img src="${esc(imgUrl(c.coverImageId))}" alt="Шоурум ${esc(c.name)}">` : '<span>Шоурум Культура Групп</span>'}</div>
  </section>`;

  const why = `<section class="page" aria-label="Почему ${esc(c.name)}">
    ${head(`Почему ${c.name}`, 'Коротко о том, за что вы платите')}
    ${c.lead ? `<p class="lead">${esc(c.lead)}</p>` : ''}
    ${c.facts.length ? `<div class="facts">${c.facts.map((f) => `<div><b>${esc(f.big)}</b><span>${esc(f.text)}</span></div>`).join('')}</div>` : ''}
    ${c.boxes.length ? `<div class="cols">${c.boxes.map((b) => `<div class="box"><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>`).join('')}</div>` : ''}
    ${foot(++page)}
  </section>`;

  const items = k.items.map((it, i) => itemPage(k, it, i, imgUrl, ++page)).join('\n');

  const sumRows = k.items.map((it) => `<tr><td>${esc(it.title)}</td><td class="n">${rubText(it.price.retail, step)}</td></tr>`).join('')
    + (t.discount > 0 ? `<tr class="disc"><td>Скидка${t.discountPct != null ? ` ${pct(t.discountPct)}` : ''}</td><td class="n">−${rubText(t.discount, step)}</td></tr><tr><td>Мебель со скидкой</td><td class="n">${rubText(t.furniture, step)}</td></tr>` : '')
    + (t.montage > 0 ? `<tr><td>Монтаж</td><td class="n">${rubText(t.montage, step)}</td></tr>` : '')
    + (t.delivery > 0 ? `<tr><td>Доставка</td><td class="n">${rubText(t.delivery, step)}</td></tr>` : '')
    + `<tr class="tot"><td>Итого</td><td class="n">${rubText(t.total, step)}</td></tr>`;
  const sum = `<section class="page" aria-label="Стоимость">
    ${head('Стоимость проекта', 'Всё, что входит в это предложение')}
    <table class="sum"><tbody>${sumRows}</tbody></table>
    <div class="fix">Цена зафиксирована до ${valid}. После этой даты возможен перерасчёт по актуальным ценам поставщиков.</div>
    <div class="cols">
      ${c.includes.length ? `<div class="box"><h3>Доставка и монтаж включают</h3><ul>${c.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${c.extra.length ? `<div class="box"><h3>Оплачивается отдельно</h3><ul>${c.extra.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${foot(++page)}
  </section>`;

  const terms = `<section class="page" aria-label="Гарантии и условия">
    ${head('Гарантии и условия', 'На что вы можете рассчитывать')}
    <div class="cols">
      <div class="box"><h3>Гарантия</h3>${c.warrantyBig ? `<div class="big">${esc(c.warrantyBig)}</div>` : ''}<p>${esc(c.warrantyText)}</p></div>
      ${c.terms.length ? `<div class="box"><h3>Сроки</h3><ul>${c.terms.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${c.payment.length ? `<div class="box"><h3>Оплата</h3><ul>${c.payment.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    </div>
    ${c.fix ? `<div class="fix">${esc(c.fix)}</div>` : ''}
    ${foot(++page)}
  </section>`;

  const m = k.manager;
  const tel = m.phone.replace(/[^\d+]/g, '');
  const final = `<section class="page final" aria-label="Следующий шаг">
    ${head('Следующий шаг', 'Что нужно, чтобы начать')}
    <div><div class="tot-dark">${rubText(t.total, step)}</div><div class="ok">общая стоимость по этому предложению · зафиксирована до ${valid} · Сделано с культурой.</div></div>
    ${c.steps.length ? `<div class="steps">${c.steps.map((x, i) => `<div><b>${String(i + 1).padStart(2, '0')}</b><span>${esc(x)}</span></div>`).join('')}</div>` : ''}
    <div class="mgr">
      <div class="who"><span>Ваш персональный менеджер</span><b>${esc(m.name)}</b><span>${esc([m.position || 'Менеджер салона', m.city].filter(Boolean).join(', '))}</span></div>
      ${m.phone ? `<a class="tel" href="tel:${esc(tel)}">${esc(m.phone)}<small>звонок или сообщение в мессенджер</small></a>` : ''}
    </div>
    <div class="cta no-print">
      <button class="btn solid" type="button" id="ctaGo">Утвердить проект</button>
      <button class="btn" type="button" id="ctaAsk">Задать вопрос менеджеру</button>
    </div>
    <form class="ask no-print" id="askForm" hidden>
      <textarea id="askText" maxlength="1000" aria-label="Ваш вопрос" placeholder="Напишите вопрос — менеджер получит его и свяжется с вами"></textarea>
      <div class="cta"><button class="btn solid" type="submit">Отправить вопрос</button></div>
    </form>
    <div class="ok no-print" id="ctaMsg" role="status" aria-live="polite"></div>
    <div class="ok print-only">Чтобы утвердить проект или задать вопрос, позвоните менеджеру${m.phone ? `: ${esc(m.phone)}` : ''}.</div>
    ${foot(++page)}
  </section>`;

  const bar = `<div class="note no-print${o.preview ? ' preview' : ''}">
    <span>${o.preview ? '<b>Просмотр менеджера.</b> Открытия не считаются, кнопки не отправляют уведомлений.' : `<b>${esc(k.number)}</b> · цена зафиксирована до ${valid}`}</span>
    <button class="tool" type="button" id="pdf">Скачать PDF</button>
  </div>`;

  const script = `(function(){
  var base=${JSON.stringify(base)},preview=${o.preview ? 'true' : 'false'};
  var msg=document.getElementById('ctaMsg');
  function post(path,body){return fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){if(!r.ok)throw r;return r.json()})}
  if(!preview)post('/open').catch(function(){});
  document.getElementById('pdf').onclick=function(){window.print()};
  var go=document.getElementById('ctaGo'),ask=document.getElementById('ctaAsk'),form=document.getElementById('askForm');
  go.onclick=function(){
    if(preview){msg.textContent='Просмотр менеджера: клиент увидит здесь подтверждение, а вы получите уведомление.';return}
    go.disabled=true;
    post('/action',{type:'approve'}).then(function(){msg.textContent='Спасибо! Менеджер получил ваше подтверждение и свяжется с вами, чтобы договориться о замере.'})
      .catch(function(){go.disabled=false;msg.textContent='Не получилось отправить. Позвоните менеджеру или попробуйте ещё раз.'});
  };
  ask.onclick=function(){form.hidden=!form.hidden;if(!form.hidden)document.getElementById('askText').focus()};
  form.onsubmit=function(e){
    e.preventDefault();
    var t=document.getElementById('askText').value.trim();
    if(!t){msg.textContent='Напишите вопрос, чтобы менеджер мог ответить по существу.';return}
    if(preview){msg.textContent='Просмотр менеджера: вопрос клиента придёт вам уведомлением.';return}
    post('/action',{type:'question',message:t}).then(function(){form.hidden=true;msg.textContent='Менеджер получил ваш вопрос и свяжется с вами.'})
      .catch(function(){msg.textContent='Не получилось отправить. Позвоните менеджеру или попробуйте ещё раз.'});
  };
  ${o.print ? "window.addEventListener('load',function(){setTimeout(function(){window.print()},400)});" : ''}
})();`;

  return `<!doctype html>
<html lang="ru" data-kp="${o.theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(k.number)} · ${esc(c.name)}</title>
<link rel="icon" href="/logo/cultura-group-logo-white.svg">
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${CSS}</style>
</head>
<body>
<main class="doc">
${bar}
${cover}
${why}
${items}
${sum}
${terms}
${final}
</main>
<script nonce="${o.nonce}">${script}</script>
</body>
</html>`;
}
