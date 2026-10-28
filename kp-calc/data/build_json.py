import openpyxl, json, sys, re
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=False)
groups = []; idx = {}
# Фасады из плит: в книге цена = (лист ÷ площадь × 1,2 + 150) × наценка; берём цену листа и площадь листа
SHEET = {'Egger Perfect Sense': 3.416, 'Egger Perfect Sense Smart': 3.416, 'Egger Perfect Sense TOP': 3.416,
         'AGT односторонний': 3.416, 'AGT Supramat': 3.416, 'ALVIC': 3.35}
def num(v): return v if isinstance(v,(int,float)) and v else None
for cat in ['ЛДСП корпус','Фасады','Столешницы','Стеновые панели','Плинтус','Фурнитура']:
    ws = wb[cat]
    for r in ws.iter_rows(min_row=2, values_only=True):
        grp, name, unit = r[0], str(r[1]).strip(), r[2]
        if cat == 'ЛДСП корпус':
            price, rule = num(r[3]), 'sheet'
        else:
            sup, book = num(r[3]), num(r[4])
            if cat == 'Фурнитура': price, rule = sup, 'unit'
            elif grp == 'ЛДСП Egger (фасад)': price, rule = sup, 'sheet'
            elif grp in SHEET and sup: price, rule = sup, 'sheet'
            else: price, rule = (book or sup), 'unit'
        if not price or name in ('None','нет'): continue
        key = (cat, grp)
        if key not in idx:
            idx[key] = {'id': f'g{len(groups)+1}', 'category': cat, 'name': grp,
                        'unit': 'м²' if rule=='sheet' else ('шт' if cat=='Стеновые панели' else unit),
                        'rule': rule, 'items': []}
            if rule == 'sheet': idx[key]['sheetArea'] = SHEET.get(grp, 5.796)
            groups.append(idx[key])
        g = idx[key]
        g['items'].append({'id': f"{g['id']}-{len(g['items'])+1}", 'name': re.sub(r'\s+',' ',name.replace('_',' ')).strip(), 'price': round(price,2)})
data = {'source': 'Расчет кухни Sofia от 05.01.2026 (группы выпадающих списков)', 'version': 1,
        'rules': {'sheet': 'себестоимость м² = цена листа ÷ площадь листа × отходы + кромка (коэффициенты в админке)', 'unit': 'себестоимость = цена за единицу'},
        'note': 'ЛДСП и ЛДСП-фасад: price — цена листа. Фурнитура: цена закупки из книги. Остальное: цена, которую книга подставляла в расчёт (для Ботаники — со скидкой ×0,6/×0,8). Проверить владельцу.',
        'groups': groups}
json.dump(data, open(out,'w',encoding='utf-8'), ensure_ascii=False, separators=(',',':'))
print(len(groups), sum(len(g['items']) for g in groups), round(len(json.dumps(data,ensure_ascii=False))/1024),'KB')
for g in groups: print(' ',g['category'],'|',g['name'],'|',g['unit'],'|',len(g['items']),'|',g['items'][0]['name'][:40],g['items'][0]['price'])
