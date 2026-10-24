package aero.extra;

import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import java.util.ArrayList;
import java.util.List;
import net.createmod.catnip.lang.LangBuilder;
import net.createmod.catnip.lang.LangNumberFormat;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Бортовой компьютер: вал Create в задней грани и до MAX_MODULES модулей. Генераторный модуль — как компактный
 * генератор EE Extras 2.3 (его числа взяты по генератору EE 1.1.2: 1 SU ≈ 1 Вт): 8 SU на 1 об/мин нагрузки на вал,
 * 6 Вт на 1 об/мин выработки (КПД 75 %), ЭДС 0,5 В на 1 об/мин. Аккумуляторный — ячейка аккумулятора EE (BatteryPack).
 *
 * Здесь всё состояние: модули, заряд одной ячейки (Кл) и последние показания для очков инженера; устройство EE
 * (OnboardDevice) берёт их каждый тик и возвращает заряд.
 */
public class OnboardComputerBlockEntity extends KineticBlockEntity {
    public static final int MAX_MODULES = 4;
    public static final double STRESS_PER_RPM = 8;
    public static final double WATTS_PER_RPM = 6;
    public static final double VOLTS_PER_RPM = 0.5;

    /** Модули по порядку установки (вынимается последний) */
    private final List<ModuleItem.Kind> modules = new ArrayList<>();
    private double charge;
    /** Показания с последнего тика EE: напряжение на клеммах, В; отдача в сеть, Вт (минус — заряд от сети); выработка, Вт */
    private double voltage;
    private double output;
    private double generation;
    private int syncTimer;

    public OnboardComputerBlockEntity(BlockPos pos, BlockState state) {
        super(AeroExtra.ONBOARD_COMPUTER_BE.get(), pos, state);
    }

    public record Modules(int generators, int batteries) {
        public int total() {
            return generators + batteries;
        }
    }

    public Modules modules() {
        int g = 0, b = 0;
        for (ModuleItem.Kind k : modules) {
            if (k == ModuleItem.Kind.GENERATOR) g++;
            else b++;
        }
        return new Modules(g, b);
    }

    public double rpm() {
        // getSpeed() — 0 при перегрузке сети вращения
        return Math.abs(getSpeed());
    }

    public double charge() {
        return charge;
    }

    void updateFromDevice(double charge, double voltage, double output, double generation) {
        this.charge = charge;
        this.voltage = voltage;
        this.output = output;
        this.generation = generation;
        setChanged();
    }

    @Override
    public void tick() {
        super.tick();
        // Показания очкам инженера — раз в полсекунды
        if (level != null && !level.isClientSide && ++syncTimer >= 10) {
            syncTimer = 0;
            sendData();
        }
    }

    /** Поставить модуль из стопки (одну штуку). false — мест нет */
    public boolean insert(ItemStack stack) {
        if (!(stack.getItem() instanceof ModuleItem item) || modules.size() >= MAX_MODULES) return false;
        if (item.kind == ModuleItem.Kind.BATTERY) {
            // Ячейки параллельно — заряд выравнивается: общий заряд делится на всех поровну
            int cells = modules().batteries();
            charge = (charge * cells + ModuleItem.charge(stack)) / (cells + 1);
        }
        modules.add(item.kind);
        modulesChanged();
        return true;
    }

    /** Вынуть последний модуль; аккумуляторный уносит заряд своей ячейки. Пусто — ItemStack.EMPTY */
    public ItemStack removeLast() {
        if (modules.isEmpty()) return ItemStack.EMPTY;
        ModuleItem.Kind k = modules.removeLast();
        ItemStack out = k == ModuleItem.Kind.BATTERY ? ModuleItem.battery(charge) : new ItemStack(AeroExtra.GENERATOR_MODULE.get());
        if (modules().batteries() == 0) charge = 0;
        modulesChanged();
        return out;
    }

