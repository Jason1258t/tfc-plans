import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import ee.rectifier.Layout;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.resources.model.BlockModelRotation;
import net.minecraft.core.Direction;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector4f;

/**
 * Совпадают ли клеммы моделей с точками крепления проводов во всех положениях блока. Точки — настоящий
 * NodeConfigurator EE, клеммы — центры из Layout, повёрнутые настоящим BlockModelRotation Minecraft с поворотами
 * из блокстейта (как у преобразователя EE). Запуск — check-nodes.sh.
 */
public class CheckNodes {
    public static void main(String[] args) {
        Map<Direction, int[]> rot = new LinkedHashMap<>();
        rot.put(Direction.UP, new int[] {0, 0});
        rot.put(Direction.DOWN, new int[] {180, 0});
        rot.put(Direction.SOUTH, new int[] {270, 0});
        rot.put(Direction.NORTH, new int[] {270, 180});
        rot.put(Direction.EAST, new int[] {270, 270});
        rot.put(Direction.WEST, new int[] {270, 90});
        int bad = 0, total = 0;
        for (Layout layout : new Layout[] {Layout.THREE_PHASE, Layout.SINGLE_PHASE}) {
            for (boolean rolled : new boolean[] {false, true}) {
                NodeConfigurator.Builder b = new NodeConfigurator.Builder();
                for (float[] t : layout.terminals()) {
                    float[] p = rolled ? Layout.roll(t) : t;
                    b.add(p[0], Layout.TERMINAL_Y, p[1]);
                }
                NodeConfigurator nc = b.simple();
                for (var e : rot.entrySet()) {
                    Map<Integer, Vec3> nodes = nc.getNodes(e.getKey());
                    var m = BlockModelRotation.by(e.getValue()[0], e.getValue()[1]).getRotation().getMatrix();
                    for (int i = 0; i < layout.terminals().length; i++) {
                        float[] p = rolled ? Layout.roll(layout.terminals()[i]) : layout.terminals()[i];
                        Vector4f v = new Vector4f(p[0] / 16f - .5f, Layout.TERMINAL_Y / 16f - .5f, p[1] / 16f - .5f, 1f);
                        m.transform(v);
                        Vec3 model = new Vec3(v.x + .5, v.y + .5, v.z + .5);
                        total++;
                        if (model.distanceTo(nodes.get(i)) > 1e-4) {
                            bad++;
                            System.out.printf("НЕ СОВПАЛО %s %s крен=%s клемма %d: модель %s, провод %s%n",
                                    layout.id(), e.getKey(), rolled, i, model, nodes.get(i));
                        }
                    }
                }
            }
        }
        System.out.println(bad == 0 ? "все " + total + " клемм совпали" : "несовпадений: " + bad + " из " + total);
        if (bad > 0) System.exit(1);
    }
}
