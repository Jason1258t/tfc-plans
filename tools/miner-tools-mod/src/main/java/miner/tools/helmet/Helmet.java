package miner.tools.helmet;

import com.mojang.serialization.Codec;
import java.util.EnumMap;
import java.util.List;
import java.util.function.Supplier;
import miner.tools.MinerTools;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.ItemTags;
import net.minecraft.tags.TagKey;
import net.minecraft.world.damagesource.DamageType;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.capabilities.RegisterCapabilitiesEvent;
import net.neoforged.neoforge.common.ModConfigSpec;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.energy.ComponentEnergyStorage;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Каска шахтёра: стальной шлем с аккумулятором FE и электрическим фонарём.
 * <p>
 * Заряд — компонент {@link #ENERGY} и способность {@code Capabilities.EnergyStorage.ITEM}, как у щита и рельсотрона IE
 * ({@code ComponentEnergyStorage}): по ней заряжает зарядная станция IE, ранец питания IE (надетые предметы) и любой
 * зарядник FE. Фонарь светит через LambDynamicLights (assets/miner_tools/dynamiclights): тот светит предметами в слотах
 * брони и Curios, если у предмета есть компонент {@link #LIT}. Сервер ставит его, пока фонарь включён и есть заряд.
 * Удары падающих блоков (тег {@link #CUSHIONED}) каска смягчает — {@link HelmetEvents}.
 */
public final class Helmet {
    private Helmet() {}

    /** Ёмкость аккумулятора, FE — как у низковольтного конденсатора IE, из которого каска собрана */
    public static final int CAPACITY = 100_000;
    /** Сколько FE за тик принимает при зарядке */
    public static final int MAX_RECEIVE = 1_000;

    /** Чем чинить на наковальне: стальной лист TFC */
    static final TagKey<Item> STEEL_SHEETS = ItemTags.create(ResourceLocation.fromNamespaceAndPath("c", "sheets/steel"));

    static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MinerTools.MOD_ID);
    static final DeferredRegister.DataComponents COMPONENTS = DeferredRegister.createDataComponents(
            Registries.DATA_COMPONENT_TYPE, MinerTools.MOD_ID);
    static final DeferredRegister<ArmorMaterial> MATERIALS = DeferredRegister.create(Registries.ARMOR_MATERIAL,
            MinerTools.MOD_ID);

    /** Заряд, FE */
    public static final Supplier<DataComponentType<Integer>> ENERGY = COMPONENTS.registerComponentType(
            "energy", b -> b.persistent(Codec.INT).networkSynchronized(ByteBufCodecs.VAR_INT));
    /** Выключатель фонаря (что выбрал игрок) */
    public static final Supplier<DataComponentType<Boolean>> LAMP_ON = COMPONENTS.registerComponentType(
            "lamp_on", b -> b.persistent(Codec.BOOL).networkSynchronized(ByteBufCodecs.BOOL));
    /**
     * Фонарь светит сейчас: включён, каска надета и есть заряд. Ставит только сервер; по нему светит LambDynamicLights.
     * Сохраняемый: несохраняемый компонент нельзя назвать в предикате предмета (components в match), а описание света
     * LambDynamicLights — такой предикат. Снятой каске его снимает {@link MinerHelmetItem#inventoryTick}
     */
    public static final Supplier<DataComponentType<Boolean>> LIT = COMPONENTS.registerComponentType(
            "lit", b -> b.persistent(Codec.BOOL).networkSynchronized(ByteBufCodecs.BOOL));

    /**
     * Материал как у стального шлема TFC (TFCArmorMaterials.STEEL: голова 2, прочность 1, зачарование 12). Слой брони не
     * нужен — каску рисует GeckoLib, но без слоя ArmorMaterial не создать.
     */
    public static final DeferredHolder<ArmorMaterial, ArmorMaterial> MATERIAL = MATERIALS.register("miner_helmet",
            () -> new ArmorMaterial(new EnumMap<>(java.util.Map.of(
                    ArmorItem.Type.HELMET, 2, ArmorItem.Type.CHESTPLATE, 6, ArmorItem.Type.LEGGINGS, 5,
                    ArmorItem.Type.BOOTS, 2, ArmorItem.Type.BODY, 6)),
                    12, SoundEvents.ARMOR_EQUIP_IRON, () -> Ingredient.of(STEEL_SHEETS),
                    List.of(new ArmorMaterial.Layer(id("miner_helmet"))), 1.0F, 0.0F));

    /** Прочность — как у стального шлема TFC (440) */
    public static final DeferredItem<MinerHelmetItem> HELMET = ITEMS.register("miner_helmet",
            () -> new MinerHelmetItem(MATERIAL, new Item.Properties().durability(440)));

    /** Какой урон каска смягчает: удары падающих блоков (data/miner_tools/tags/damage_type/cushioned_by_helmet.json) */
    public static final TagKey<DamageType> CUSHIONED = TagKey.create(Registries.DAMAGE_TYPE, id("cushioned_by_helmet"));

    public static final ModConfigSpec CONFIG;
    /** Расход фонаря, FE за тик */
    public static final ModConfigSpec.IntValue LAMP_COST;
    /** Насколько каска снижает урон от падающих блоков (0,5 — вдвое) */
    public static final ModConfigSpec.DoubleValue CUSHION;

    static {
        ModConfigSpec.Builder b = new ModConfigSpec.Builder();
        b.push("miner_helmet");
        LAMP_COST = b.comment("Расход фонаря каски, FE за тик (100 000 FE хватает на 50 000 тиков — ~40 минут при 2)")
                .defineInRange("lampCost", 2, 0, 10_000);
        CUSHION = b.comment("Доля урона от падающих блоков и обвалов, которую снимает каска (0.5 — половину);",
                        "сверху — обычные 25% любого шлема, броня и сопротивление дробящему урону TFC")
                .defineInRange("fallingBlockReduction", 0.5, 0.0, 1.0);
        b.pop();
        CONFIG = b.build();
    }

    public static ResourceLocation id(String path) {
        return ResourceLocation.fromNamespaceAndPath(MinerTools.MOD_ID, path);
    }

    /** Вызывается из конструктора MinerTools */
    public static void register(IEventBus modBus, ModContainer container) {
        ITEMS.register(modBus);
        COMPONENTS.register(modBus);
        MATERIALS.register(modBus);
        container.registerConfig(ModConfig.Type.SERVER, CONFIG, "miner_tools-helmet-server.toml");
        modBus.addListener(Helmet::capabilities);
        modBus.addListener(Helmet::creativeTab);
        modBus.addListener(Helmet::payloads);
        NeoForge.EVENT_BUS.register(HelmetEvents.class);
    }

    private static void capabilities(RegisterCapabilitiesEvent event) {
        // Приём — да, отдача — нет: заряд тратит только фонарь (иначе ранец питания или машины IE выкачают каску)
        event.registerItem(Capabilities.EnergyStorage.ITEM,
                (stack, ctx) -> new ComponentEnergyStorage(stack, ENERGY.get(), CAPACITY, MAX_RECEIVE, 0), HELMET.get());
    }

    private static void creativeTab(BuildCreativeModeTabContentsEvent event) {
        if (event.getTabKey() == CreativeModeTabs.TOOLS_AND_UTILITIES
                || event.getTabKey() == CreativeModeTabs.COMBAT) {
            event.accept(HELMET.get());
            ItemStack charged = new ItemStack(HELMET.get());
            charged.set(ENERGY.get(), CAPACITY);
            event.accept(charged);
        }
    }

    private static void payloads(RegisterPayloadHandlersEvent event) {
        event.registrar("1").playToServer(ToggleLampPayload.TYPE, ToggleLampPayload.CODEC,
                (payload, ctx) -> ctx.enqueueWork(() -> HelmetEvents.toggleWorn(ctx.player())));
    }

    // Состояние каски — из компонентов

    public static int energy(ItemStack stack) {
        return stack.getOrDefault(ENERGY.get(), 0);
    }

    public static boolean lampOn(ItemStack stack) {
        return stack.getOrDefault(LAMP_ON.get(), false);
    }

    public static boolean lit(ItemStack stack) {
        return stack.getOrDefault(LIT.get(), false);
    }

    /** Ставит или снимает {@link #LIT}; без лишних изменений компонента — каждое изменение уходит игрокам пакетом */
    static void setLit(ItemStack stack, boolean lit) {
        if (lit(stack) == lit) return;
        if (lit) stack.set(LIT.get(), true);
        else stack.remove(LIT.get());
    }
}
