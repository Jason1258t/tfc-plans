package ee.extras.cable;

import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * Проложенные кабели измерения: какие провода EE (оболочка и жилы) составляют каждый кабель, и фаза двухпроводных
 * соединителей EE, к которым подведён четырёхжильный кабель. Раз в CHECK_TICKS тиков сверяется с проводами EE: пропала
 * хоть одна часть кабеля (смотали катушкой, перерезали, сгорела жила, сломали блок) — убираются и остальные, без
 * выпадения предметов (что положено, выпало или вернулось катушкой у той части, которую убрал игрок или EE).
 */
public class CableData extends SavedData {
    static final String NAME = "ee_extras_cables";
    static final int CHECK_TICKS = 10;

    /**
     * Кабель: оболочка между a и b и жилы cores[i] = {узел на a, узел на b}. mixedEnd — у четырёхжильного кабеля к
     * соединителю EE: 1 — соединитель EE на конце a, 2 — на конце b, 0 — кабель не смешанный.
     */
    public static final class Cable {
        final CableKind kind;
        final InWorldNode a;
        final InWorldNode b;
        final List<InWorldNode[]> cores;
        final int mixedEnd;

        Cable(CableKind kind, InWorldNode a, InWorldNode b, List<InWorldNode[]> cores, int mixedEnd) {
            this.kind = kind;
            this.a = a;
            this.b = b;
            this.cores = cores;
            this.mixedEnd = mixedEnd;
        }

        BlockPos eeEnd() {
            return mixedEnd == 1 ? a.sourcePos() : mixedEnd == 2 ? b.sourcePos() : null;
        }
    }

    final List<Cable> cables = new ArrayList<>();
    /** Фаза (1–3) двухпроводного соединителя EE с подведённым четырёхжильным кабелем, по позиции блока */
    final Map<BlockPos, Integer> phases = new HashMap<>();

    public static CableData get(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(new Factory<>(CableData::new, CableData::load, null), NAME);
    }

    void add(Cable cable) {
        cables.add(cable);
        setDirty();
    }

    public int phase(BlockPos pos) {
        return phases.getOrDefault(pos, 1);
    }

    List<Cable> mixedAt(BlockPos pos) {
        List<Cable> out = new ArrayList<>();
        for (Cable c : cables) if (pos.equals(c.eeEnd())) out.add(c);
        return out;
    }

    /** Сверка с проводами EE: неполный кабель убрать целиком */
    void check(ServerLevel level) {
        if (cables.isEmpty() && phases.isEmpty()) return;
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        boolean changed = false;
        for (Iterator<Cable> it = cables.iterator(); it.hasNext(); ) {
            Cable c = it.next();
            boolean whole = sd.isConnected(c.a, c.b);
            for (InWorldNode[] core : c.cores) whole &= sd.isConnected(core[0], core[1]);
            if (whole) continue;
            remove(sd, c);
            it.remove();
            changed = true;
        }
        // Фазы соединителей, к которым больше не подходит ни один четырёхжильный кабель
        changed |= phases.keySet().removeIf(pos -> mixedAt(pos).isEmpty());
        if (changed) setDirty();
    }

    static void remove(InfrastructureSavedData sd, Cable c) {
        if (sd.isConnected(c.a, c.b)) sd.removeConnectionNoDrops(new InWorldNodeConnection(c.a, c.b));
        for (InWorldNode[] core : c.cores)
            if (sd.isConnected(core[0], core[1])) sd.removeConnectionNoDrops(new InWorldNodeConnection(core[0], core[1]));
    }

    // ---------------------------------------------------------------- сохранение

    static CompoundTag node(InWorldNode n) {
        CompoundTag t = new CompoundTag();
        t.putInt("Id", n.id());
        t.putLong("Pos", n.sourcePos().asLong());
        return t;
    }

    static InWorldNode node(CompoundTag t) {
        return new InWorldNode(t.getInt("Id"), BlockPos.of(t.getLong("Pos")));
    }

    @Override
    public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
        ListTag list = new ListTag();
        for (Cable c : cables) {
            CompoundTag t = new CompoundTag();
            t.putString("Kind", c.kind.name());
            t.put("A", node(c.a));
            t.put("B", node(c.b));
            t.putInt("Mixed", c.mixedEnd);
            ListTag cores = new ListTag();
            for (InWorldNode[] core : c.cores) {
                CompoundTag p = new CompoundTag();
                p.put("A", node(core[0]));
                p.put("B", node(core[1]));
                cores.add(p);
            }
            t.put("Cores", cores);
            list.add(t);
        }
        tag.put("Cables", list);
        ListTag ph = new ListTag();
        phases.forEach((pos, phase) -> {
            CompoundTag t = new CompoundTag();
            t.putLong("Pos", pos.asLong());
            t.putInt("Phase", phase);
            ph.add(t);
        });
        tag.put("Phases", ph);
        return tag;
    }

    static CableData load(CompoundTag tag, HolderLookup.Provider registries) {
        CableData d = new CableData();
        for (Tag e : tag.getList("Cables", Tag.TAG_COMPOUND)) {
            CompoundTag t = (CompoundTag) e;
            List<InWorldNode[]> cores = new ArrayList<>();
            for (Tag ce : t.getList("Cores", Tag.TAG_COMPOUND)) {
                CompoundTag p = (CompoundTag) ce;
                cores.add(new InWorldNode[] {node(p.getCompound("A")), node(p.getCompound("B"))});
            }
            d.cables.add(new Cable(CableKind.valueOf(t.getString("Kind")), node(t.getCompound("A")),
                    node(t.getCompound("B")), cores, t.getInt("Mixed")));
        }
        for (Tag e : tag.getList("Phases", Tag.TAG_COMPOUND)) {
            CompoundTag t = (CompoundTag) e;
            d.phases.put(BlockPos.of(t.getLong("Pos")), t.getInt("Phase"));
        }
        return d;
    }
}
