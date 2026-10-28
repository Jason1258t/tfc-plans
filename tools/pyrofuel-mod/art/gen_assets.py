"""Пиксельные текстуры топлива: углерод, бордовая взвесь, оранжевые прожилки."""
from pathlib import Path
import math,random,json
from png import write
R=Path(__file__).resolve().parents[1]/'src/main/resources/assets/pyrofuel/textures'
random.seed(104)
def save(name,p):
 f=R/(name+'.png');f.parent.mkdir(parents=True,exist_ok=True);write(f,p)
def blank():return [[(0,0,0,0) for x in range(16)] for y in range(16)]
for kind in ['pyrocoke_mix','soaked_pyromass','stabilizing_additive','raw_pyrocoke_briquette','pyrocoke_briquette']:
 p=blank(); bri='briquette' in kind;ready=kind=='pyrocoke_briquette';light=kind=='stabilizing_additive'
 for y in range(16):
  for x in range(16):
   inside=(3<=x<=12 and 4<=y<=12 and not ((x in [3,12]) and y in [4,12])) if bri else (y>=5+abs(x-8)//2 and y<=12 and 2<=x<=13)
   if not inside:continue
   n=random.randrange(18);v=40+n
   if light:p[y][x]=(145+n,132+n,110+n,255)
   elif kind=='soaked_pyromass':p[y][x]=(v+12,v-12,v-10,255)
   else:p[y][x]=(v,v-3,v-1,255)
   if bri and (x in [3,12] or y==12):p[y][x]=(25,23,26,255)
   if bri and y==4:p[y][x]=(88,80,76,255)
   vein=(x+y*2)%7==0 if bri else random.random()<.16
   if vein and not light:p[y][x]=(255,128+random.randrange(55),38,255) if ready else (111,47,35,255)
 save('item/'+kind,p)
for ready in [False,True]:
 name='pyrogel' if ready else 'raw_pyrogel'
 for variant,size in [('still',16),('flow',32)]:
  frames=[]
  for frame in range(8):
   for y in range(size):
    row=[]
    for x in range(size):
     w=math.sin((x+frame*.7)*math.pi*2/size)+math.cos((y-frame)*math.pi*2/size)
     glow=math.sin((x+y+frame)*math.pi*4/size)>.92 and w>.2
     c=(237,98,28,255) if ready and glow else ((84+int(w*9),23+int(w*3),35+int(w*4),255) if ready else (58+int(w*5),34+int(w*3),32+int(w*3),255))
     row.append(c)
    frames.append(row)
  save('fluid/'+name+'_'+variant,frames)
  (R/('fluid/'+name+'_'+variant+'.png.mcmeta')).write_text(json.dumps({'animation':{'frametime':4,'interpolate':False}})+'\n')
 p=blank()
 for y in range(3,14):
  for x in range(3,13):
   if y>10 and (x<5 or x>10):continue
   edge=x in [3,12] or y in [3,13]
   p[y][x]=(180,188,192,255) if edge else ((180,65,31,255) if ready else (87,49,38,255))
 for x in range(4,12):p[2][x]=(214,218,220,255)
 save('item/'+name+'_bucket',p)
# Контактный лист с увеличением без сглаживания для проверки силуэтов.
from png import read
names=['pyrocoke_mix','soaked_pyromass','raw_pyrocoke_briquette','pyrocoke_briquette','stabilizing_additive','raw_pyrogel_bucket','pyrogel_bucket']
canvas=[[(28,30,34,255)]*(len(names)*80) for _ in range(80)]
for i,name in enumerate(names):
 p=read(R/('item/'+name+'.png'))
 for y in range(16):
  for x in range(16):
   if p[y][x][3]:
    for dy in range(4):
     for dx in range(4):canvas[8+y*4+dy][i*80+8+x*4+dx]=p[y][x]
write(Path(__file__).resolve().parent/'preview.png',canvas)
