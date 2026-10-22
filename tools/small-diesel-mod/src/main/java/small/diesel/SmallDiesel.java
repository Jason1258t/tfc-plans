package small.diesel;

import com.jesz.createdieselgenerators.CDGCreativeTab;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import small.diesel.electric.Electric;

/**
 * Малые дизели — дополнение к Create Diesel Generators для сборки TFC Планы: малый дизельный двигатель (вращение Create)
 * и, если стоит Electro Energetics, малый дизельный генератор (постоянный ток EE). Топливо и его теплота — из реестра
 * CDG (Fuel), горит по нагрузке.
 */
@Mod(SmallDiesel.MOD_ID)
public class SmallDiesel {
    public static final String MOD_ID = "small_diesel";
    static final String EE = "electroenergetics";

    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MOD_ID);

    public static final DeferredBlock<EngineBlock> ENGINE = BLOCKS.register("small_diesel_engine", () -> new EngineBlock(metal()));
    public static final DeferredItem<Item> ENGINE_ITEM = ITEMS.register("small_diesel_engine",
            () -> new TooltipBlockItem(ENGINE.get(), new Item.Properties()));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<EngineBlockEntity>> ENGINE_BE =
            BLOCK_ENTITIES.register("small_diesel_engine", () -> BlockEntityType.Builder
                    .of(EngineBlockEntity::new, ENGINE.get()).build(null));

    public SmallDiesel(IEventBus modBus) {
        boolean ee = ModList.get().isLoaded(EE);
        if (ee) Electric.register(modBus);
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        modBus.addListener((RegisterCapabilitiesEvent e) -> e.registerBlockEntity(Capabilities.FluidHandler.BLOCK,
                ENGINE_BE.get(), (be, side) -> side == be.getBlockState().getValue(EngineBlock.FACING) ? null : be.tank.getCapability()));
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (!e.getTabKey().equals(CDGCreativeTab.CREATIVE_TAB.getKey())) return;
            e.accept(ENGINE_ITEM.get());
            if (ee) e.accept(Electric.item());
        });
        if (FMLEnvironment.dist == Dist.CLIENT) EngineClient.register(modBus);
    }

    public static ResourceLocation rl(String path) {
        return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
    }

    public static BlockBehaviour.Properties metal() {
        return BlockBehaviour.Properties.of()
                .mapColor(MapColor.METAL)
                .strength(2.0f, 6.0f)
                .sound(SoundType.NETHERITE_BLOCK)
                .noOcclusion();
    }

    /** Предмет блока с подсказкой из языкового файла: что делает (.tooltip) и где что подключается (.tooltip.more) */
    public static class TooltipBlockItem extends BlockItem {
        public TooltipBlockItem(Block block, Properties properties) {
            super(block, properties);
        }

        @Override
        public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
            tooltip.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
            tooltip.add(Component.translatable(getDescriptionId() + ".tooltip.more").withStyle(ChatFormatting.DARK_GRAY));
        }
    }
}
