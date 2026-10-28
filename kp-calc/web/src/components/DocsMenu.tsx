// «Документы» в строке расчёта: спецификация (потом — договор и другие документы).
import { Link } from 'react-router-dom';

export function DocsMenu({ calcId }: { calcId: string }) {
  return (
    <details className="docs" onClick={(e) => e.stopPropagation()}>
      <summary>Документы</summary>
      <div className="docs-list">
        <Link to={`/calculations/${calcId}/spec`}>Спецификация</Link>
        <span className="off" title="Следующий этап">Договор — скоро</span>
      </div>
    </details>
  );
}
