"""Скачивает кухонные модели .b3d Лидии через kitchen-api (/bitrix-file/, до 25 МБ). Запуск: python3 download.py <папка с lidia_files.json и b3dfiles/>.
lidia_files.json — список файлов диска (ID, NAME, SIZE), собирается через disk.* методы сервиса."""
import json,subprocess,os,time,sys,re
from concurrent.futures import ThreadPoolExecutor
S=sys.argv[1];B="https://kitchen-api-c112.onrender.com/bitrix-file/"
d=json.load(open(S+"/lidia_files.json"))
k=[x for x in d if x['NAME'].lower().endswith('.b3d') and (re.match(r'К-\d+',x['NAME']) or 'ухн' in x['NAME'])]
def get(x):
    p=f"{S}/b3dfiles/{x['ID']}.b3d"
    if os.path.exists(p) and os.path.getsize(p)==int(x['SIZE']): return 1
    for a in range(5):
        r=subprocess.run(["curl","-g","-sS","-m","180","-o",p,"-w","%{http_code}",B+str(x["ID"])],capture_output=True,text=True).stdout
        if r=="200" and os.path.getsize(p)>0: return 1
        time.sleep(3*(a+1))
    os.path.exists(p) and os.remove(p); return 0
with ThreadPoolExecutor(3) as ex: res=list(ex.map(get,k))
print("скачано",sum(res),"из",len(k))
