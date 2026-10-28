-- Правки владельца 28.10.2026.
-- 1) Настройки: «Доставка и монтаж, %» (deliveryPct) → «Монтаж, %» (montagePct) + «Доставка по умолчанию, ₽» (deliveryDefaultRub = 0).
--    Выключатель «Нет (подключение напрямую к слаботочке)» (id 'none', цена 0) — всегда первым в списке.
--    Если настроек ещё нет (новая база), сервер возьмёт DEFAULT_SETTINGS движка при стартовом наполнении.
update settings
set data = jsonb_set(
      (data - 'deliveryPct') || jsonb_build_object(
        'montagePct', coalesce(data -> 'montagePct', data -> 'deliveryPct', '10'::jsonb),
        'deliveryDefaultRub', coalesce(data -> 'deliveryDefaultRub', '0'::jsonb)),
      '{light,switches}',
      jsonb_build_array(jsonb_build_object('id', 'none', 'name', 'Нет (подключение напрямую к слаботочке)', 'price', 0))
        || coalesce((select jsonb_agg(w) from jsonb_array_elements(data -> 'light' -> 'switches') w where w ->> 'id' <> 'none'), '[]'::jsonb)),
    rev = rev + 1,
    updated_at = now();

-- 2) Навесы: группа «Крепёж (крабы)» → «Навесы для подвесных шкафов» (шт) и позиция «Усиленный навес» 800 ₽,
--    как в книге-калькуляторе («Прайс Фурнитура», строки 226–227). В пустой базе ничего не делаем: прайс загрузится из catalog.json.
do $$
declare
  changed int := 0;
  k int;
begin
  insert into catalog_items (id, group_id, name, price, sort)
  select g.id || '-navesy-800', g.id, 'Усиленный навес', 800,
         coalesce((select max(i.sort) + 1 from catalog_items i where i.group_id = g.id), 0)
  from catalog_groups g
  where g.category = 'Фурнитура' and g.name in ('Крепёж (крабы)', 'Навесы для подвесных шкафов')
    and not exists (select 1 from catalog_items i where i.group_id = g.id and i.name = 'Усиленный навес');
  get diagnostics k = row_count;
  changed := changed + k;

  update catalog_groups set name = 'Навесы для подвесных шкафов', unit = 'шт'
  where category = 'Фурнитура' and name = 'Крепёж (крабы)';
  get diagnostics k = row_count;
  changed := changed + k;

  -- версия прайса растёт, только если прайс изменился (интерфейс сбросит кэш)
  if changed > 0 then
    update meta set value = to_jsonb((value)::int + 1) where key = 'catalog_version';
  end if;
end $$;