    /** Все модули — при сломе блока */
    List<ItemStack> drops() {
        List<ItemStack> out = new ArrayList<>();
        for (ModuleItem.Kind k : modules)
            out.add(k == ModuleItem.Kind.BATTERY ? ModuleItem.battery(charge) : new ItemStack(AeroExtra.GENERATOR_MODULE.get()));
        return out;
    }

    private void modulesChanged() {
        // Нагрузка на вал зависит от числа генераторов — пересчитать в сети вращения
        if (hasNetwork()) getOrCreateNetwork().updateStressFor(this, calculateStressApplied());
        setChanged();
        sendData();
    }

    @Override
    public float calculateStressApplied() {
        float impact = (float) (STRESS_PER_RPM * modules().generators());
        lastStressApplied = impact;
        return impact;
    }

    @Override
    protected void write(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.write(tag, registries, clientPacket);
        ListTag list = new ListTag();
        for (ModuleItem.Kind k : modules) list.add(StringTag.valueOf(k.name()));
        tag.put("Modules", list);
        tag.putDouble("Charge", charge);
        if (clientPacket) {
            tag.putDouble("Voltage", voltage);
            tag.putDouble("Output", output);
            tag.putDouble("Generation", generation);
        }
    }

    @Override
    protected void read(CompoundTag tag, HolderLookup.Provider registries, boolean clientPacket) {
        super.read(tag, registries, clientPacket);
        modules.clear();
        for (Tag t : tag.getList("Modules", Tag.TAG_STRING)) {
            try {
                modules.add(ModuleItem.Kind.valueOf(t.getAsString()));
            } catch (IllegalArgumentException ignored) {
                // неизвестный модуль из будущей версии — пропускаем
            }
        }
        charge = tag.getDouble("Charge");
        if (clientPacket) {
            voltage = tag.getDouble("Voltage");
            output = tag.getDouble("Output");
            generation = tag.getDouble("Generation");
        }
    }

    private static LangBuilder lang() {
        return new LangBuilder(AeroExtra.MOD_ID);
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        super.addToGoggleTooltip(tooltip, isPlayerSneaking);
        Modules m = modules();
        lang().translate("goggles.title").forGoggles(tooltip);
        lang().translate("goggles.modules", m.total(), MAX_MODULES).style(ChatFormatting.GRAY).forGoggles(tooltip);
        if (m.generators() > 0) lang().translate("goggles.generators", m.generators()).style(ChatFormatting.DARK_GRAY).forGoggles(tooltip, 1);
        if (m.batteries() > 0) lang().translate("goggles.batteries", m.batteries()).style(ChatFormatting.DARK_GRAY).forGoggles(tooltip, 1);
        if (m.total() == 0) {
            lang().translate("goggles.hint").style(ChatFormatting.DARK_GRAY).forGoggles(tooltip, 1);
            return true;
        }
        if (m.generators() > 0) {
            lang().translate("goggles.generation").style(ChatFormatting.GRAY).forGoggles(tooltip);
            lang().text(LangNumberFormat.format(Math.round(generation)) + " / "
                            + LangNumberFormat.format(Math.round(WATTS_PER_RPM * rpm() * m.generators())))
                    .translate("unit.watts").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        }
        if (m.batteries() > 0) {
            lang().translate("goggles.charge").style(ChatFormatting.GRAY).forGoggles(tooltip);
            lang().text(Math.round(100 * charge / BatteryPack.nominalSafe()) + " %").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        }
        lang().translate("goggles.voltage").style(ChatFormatting.GRAY).forGoggles(tooltip);
        lang().text(String.format("%.1f", voltage)).translate("unit.volts").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        lang().translate(output >= 0 ? "goggles.output" : "goggles.charging").style(ChatFormatting.GRAY).forGoggles(tooltip);
        lang().text(LangNumberFormat.format(Math.round(Math.abs(output)))).translate("unit.watts")
                .style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        return true;
    }
}
