package ee.extras.lines;

import com.george_vi.electroenergetics.content.wire_spool.WireSpoolItem;
import com.george_vi.electroenergetics.simulation.WireType;
import dev.engine_room.flywheel.lib.model.baked.PartialModel;
import ee.extras.EeExtras;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;

/**
 * Провода линий электропередачи и сильноточной разводки — обычные провода EE (те же клеммы и изоляторы), отличаются
 * только характеристиками, видом и рецептом.
 *
 * Как EE считает провод (по байткоду 1.1.2, WireLifetimeModule и WireData): нагрев зависит только от тока —
 * предельный ток = 33,3 + предельная температура / 30 (так же пишет подсказка катушки EE), сопротивление влияет только
 * на потери (R · длина). У голого провода нет предела напряжения. Провис середины пролёта = 0,05 · sag · пролёт ·
 * f, где f = 1 у провода, повешенного как есть, и меньше у натянутого (длина провода короче пролёта; см. Tension).
 *
 * Числа — пропорции реальной проводимости и прочности металлов, сжатые под масштаб EE (медь EE — 0,005 Ом/м,
 * железо — 0,01, хотя в жизни железо хуже меди в 6 раз). Пролёт — максимальная длина провода в блоках.
 */
public enum LineWire {
    /** Медная шина: от генератора к трансформатору, коротко и жёстко, без провиса (как железная шина EE) */
    COPPER_BUSBAR("copper_busbar", "copper_busbar", null, 0.001, 860, 8, 0f, 1f, 0.125f, 0, true),
    /** Силовой кабель: медь в толстой изоляции до 10 кВ, большой ток, короткие пролёты (гнётся, как кабель) */
    POWER_CABLE("power_cable", "power_cable", null, 0.0015, 700, 24, 0.7f, 0.6f, 0.1875f, 10000, true),
    /** М — медный многопроволочный: лучший по потерям для ЛЭП, но тяжёлый и дорогой */
    STRANDED_COPPER("stranded_copper", "stranded_copper_wire", null, 0.003, 300, 128, 1.0f, 0.5f, 0.09f, 0, false),
    /** АС — сталеалюминиевый: стальной сердечник держит длинный пролёт и сильную натяжку, основной провод дальних ЛЭП */
    ACSR("acsr", "acsr_wire", null, 0.007, 330, 192, 0.6f, 0.3f, 0.09f, 0, false),
    /** А — алюминиевый без сердечника: дешёвый, но короче пролёт и сильнее провисает */
    ALUMINUM("aluminum", null, "c:wires/aluminum", 0.008, 230, 96, 1.2f, 0.6f, 0.0625f, 0, false),
    /** Бр — бронзовый: до алюминия, прочный (длинный пролёт), но с заметными потерями */
    BRONZE("bronze", "bronze_wire", null, 0.012, 270, 160, 0.8f, 0.4f, 0.0625f, 0, false),
    /** ПС — стальной: самые длинные пролёты и почти без провиса, но большие потери — для малой мощности */
    STEEL("steel", null, "c:wires/steel", 0.02, 230, 256, 0.4f, 0.2f, 0.0625f, 0, false);

    /** Id типа провода EE (ee_extras:&lt;id&gt;), модели отрезка (block/line/&lt;id&gt;) и катушки (&lt;id&gt;_spool) */
    public final String id;
    /** Свой предмет провода (выпадает при снятии, им же меняют длину) или null — тогда тег dropTag (провода IE) */
    public final String item;
    public final String dropTag;
    public final double resistance;
    public final int maxCurrent;
    public final int span;
    public final float sag;
    /** Провис натянутого зажимом провода относительно свободного (f в формуле провиса); 1 — не натягивается */
    public final float minFactor;
    public final float thickness;
    /** Предел напряжения изоляции, В; 0 — голый провод */
    public final int maxVoltage;
    /** Отрезок — брусок (шина, кабель), иначе — две плоскости крестом, как у медного провода EE */
    public final boolean box;

    public DeferredHolder<WireType, WireType> type;
    public DeferredItem<Item> wire;
    public DeferredItem<WireSpoolItem> spool;
    public PartialModel model;

    LineWire(String id, String item, String dropTag, double resistance, int maxCurrent, int span, float sag,
             float minFactor, float thickness, int maxVoltage, boolean box) {
        this.id = id;
        this.item = item;
        this.dropTag = dropTag;
        this.resistance = resistance;
        this.maxCurrent = maxCurrent;
        this.span = span;
        this.sag = sag;
        this.minFactor = minFactor;
        this.thickness = thickness;
        this.maxVoltage = maxVoltage;
        this.box = box;
    }

    /** Предельная температура EE для нужного предельного тока: ток = 33,3 + температура / 30 */
    public double maxTemperature() {
        return (maxCurrent - 100.0 / 3) * 30;
    }

    /** Провис середины свободного пролёта, % его длины */
    public double sagPercent() {
        return 5 * sag;
    }

    public static LineWire of(WireType t) {
        for (LineWire w : values()) if (w.type != null && w.type.get() == t) return w;
        return null;
    }

    /** Регистрация в реестрах EeExtras (вызывается из его конструктора до register(modBus)) */
    public static void register() {
        for (LineWire w : values()) {
            w.model = PartialModel.of(EeExtras.rl("block/line/" + w.id));
            if (w.item != null) w.wire = EeExtras.ITEMS.register(w.item, () -> new Item(new Item.Properties()));
            w.type = EeExtras.WIRES.register(w.id, w::build);
            w.spool = EeExtras.ITEMS.register(w.id + "_spool",
                    () -> new WireSpoolItem(new Item.Properties().stacksTo(16), () -> w.type.get()));
        }
    }

    private WireType build() {
        WireType.Builder b = new WireType.Builder(model)
                .resistance(() -> resistance)
                .spoolItem(() -> spool.get())
                .maxTemperature(this::maxTemperature)
                .maxLength(() -> span)
                .sag(sag)
                .thickness(thickness);
        if (wire != null) b.droppedItem(() -> wire.get());
        else b.droppedTag(TagKey.create(Registries.ITEM, ResourceLocation.parse(dropTag)));
        if (maxVoltage > 0) b.maxInsulationVoltage(() -> maxVoltage).insulationResistance(1.0E6);
        if (this == POWER_CABLE) b.replaceOnOverheated(STRANDED_COPPER.type);
        return b.build();
    }
}
