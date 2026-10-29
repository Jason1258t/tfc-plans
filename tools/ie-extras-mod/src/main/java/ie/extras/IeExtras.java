package ie.extras;

import ie.extras.basin.BasinHeaters;
import ie.extras.mixin.IeExtrasMixinPlugin;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * IE Extras — блоки и функции к Immersive Engineering для сборки TFC Планы. Первый блок — аналоговый нагреватель:
 * электрический (FE) нагреватель для тигля и других тепловых устройств TFC, температура задаётся силой сигнала
 * красного камня (аналоговый рычаг Create, компаратор). С 1.1.0 — нагрев чаши Create (WoodenCog) внешним нагревателем
 * IE, аналоговым нагревателем и нагревателем EE.
 */
@Mod(IeExtras.MOD_ID)
public class IeExtras {
    public static final String MOD_ID = "ie_extras";

    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(MOD_ID);
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MOD_ID);

    /** Вкладка творческого режима IE (IECreativeTabs, id «main») */
    static final ResourceKey<CreativeModeTab> IE_TAB = ResourceKey.create(Registries.CREATIVE_MODE_TAB,
            ResourceLocation.fromNamespaceAndPath("immersiveengineering", "main"));

    public static final DeferredBlock<AnalogHeaterBlock> ANALOG_HEATER = BLOCKS.register("analog_heater",
            () -> new AnalogHeaterBlock(BlockBehaviour.Properties.of()
                    .mapColor(MapColor.METAL)
                    .strength(3.0f, 15.0f)
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops()
                    .lightLevel(state -> state.getValue(AnalogHeaterBlock.LIT) ? 6 : 0)));
    public static final DeferredItem<Item> ANALOG_HEATER_ITEM = ITEMS.register("analog_heater",
            () -> new TooltipBlockItem(ANALOG_HEATER.get(), new Item.Properties()));
    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<AnalogHeaterBlockEntity>> ANALOG_HEATER_BE =
            BLOCK_ENTITIES.register("analog_heater", () -> BlockEntityType.Builder
                    .of(AnalogHeaterBlockEntity::new, ANALOG_HEATER.get()).build(null));

    public IeExtras(IEventBus modBus, ModContainer container) {
        BLOCKS.register(modBus);
        ITEMS.register(modBus);
        BLOCK_ENTITIES.register(modBus);
        container.registerConfig(ModConfig.Type.SERVER, Config.SPEC);
        // Энергия — с любой грани, кроме греющей (лицевой)
        modBus.addListener((RegisterCapabilitiesEvent e) -> e.registerBlockEntity(Capabilities.EnergyStorage.BLOCK,
                ANALOG_HEATER_BE.get(), (be, side) -> side == be.facing() ? null : be.energy));
        // Чаша Create: внешний нагреватель IE как источник тепла (с WoodenCog — BasinHeaters)
        if (IeExtrasMixinPlugin.basinHeat()) modBus.addListener(BasinHeaters::registerCapabilities);
        modBus.addListener((BuildCreativeModeTabContentsEvent e) -> {
            if (e.getTabKey().equals(IE_TAB)) e.accept(ANALOG_HEATER_ITEM.get());
        });
    }

    public static ResourceLocation rl(String path) {
        return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
    }

    /** Предмет блока с подсказкой из языкового файла: что делает (.tooltip) и как управлять (.tooltip.more) */
    public static class TooltipBlockItem extends BlockItem {
        public TooltipBlockItem(Block block, Properties properties) {
            super(block, properties);
        }

        @Override
        public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
            tooltip.add(Component.translatable(getDescriptionId() + ".tooltip").withStyle(ChatFormatting.GRAY));
            tooltip.add(Component.translatable(getDescriptionId() + ".tooltip.more",
                    Math.round(Config.maxTemperature()), Config.fePerTickAtMax()).withStyle(ChatFormatting.DARK_GRAY));
        }
    }
}
