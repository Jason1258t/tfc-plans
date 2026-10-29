package ee.extras.lantern;

import blusunrize.immersiveengineering.api.wires.Connection;
import blusunrize.immersiveengineering.api.wires.ConnectionPoint;
import blusunrize.immersiveengineering.api.wires.GlobalWireNetwork;
import blusunrize.immersiveengineering.api.wires.IImmersiveConnectable;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;

/** Провода IE у блока (API IE 12.4.2: GlobalWireNetwork, LocalWireNetwork.getConnections) — только когда IE загружен */
final class IeWires {
    static boolean connected(ServerLevel level, BlockPos pos) {
        if (!(level.getBlockEntity(pos) instanceof IImmersiveConnectable c)) return false;
        GlobalWireNetwork net = GlobalWireNetwork.getNetwork(level);
        for (ConnectionPoint cp : c.getConnectionPoints())
            for (Connection con : net.getLocalNet(cp).getConnections(cp))
                if (!con.isInternal()) return true;
        return false;
    }

    private IeWires() {
    }
}
