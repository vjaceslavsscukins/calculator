// «Документы» в строке расчёта: спецификация (потом — договор и другие документы).
import { Link } from 'react-router-dom';
import { dateTime } from '../format.ts';

export function DocsMenu({ calcId, specAt }: { calcId: string; specAt?: string | null }) {
  return (
    <details className="docs" onClick={(e) => e.stopPropagation()}>
      <summary>Документы{specAt ? ' · 1' : ''}</summary>
      <div className="docs-list">
        <Link to={`/calculations/${calcId}/spec`}>
          Спецификация
          <small>{specAt ? `сохранена ${dateTime(specAt)}` : 'ещё не создана'}</small>
        </Link>
        <span className="off" title="Следующий этап">Договор — скоро</span>
      </div>
    </details>
  );
}
