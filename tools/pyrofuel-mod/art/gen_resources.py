"""Рецепты, локализация и модели пиротоплива; все количества собраны в одном месте."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[1]/'src/main/resources'
def put(p,v):
 p=R/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def item(i,n=1):return {'id':i,**({'count':n} if n!=1 else {})}
def ing(i):return {'item':i}
def fluid(i,n):return {'type':'fluid_stack','fluid':i,'amount':n}
def outfluid(i,n):return {'id':i,'amount':n}
def recipe(name,kind,inputs,outputs,heat=None):
 v={'type':'create:'+kind,'ingredients':inputs,'results':outputs}
 if heat:v['heat_requirement']=heat
 put(Path('data/pyrofuel/recipe')/(name+'.json'),v)
P='pyrofuel:'
recipe('pyrocoke_mix','mixing',[ing('immersiveengineering:dust_coke')]*2+[ing('create:cinder_flour')],[item(P+'pyrocoke_mix')])
recipe('soaked_pyromass','mixing',[ing(P+'pyrocoke_mix'),fluid('immersiveengineering:creosote',250)],[item(P+'soaked_pyromass')])
recipe('raw_pyrocoke_briquette','compacting',[ing(P+'soaked_pyromass')],[item(P+'raw_pyrocoke_briquette')])
recipe('pyrocoke_briquette','mixing',[ing(P+'raw_pyrocoke_briquette')],[item(P+'pyrocoke_briquette')],'heated')
recipe('stabilizing_additive','mixing',[ing('tfc:powder/graphite'),ing('tfc:powder/flux')],[item(P+'stabilizing_additive',4)])
recipe('raw_pyrogel','mixing',[ing(P+'pyrocoke_mix'),ing(P+'stabilizing_additive'),fluid('createdieselgenerators:diesel',250)],[outfluid(P+'raw_pyrogel',250)])
recipe('pyrogel','mixing',[fluid(P+'raw_pyrogel',250)],[outfluid(P+'pyrogel',250)],'heated')
put(Path('data/pyrofuel/recipe/recycle_blaze_cake.json'),{'type':'minecraft:crafting_shapeless','ingredients':[ing('create:blaze_cake')],'result':item(P+'pyrocoke_briquette')})
# Перекрываем только два старых рецепта, не весь реестр особого топлива Create.
for name in ['compacting/blaze_cake','filling/blaze_cake']:
 put(Path('data/create/recipe')/(name+'.json'),{'neoforge:conditions':[{'type':'neoforge:false'}],'type':'minecraft:crafting_shapeless','ingredients':[ing('minecraft:barrier')],'result':item('minecraft:barrier')})
put(Path('data/create/data_maps/item/superheated_blaze_burner_fuels.json'),{'values':{P+'pyrocoke_briquette':{'burn_time':3200}}})
# Нулевые параметры двигателя: пирогель предназначен только для горелки.
# Ненулевая скорость исключает деление на ноль в расчёте ёмкости CDG; полезная мощность равна нулю.
zero={'speed':16.0,'strength':0.0,'burn_rate':0.1}
put(Path('data/pyrofuel/createdieselgenerators/fuel_type/pyrogel.json'),{'fluid':[P+'pyrogel',P+'flowing_pyrogel'],'normal':zero,'modular':zero,'huge':zero,'sound_pitch':1.0,'burner_multiplier':1.0})
for name in ['raw_pyrogel','pyrogel']:
 put(Path('data/pyrofuel/tags/fluid')/(name+'.json'),{'replace':False,'values':[P+name,P+'flowing_'+name]})
ru={};en={}
materials=[
('pyrocoke_mix','Пирококсовая смесь','Pyrocoke Mix','Коксовая пыль с незераковым порошком. Основа твёрдого и жидкого пиротоплива.','Coke dust enriched with cinder flour. A base for solid and liquid pyrofuel.'),
('soaked_pyromass','Пропитанная пиромасса','Soaked Pyromass','Креозот связывает частицы нижнего огня. Требует прессования.','Creosote binds the embers of the Nether. Requires pressing.'),
('raw_pyrocoke_briquette','Сырой пирококсовый брикет','Raw Pyrocoke Briquette','Спрессованный заряд. Прокалите в чаше при обычном нагреве.','A pressed fuel charge. Cure in a basin over normal heat.'),
('pyrocoke_briquette','Пирококсовый брикет','Pyrocoke Briquette','Включения нижнего огня вызывают перегрев горелки всполоха на 160 секунд.','Nether embers superheat a blaze burner for 160 seconds.'),
('stabilizing_additive','Стабилизирующая присадка','Stabilizing Additive','Минеральная присадка удерживает огненный порошок в топливной взвеси.','A mineral additive that keeps fiery particles suspended in fuel.')]
for name,r,e,rt,et in materials:
 key='item.pyrofuel.'+name;ru[key]=r;en[key]=e;ru[key+'.tooltip']=rt;en[key+'.tooltip']=et
 put(Path('assets/pyrofuel/models/item')/(name+'.json'),{'parent':'minecraft:item/generated','textures':{'layer0':'pyrofuel:item/'+name}})
for name,r,e in [('raw_pyrogel','Сырой пирогель','Raw Pyrogel'),('pyrogel','Пирогель','Pyrogel')]:
 ru['fluid.pyrofuel.'+name]=r;en['fluid.pyrofuel.'+name]=e
 ru['item.pyrofuel.'+name+'_bucket']='Ведро: '+r.lower();en['item.pyrofuel.'+name+'_bucket']=e+' Bucket'
 put(Path('assets/pyrofuel/models/item')/(name+'_bucket.json'),{'parent':'minecraft:item/generated','textures':{'layer0':'pyrofuel:item/'+name+'_bucket'}})
ru['item.pyrofuel.raw_pyrogel_bucket.tooltip']='Сырая взвесь. Стабилизируйте нагревом. Хранится в баках; разлив в мир запрещён.'
ru['item.pyrofuel.pyrogel_bucket.tooltip']='Топливо для жидкостной горелки CDG. Перегрев при клапане выше 80%. Для двигателей непригодно.'
en['item.pyrofuel.raw_pyrogel_bucket.tooltip']='Raw suspension. Stabilize with heat. Tank storage only; cannot be placed in the world.'
en['item.pyrofuel.pyrogel_bucket.tooltip']='CDG liquid burner fuel. Superheats above 80% valve opening. Unsuitable for engines.'
put(Path('assets/pyrofuel/lang/ru_ru.json'),ru);put(Path('assets/pyrofuel/lang/en_us.json'),en)
put(Path('assets/create/lang/ru_ru.json'),{'item.create.cinder_flour':'Незераковый порошок'})

# Жидкостные текстуры включены в атлас блоков для баков и труб Create.
put(Path('assets/minecraft/atlases/blocks.json'), {'sources': [
    {'type': 'minecraft:single', 'resource': 'pyrofuel:fluid/'+name+'_'+variant}
    for name in ['raw_pyrogel','pyrogel'] for variant in ['still','flow']
]})
