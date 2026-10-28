package tfc.pyrofuel.devtest;

import com.jesz.createdieselgenerators.CDGBlocks;
import com.jesz.createdieselgenerators.content.burner.BurnerBlockEntity;
import com.simibubi.create.AllBlocks;
import com.simibubi.create.content.processing.burner.BlazeBurnerBlockEntity;
import net.minecraft.commands.Commands;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BucketItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.fluids.*;
import net.neoforged.neoforge.fluids.capability.IFluidHandler;
import tfc.pyrofuel.Pyrofuel;

/** Проверки реальных горелок и баков; мод не включён в выпускаемый jar. */
@Mod("pyrofuel_devtest")
public class PyroTest {
    static final BlockPos BURNER = new BlockPos(0,-60,0);
    static final BlockPos TANK = new BlockPos(4,-60,0);
    static final BlockPos BLAZE = new BlockPos(8,-60,0);
    static int initial;
    static boolean drivePump;
    public PyroTest() {
        // Источник вращения стенда: постоянные 64 об/мин, чтобы проверять жидкостную сеть отдельно от передачи SU.
        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.tick.ServerTickEvent.Pre e) -> {
            if (!drivePump) return;
            var be=e.getServer().overworld().getBlockEntity(new BlockPos(14,-60,0));
            if (be instanceof com.simibubi.create.content.fluids.pump.PumpBlockEntity pump && pump.getSpeed()!=64) {
                float old=pump.getSpeed();pump.setSpeed(64);pump.onSpeedChanged(old);
            }
        });
        NeoForge.EVENT_BUS.addListener((RegisterCommandsEvent e) -> e.getDispatcher().register(Commands.literal("pyrotest")
            .then(Commands.literal("setup").executes(c -> setup(c.getSource())))
            .then(Commands.literal("report").executes(c -> report(c.getSource())))
            .then(Commands.literal("empty").executes(c -> empty(c.getSource())))
            .then(Commands.literal("stopped").executes(c -> stopped(c.getSource())))
            .then(Commands.literal("buckets").executes(c -> buckets(c.getSource())))
            .then(Commands.literal("persist").executes(c -> persist(c.getSource())))));
    }
    static void check(boolean ok, String message) { if (!ok) throw new IllegalStateException("PYROTEST FAIL: " + message); }
    static IFluidHandler handler(CommandSourceStack s, BlockPos p) {
        var h = s.getLevel().getCapability(Capabilities.FluidHandler.BLOCK,p,Direction.WEST);
        for (Direction side:Direction.values()) if(h==null) h=s.getLevel().getCapability(Capabilities.FluidHandler.BLOCK,p,side);
        if(h==null) h=s.getLevel().getCapability(Capabilities.FluidHandler.BLOCK,p,null);
        check(h!=null,"жидкостная способность " + p); return h;
    }
    static void say(CommandSourceStack s,String msg) {s.sendSuccess(()->Component.literal("PYROTEST OK: "+msg),true);}
    static int setup(CommandSourceStack s) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        var l=s.getLevel();
        for(int x:new int[]{0,4,8,12,13,14,15,16}) l.removeBlock(new BlockPos(x,-60,0),false);
        l.removeBlock(new BlockPos(0,-60,6),false);
        l.setBlock(BURNER,CDGBlocks.BURNER.getDefaultState(),Block.UPDATE_ALL);
        l.setBlock(TANK,AllBlocks.FLUID_TANK.getDefaultState(),Block.UPDATE_ALL);
        l.setBlock(BLAZE,AllBlocks.BLAZE_BURNER.getDefaultState().setValue(com.simibubi.create.content.processing.burner.BlazeBurnerBlock.HEAT_LEVEL, com.simibubi.create.content.processing.burner.BlazeBurnerBlock.HeatLevel.SMOULDERING),Block.UPDATE_ALL);
        check(handler(s,TANK).fill(new FluidStack(Pyrofuel.GEL.source.get(),2000),IFluidHandler.FluidAction.EXECUTE)==2000,"заливка бака");
        var liquid=handler(s,TANK).drain(100,IFluidHandler.FluidAction.SIMULATE);
        check(handler(s,BURNER).fill(liquid,IFluidHandler.FluidAction.EXECUTE)==100,"заливка горелки");
        handler(s,TANK).drain(100,IFluidHandler.FluidAction.EXECUTE);
        var burner=(BurnerBlockEntity)l.getBlockEntity(BURNER);burner.valveState=1;initial=100;
        check(FluidUtil.getFluidContained(new ItemStack(Pyrofuel.GEL.bucket.get())).orElseThrow().getAmount()==1000,"ведро 1000 мВ");
        check(!((BucketItem)Pyrofuel.GEL.bucket.get()).emptyContents(null,l,TANK.above(),null,new ItemStack(Pyrofuel.GEL.bucket.get())),"запрет разлива");
        try {
            var m=BlazeBurnerBlockEntity.class.getDeclaredMethod("tryUpdateFuel",ItemStack.class,boolean.class,boolean.class);m.setAccessible(true);
            check((boolean)m.invoke(l.getBlockEntity(BLAZE),new ItemStack(Pyrofuel.BRIQUETTE.get()),false,false),"брикет принимается всполохом");
        } catch (ReflectiveOperationException ex) {throw new IllegalStateException(ex);}
        for(String name:new String[]{"pyrocoke_mix","soaked_pyromass","raw_pyrocoke_briquette","pyrocoke_briquette","stabilizing_additive","raw_pyrogel","pyrogel","recycle_blaze_cake"})
            check(l.getRecipeManager().byKey(Pyrofuel.rl(name)).isPresent(),"загрузка рецепта "+name);
        for(String name:new String[]{"compacting/blaze_cake","filling/blaze_cake"})
            check(l.getRecipeManager().byKey(ResourceLocation.fromNamespaceAndPath("create",name)).isEmpty(),"старый рецепт выключен "+name);
        // Отдельная линия: бак → труба → насос → труба → жидкостная горелка.
        l.setBlock(new BlockPos(12,-60,0), CDGBlocks.BURNER.getDefaultState(), Block.UPDATE_ALL);
        l.setBlock(new BlockPos(16,-60,0), AllBlocks.FLUID_TANK.getDefaultState(), Block.UPDATE_ALL);
        for (int x : new int[]{13,15}) l.setBlock(new BlockPos(x,-60,0), AllBlocks.FLUID_PIPE.getDefaultState(), Block.UPDATE_ALL);
        l.setBlock(new BlockPos(14,-60,0), AllBlocks.MECHANICAL_PUMP.getDefaultState()
            .setValue(net.minecraft.world.level.block.state.properties.BlockStateProperties.FACING,Direction.WEST), Block.UPDATE_ALL);
        handler(s,new BlockPos(16,-60,0)).fill(new FluidStack(Pyrofuel.GEL.source.get(),2000),IFluidHandler.FluidAction.EXECUTE);
        ((BurnerBlockEntity)l.getBlockEntity(new BlockPos(12,-60,0))).valveState=1;
        var pump=(com.simibubi.create.content.fluids.pump.PumpBlockEntity)l.getBlockEntity(new BlockPos(14,-60,0));
        pump.setSpeed(64); pump.onSpeedChanged(0); drivePump=true;
        var engineBlock=net.minecraft.core.registries.BuiltInRegistries.BLOCK.get(ResourceLocation.fromNamespaceAndPath("createdieselgenerators","diesel_engine"));
        l.setBlock(new BlockPos(0,-60,6),engineBlock.defaultBlockState(),Block.UPDATE_ALL);
        handler(s,new BlockPos(0,-60,6)).fill(new FluidStack(Pyrofuel.GEL.source.get(),100),IFluidHandler.FluidAction.EXECUTE);
        say(s,"рецепты, ведро, запрет разлива, бак 1900 мВ, заливка горелки, приём брикета");return 1;
    }
    static int report(CommandSourceStack s) {
        var b=(BurnerBlockEntity)s.getLevel().getBlockEntity(BURNER);int left=handler(s,BURNER).getFluidInTank(0).getAmount();
        check(b.heat>=1.8f,"перегрев жидкостной горелки");check(left<initial && left>0,"расход топлива");
        var blaze=(BlazeBurnerBlockEntity)s.getLevel().getBlockEntity(BLAZE);
        check(blaze.getActiveFuel()==BlazeBurnerBlockEntity.FuelType.SPECIAL,"особое топливо брикета");
        var piped=(BurnerBlockEntity)s.getLevel().getBlockEntity(new BlockPos(12,-60,0));
        check(piped.heat>=1.8f,"перегрев через настоящий насос и трубы: heat="+piped.heat+", pump="+((com.simibubi.create.content.kinetics.base.KineticBlockEntity)s.getLevel().getBlockEntity(new BlockPos(14,-60,0))).getSpeed()+", tank="+handler(s,new BlockPos(16,-60,0)).getFluidInTank(0).getAmount());
        check(handler(s,new BlockPos(16,-60,0)).getFluidInTank(0).getAmount()<2000,"отбор насосом из бака");
        var engine=(com.jesz.createdieselgenerators.content.diesel_engine.normal.DieselEngineBlockEntity)s.getLevel().getBlockEntity(new BlockPos(0,-60,6));
        check(Float.isFinite(engine.calculateAddedStressCapacity()) && engine.calculateAddedStressCapacity()==0,"двигатель не получает мощности и NaN");
        say(s,"перегрев через трубы и насос; перегрев: heat="+b.heat+", остаток "+left+" мВ; брикет — SPECIAL");return 1;
    }
    static int empty(CommandSourceStack s) {handler(s,BURNER).drain(1000,IFluidHandler.FluidAction.EXECUTE);return 1;}
    static int stopped(CommandSourceStack s) {
        check(((BurnerBlockEntity)s.getLevel().getBlockEntity(BURNER)).heat<0,"остановка пустой горелки");say(s,"без топлива горелка остановилась");return 1;
    }
    static int buckets(CommandSourceStack s) {
        int before=handler(s,TANK).getFluidInTank(0).getAmount();
        var emptied=FluidUtil.tryEmptyContainer(new ItemStack(Pyrofuel.GEL.bucket.get()),handler(s,TANK),1000,null,true);
        check(emptied.isSuccess()&&emptied.getResult().is(net.minecraft.world.item.Items.BUCKET),"опорожнение ведра в бак");
        check(handler(s,TANK).getFluidInTank(0).getAmount()==before+1000,"баланс ведро → бак");
        var filled=FluidUtil.tryFillContainer(new ItemStack(net.minecraft.world.item.Items.BUCKET),handler(s,TANK),1000,null,true);
        check(filled.isSuccess()&&filled.getResult().is(Pyrofuel.GEL.bucket.get()),"набор ведра из бака");
        check(handler(s,TANK).getFluidInTank(0).getAmount()==before,"баланс бак → ведро");
        check(!Pyrofuel.GEL.type.get().canBePlacedInLevel(s.getLevel(),TANK.above(),new FluidStack(Pyrofuel.GEL.source.get(),1000)),"запрет источника для шлангов и разлива");
        say(s,"переливание ведро ↔ бак без потерь; создание источника запрещено");return 1;
    }
    static int persist(CommandSourceStack s) {
        var f=handler(s,TANK).getFluidInTank(0);check(f.getFluid()==Pyrofuel.GEL.source.get()&&f.getAmount()==1900,"сохранение бака после перезапуска");say(s,"после перезапуска сохранено 1900 мВ пирогеля");return 1;
    }
}
