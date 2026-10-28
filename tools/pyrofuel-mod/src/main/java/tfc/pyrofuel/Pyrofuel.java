package tfc.pyrofuel;

import java.util.*;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.*;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.material.*;
import net.minecraft.world.phys.BlockHitResult;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.fluids.BaseFlowingFluid;
import net.neoforged.neoforge.fluids.FluidType;
import net.neoforged.neoforge.registries.*;

/** Промышленное топливо: твёрдые заряды для всполоха и жидкости для горелки CDG. */
@Mod(Pyrofuel.ID)
public class Pyrofuel {
    public static final String ID = "pyrofuel";
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(ID);
    public static final DeferredRegister<Fluid> FLUIDS = DeferredRegister.create(Registries.FLUID, ID);
    public static final DeferredRegister<FluidType> TYPES = DeferredRegister.create(NeoForgeRegistries.Keys.FLUID_TYPES, ID);
    public static final List<DeferredItem<Item>> MATERIALS = new ArrayList<>();
    public static final DeferredItem<Item> MIX = material("pyrocoke_mix");
    public static final DeferredItem<Item> MASS = material("soaked_pyromass");
    public static final DeferredItem<Item> RAW_BRIQUETTE = material("raw_pyrocoke_briquette");
    public static final DeferredItem<Item> BRIQUETTE = material("pyrocoke_briquette");
    public static final DeferredItem<Item> ADDITIVE = material("stabilizing_additive");
    public static final Liquid RAW_GEL = new Liquid("raw_pyrogel", false);
    public static final Liquid GEL = new Liquid("pyrogel", true);

    public Pyrofuel(IEventBus bus) {
        TYPES.register(bus); FLUIDS.register(bus); ITEMS.register(bus);
        bus.addListener((net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent e) ->
            e.registerItem(net.neoforged.neoforge.capabilities.Capabilities.FluidHandler.ITEM,
                (stack, context) -> new net.neoforged.neoforge.fluids.capability.wrappers.FluidBucketWrapper(stack),
                RAW_GEL.bucket.get(), GEL.bucket.get()));
        if (net.neoforged.fml.loading.FMLEnvironment.dist == net.neoforged.api.distmarker.Dist.CLIENT) PyrofuelClient.register(bus);
        bus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().equals(CreativeModeTabs.INGREDIENTS)) MATERIALS.forEach(i -> e.accept(i.get()));
            if (e.getTabKey().equals(CreativeModeTabs.TOOLS_AND_UTILITIES)) {
                e.accept(RAW_GEL.bucket.get()); e.accept(GEL.bucket.get());
            }
        });
    }
    static DeferredItem<Item> material(String name) {
        DeferredItem<Item> item = ITEMS.register(name, () -> new Item(new Item.Properties()) {
            @Override public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> lines, TooltipFlag flag) {
                lines.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
            }
        });
        MATERIALS.add(item); return item;
    }
    public static ResourceLocation rl(String path) { return ResourceLocation.fromNamespaceAndPath(ID, path); }
    public static final class Liquid {
        public final DeferredHolder<FluidType, FluidType> type;
        public final DeferredHolder<Fluid, BaseFlowingFluid.Source> source;
        public final DeferredHolder<Fluid, BaseFlowingFluid.Flowing> flowing;
        public final DeferredItem<BucketItem> bucket;
        Liquid(String name, boolean ready) {
            type = TYPES.register(name, () -> new FluidType(FluidType.Properties.create()
                    .descriptionId("fluid.pyrofuel." + name).density(1200).viscosity(ready ? 3000 : 4000)
                    .temperature(300).lightLevel(ready ? 5 : 0).canConvertToSource(false)) {});
            source = FLUIDS.register(name, () -> new BaseFlowingFluid.Source(properties()));
            flowing = FLUIDS.register("flowing_" + name, () -> new BaseFlowingFluid.Flowing(properties()));
            bucket = ITEMS.register(name + "_bucket", () -> new TankBucket(source.get()));
        }
        BaseFlowingFluid.Properties properties() { return new BaseFlowingFluid.Properties(type, source, flowing).bucket(bucket); }
    }
    /** Ведро работает с ёмкостями, но не создаёт источник в мире. */
    static class TankBucket extends BucketItem {
        TankBucket(Fluid fluid) { super(fluid, new Item.Properties().craftRemainder(Items.BUCKET).stacksTo(1)); }
        @Override public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> lines, TooltipFlag flag) {
            lines.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
        }
        @Override public boolean emptyContents(net.minecraft.world.entity.player.Player player, Level level,
                BlockPos pos, BlockHitResult hit, ItemStack container) { return false; }
    }
}
