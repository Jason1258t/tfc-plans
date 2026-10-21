package ee.extras.cable;

import com.george_vi.electroenergetics.client.WireRenderer;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.infrastructure.WireData;
import net.createmod.catnip.data.Pair;

/** Только клиент: провода, которые EE прислал для отрисовки */
final class CableClient {
    /** Подходит ли к соединителю четырёхжильный кабель — тогда ключ переключает фазу (решает сервер) */
    static boolean hasFourCore(CableEnd end) {
        if (end == null) return false;
        InWorldNode node = end.cable();
        for (Pair<InWorldNodeConnection, WireData> c : WireRenderer.getAllConnections())
            if (c.getFirst().isAny(node) && c.getSecond().wireType() == CableWires.FOUR_CORE.get()) return true;
        return false;
    }

    private CableClient() {
    }
}
