package stress.fix;

import com.simibubi.create.content.kinetics.KineticNetwork;
import com.simibubi.create.content.kinetics.base.IRotate;
import com.simibubi.create.content.kinetics.base.KineticBlockEntity;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.event.tick.LevelTickEvent;
import stress.fix.mixin.KineticNetworkAccessor;
import stress.fix.mixin.TorquePropagatorAccessor;

/**
 * Create 6.0.10 при загрузке не пересчитывает сеть вращения с нуля. Первый загрузившийся блок сети отдаёт ей
 * запомненные при сохранении «всю мощность / всю нагрузку / число блоков» (KineticNetwork.initFromTE) — это учёт
 * незагруженной части. Каждый следующий блок при загрузке вычитает из него свой вклад (addSilently) и добавляется
 * уже как живой. Если запомненное разошлось с тем, что блоки вычитают (чанк сохранился со старыми числами, вклад
 * колеса при загрузке другой, блок убрали без сохранения сети), остаток так и висит в учёте как мощность или
 * нагрузка «где-то в незагруженных чанках». При следующем сохранении он попадает в итог сети и после перезахода
 * снова остаётся — копится, пока сеть не окажется «перегружена» миллионами.
 *
 * Раз в секунду проверяем сети с ненулевым учётом незагруженной части. Если у всех живых блоков сети все соседи,
 * с которыми Create может соединить вращение, загружены и уже записаны в сеть, — незагруженной части у сети нет,
 * и остаток ни к какому блоку не относится: обнуляем его и пересчитываем сеть. Если хоть один сосед в
 * незагруженном чанке или ещё не записался в сеть — сеть не трогаем (поведение Create как есть).
 */
public final class PhantomCleaner {
    /** Раз в сколько тиков проверять. */
    private static final int PERIOD = 20;
    /** Меньше этого (SU) не пишем в лог — мелкие расхождения округления. */
    private static final float LOG_THRESHOLD = 1f;

    /** -Dstress_fix.disabled=true — не чистить сами (команда /stressfix работает); для проверки и на всякий случай. */
    private static final boolean DISABLED = Boolean.getBoolean("stress_fix.disabled");

    private PhantomCleaner() {}

    public static void onLevelTick(LevelTickEvent.Post event) {
        if (!(event.getLevel() instanceof ServerLevel level) || level.getGameTime() % PERIOD != 0) return;
        if (DISABLED) return;
        clean(level, false);
    }

    /** Итог проверки одной сети — для команды /stressfix. */
    public record Result(long id, BlockPos pos, float unloadedCapacity, float unloadedStress, int unloadedMembers,
            int members, boolean fullyLoaded, boolean cleaned) {}

    /** Проверить сети мира; force — пересчитать вклады живых блоков, даже если учёт незагруженной части пуст. */
    public static List<Result> clean(ServerLevel level, boolean force) {
        List<Result> results = new ArrayList<>();
        Map<Long, KineticNetwork> networks = TorquePropagatorAccessor.stressFix$getNetworks().get(level);
        if (networks == null) return results;
        for (KineticNetwork network : new ArrayList<>(networks.values())) {
            KineticNetworkAccessor acc = (KineticNetworkAccessor) network;
            float capacity = acc.stressFix$getUnloadedCapacity();
            float stress = acc.stressFix$getUnloadedStress();
            int unloadedMembers = acc.stressFix$getUnloadedMembers();
            boolean leftover = capacity != 0 || stress != 0 || unloadedMembers != 0;
            if (!force && !leftover) continue;
            if (network.members.isEmpty() || network.id == null) continue;
            boolean full = fullyLoaded(level, network);
            boolean cleaned = false;
            if (full) {
                if (force) refreshContributions(level, network);
                if (leftover) {
                    acc.stressFix$setUnloadedCapacity(0);
                    acc.stressFix$setUnloadedStress(0);
                    acc.stressFix$setUnloadedMembers(0);
                    cleaned = true;
                }
                if (cleaned || force) {
                    // Create сравнивает с прошлым итогом и рассылает новый всем блокам сети
                    network.updateNetwork();
                    network.sync();
                }
                if (cleaned && (Math.abs(capacity) >= LOG_THRESHOLD || Math.abs(stress) >= LOG_THRESHOLD)) {
                    StressFix.LOGGER.info(
                            "Сеть вращения у {}: убран фантом незагруженной части — мощность {} SU, нагрузка {} SU, блоков {} (живых блоков в сети {})",
                            BlockPos.of(network.id).toShortString(), Math.round(capacity), Math.round(stress),
                            unloadedMembers, network.members.size());
                }
            }
            if (leftover || force) {
                results.add(new Result(network.id, BlockPos.of(network.id), capacity, stress, unloadedMembers,
                        network.members.size(), full, cleaned));
            }
        }
        return results;
    }

    /**
     * Что мешает считать сеть загруженной целиком: соседний по вращению блок живого блока сети в незагруженном чанке
     * или уже загружен, но ещё не записался в сеть. null — сеть загружена целиком.
     */
    public static String blocker(ServerLevel level, KineticNetwork network) {
        for (KineticBlockEntity be : new ArrayList<>(network.members.keySet())) {
            BlockPos pos = be.getBlockPos();
            if (be.isRemoved() || !level.isLoaded(pos)) continue;
            BlockState state = be.getBlockState();
            List<BlockPos> neighbours = new ArrayList<>();
            for (Direction d : Direction.values()) neighbours.add(pos.relative(d));
            if (state.getBlock() instanceof IRotate rotate) {
                // Дальние связи: большие шестерни по диагонали, цепные приводы, ремни и т. п. — как у Create
                try {
                    be.addPropagationLocations(rotate, state, neighbours);
                } catch (RuntimeException e) {
                    return "ошибка обхода у " + pos.toShortString() + ": " + e;
                }
            }
            for (BlockPos n : neighbours) {
                // Не просто «загружен», а «тикает»: в пограничных чанках блоки загружены, но в сеть не записываются,
                // а между тиками isLoaded ещё отвечает «да» по уже выгруженному чанку (проверено на сервере разработки)
                if (!level.shouldTickBlocksAt(n)) {
                    return "чанк не работает: " + n.toShortString() + " (рядом с " + pos.toShortString() + ")";
                }
                BlockEntity other = level.getBlockEntity(n);
                if (other instanceof KineticBlockEntity k && network.id.equals(k.network)
                        && !network.members.containsKey(k)) {
                    // загружен, но ещё не записался в сеть (чанк не тикает или блок не успел)
                    return "блок ещё не в сети: " + n.toShortString();
                }
            }
        }
        return null;
    }

    static boolean fullyLoaded(ServerLevel level, KineticNetwork network) {
        return blocker(level, network) == null;
    }

    /** Заново спросить у живых блоков их вклад (мощность на 1 об/мин и нагрузку) — для принудительного пересчёта. */
    private static void refreshContributions(ServerLevel level, KineticNetwork network) {
        for (KineticBlockEntity be : new ArrayList<>(network.members.keySet())) {
            if (be.isRemoved()) continue;
            if (network.sources.containsKey(be)) network.sources.put(be, be.calculateAddedStressCapacity());
            network.members.put(be, be.calculateStressApplied());
        }
    }
}
