// Картинки расчёта: эскизы (загрузка), рендеры по эскизу через нейросеть, отметка «в КП».
import { useEffect, useRef, useState } from 'react';
import { api, type ImageInfo } from '../api.ts';
import { ErrorNote } from './Layout.tsx';
import { dateTime, errText } from '../format.ts';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX = 10 * 1024 * 1024;

export function ImagesPanel({ calcId }: { calcId: string }) {
  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [renderEnabled, setRenderEnabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sketchId, setSketchId] = useState<string>('');
  const [prevId, setPrevId] = useState<string>('');
  const [comment, setComment] = useState('');
  const [renderMsg, setRenderMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.images(calcId).then((r) => { setImages(r.images); setRenderEnabled(r.renderEnabled); }).catch((x) => setErr(errText(x)));
  }, [calcId]);

  const sketches = images?.filter((i) => i.kind === 'sketch') ?? [];
  const renders = images?.filter((i) => i.kind === 'render') ?? [];
  useEffect(() => { if (!sketches.some((s) => s.id === sketchId)) setSketchId(sketches[sketches.length - 1]?.id ?? ''); }, [images]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (prevId && !renders.some((s) => s.id === prevId)) setPrevId(''); }, [images]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    if (!TYPES.includes(f.type)) { setErr('Нужна картинка PNG, JPG или WebP.'); return; }
    if (f.size > MAX) { setErr('Картинка больше 10 МБ. Уменьшите её и загрузите снова.'); return; }
    setBusy('upload');
    try {
      const r = await api.uploadImage(calcId, f);
      setImages((l) => [...(l ?? []), r.image]);
      setSketchId(r.image.id);
    } catch (x) { setErr(errText(x)); } finally { setBusy(null); if (file.current) file.current.value = ''; }
  };

  const patch = async (img: ImageInfo, p: { inKp?: boolean; title?: string }) => {
    setErr(null);
    try { const r = await api.patchImage(img.id, p); setImages((l) => l?.map((x) => (x.id === img.id ? r.image : x)) ?? null); } catch (x) { setErr(errText(x)); }
  };
  const remove = async (img: ImageInfo) => {
    if (!window.confirm(`Убрать «${img.title}» из расчёта? В уже сформированных КП картинка останется.`)) return;
    try { await api.deleteImage(img.id); setImages((l) => l?.filter((x) => x.id !== img.id) ?? null); } catch (x) { setErr(errText(x)); }
  };

  const render = async () => {
    setRenderMsg(null); setErr(null);
    if (!renderEnabled) { setRenderMsg('Рендер не подключён: нужен ключ нейросети в настройках сервера'); return; }
    if (!sketchId) { setRenderMsg('Сначала загрузите эскиз.'); return; }
    setBusy('render');
    try {
      const r = await api.render(calcId, { imageId: sketchId, ...(prevId ? { previousId: prevId } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setImages((l) => [...(l ?? []), r.image]);
      setPrevId(r.image.id);
      setRenderMsg(`${r.image.title} готов. Отметьте «в КП», если берёте его в предложение.`);
    } catch (x) { setRenderMsg(errText(x)); } finally { setBusy(null); }
  };

  return (
    <section className="panel images" aria-label="Картинки расчёта">
      <div className="images-head">
        <h2>Эскизы и рендеры</h2>
        <div className="actions">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Файл эскиза" onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn small dark" type="button" disabled={busy === 'upload'} onClick={() => file.current?.click()}>{busy === 'upload' ? 'Загружаем…' : 'Загрузить эскиз'}</button>
        </div>
      </div>
      <p className="note">Эскиз из PRO100 — PNG, JPG или WebP до 10 МБ. Отметка «в КП» — картинка, которую предложим в коммерческом предложении. Рендеры подписываются в КП «Визуализация, возможны отличия».</p>
      <ErrorNote text={err} />
      <div className="thumbs">
        {images?.map((img) => (
          <figure className={`thumb${img.inKp ? ' on' : ''}`} key={img.id}>
            <a href={img.url} target="_blank" rel="noopener noreferrer"><img src={img.url} alt={img.title} loading="lazy" /></a>
            <figcaption>
              <span className="t"><b>{img.title}</b><small>{img.kind === 'render' ? 'рендер' : 'эскиз'} · {dateTime(img.createdAt)}</small></span>
              <label className="check small"><input type="checkbox" checked={img.inKp} onChange={(e) => patch(img, { inKp: e.target.checked })} />в КП</label>
              <button className="x" type="button" aria-label={`Убрать ${img.title}`} onClick={() => remove(img)}>×</button>
            </figcaption>
          </figure>
        ))}
        {images && !images.length && <div className="muted-dark empty-thumbs">Картинок пока нет. Загрузите эскиз — по нему можно сделать рендер.</div>}
        {!images && !err && <div className="muted-dark">Загружаем…</div>}
      </div>
      <div className="render-box">
        <div className="render-grid">
          <label>Эскиз
            <select className="in" value={sketchId} onChange={(e) => setSketchId(e.target.value)} aria-label="Эскиз для рендера">
              {!sketches.length && <option value="">— нет эскиза —</option>}
              {sketches.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label>Взять за основу
            <select className="in" value={prevId} onChange={(e) => setPrevId(e.target.value)} aria-label="Предыдущий рендер">
              <option value="">— только эскиз —</option>
              {renders.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="wide">Что поправить <em>необязательно</em>
            <input className="in" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: фасады темнее, убрать окно" maxLength={1000} />
          </label>
          <button className="btn small dark" type="button" onClick={render} disabled={busy === 'render'}>
            {busy === 'render' ? 'Рисуем… до 2 минут' : prevId || comment.trim() ? 'Перегенерировать' : 'Сделать рендер'}
          </button>
        </div>
        {renderMsg && <div className="render-msg" role="status">{renderMsg}</div>}
      </div>
    </section>
  );
}
