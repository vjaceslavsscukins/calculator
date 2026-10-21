# tools/b3d: модели Базиса

Порядок (данные в репозиторий не кладём):
1. `python3 download.py <папка>`: скачать кухонные `.b3d` через kitchen-api в `<папка>/b3dfiles`.
2. `python3 survey.py <папка>/b3dfiles survey.json`: состав каждого модуля (детали с размерами и положением, фурнитура).
3. `python3 variants.py survey.json variants.json <папка>/lidia_files.json`: раскладки фасадов, уровни, опции; повторные сохранения одной кухни считаются один раз.
4. `python3 proposal.py variants.json page.html`: страница с вариантами модулей на утверждение.

`b3d.py` читает формат, `extract.py` вынимает детали, `classify.py` задаёт роли деталей. Формат описан в шапке `b3d.py` и в `docs/basis-models.md`.
