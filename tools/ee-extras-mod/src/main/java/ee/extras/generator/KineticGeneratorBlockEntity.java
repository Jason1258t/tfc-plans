package ee.extras.generator;

import com.george_vi.electroenergetics.devices.device.DevicesSavedData;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import ee.extras.EeExtras;
import java.util.List;
import net.createmod.catnip.lang.Lang;
import net.createmod.catnip.lang.LangNumberFormat;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Вал компактного кинетического генератора. Числа — по генератору EE 1.1.2 (по байткоду): у него выработка =
 * 48 × магниты × об/мин Вт, нагрузка на вал = 48 × (магниты + 0,125) SU на 1 об/мин, ЭДС = выработка / 100 А
 * (rotorPowerMultiplier, rotorFullLoadCurrent) — 1 SU сети ≈ 1 Вт. Компактный — 8 SU на 1 об/мин (отметка Create,
 * BlockStressValues), выработка 6 Вт на 1 об/мин (КПД 75 %), ЭДС 0,5 В на 1 об/мин (полный ток 12 А при любых оборотах):
 * 256 об/мин — 1 536 Вт при 128 В, 96 об/мин — 576 Вт при 48 В. Как у EE, вал нагружен всегда, даже без нагрузки на клеммах.
 */
public class KineticGeneratorBlockEntity extends KineticBlockEntity {
    public static final double STRESS_PER_RPM = 8;
    public static final double WATTS_PER_RPM = 6;
    public static final double VOLTS_PER_RPM = 0.5;
    /** Номинал нагрева, Вт: на 256 об/мин под полной нагрузкой — 128 %, дымит (сгорает с ~137 %), в масле — нет */
    public static final double NOMINAL = 1200;

    private GeneratorDevice device;

    public KineticGeneratorBlockEntity(BlockPos pos, BlockState state) {
        super(EeExtras.KINETIC_GENERATOR_BE.get(), pos, state);
    }

    @Override
    public void tick() {
        super.tick();
        if (!(level instanceof ServerLevel sl)) return;
        if (device == null || !device.isValid()) device = DevicesSavedData.load(sl).getDevice(worldPosition, GeneratorDevice.class);
        if (device == null) return;
        // getSpeed() — 0 при перегрузке сети вращения
        double rpm = Math.abs(getSpeed());
        device.maxPower = WATTS_PER_RPM * rpm;
        device.voltage = VOLTS_PER_RPM * rpm;
        device.pool = device.maxPower;
    }

    @Override
    public boolean addToGoggleTooltip(List<Component> tooltip, boolean isPlayerSneaking) {
        super.addToGoggleTooltip(tooltip, isPlayerSneaking);
        double rpm = Math.abs(getSpeed());
        // Строки — как у щёточного узла EE (его ключи перевода)
        Lang.builder("electroenergetics").translate("gui.goggles.electric_stats").forGoggles(tooltip);
        Lang.builder("electroenergetics").translate("gui.goggles.energy_generation").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder("electroenergetics").text(LangNumberFormat.format(Math.round(WATTS_PER_RPM * rpm)))
                .translate("generic.watts").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        Lang.builder("electroenergetics").translate("gui.goggles.voltage").style(ChatFormatting.GRAY).forGoggles(tooltip);
        Lang.builder("electroenergetics").text(LangNumberFormat.format(Math.round(VOLTS_PER_RPM * rpm)))
                .translate("generic.volts").style(ChatFormatting.AQUA).forGoggles(tooltip, 1);
        return true;
    }
}
