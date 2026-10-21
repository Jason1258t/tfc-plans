import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ee.extras.Layout;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
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
    static final Path MODELS = Path.of("src/main/resources/assets/ee_extras/models/block/four_core_termination");

    /** Как CableEndBlock.configurator: крен (x, z) → (16 − z, x) */
    static NodeConfigurator nodes(float[][] points, boolean rolled) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] p : points) {
            if (rolled) b.add(16 - p[2], p[1], p[0]);
            else b.add(p[0], p[1], p[2]);
        }
        return b.simple();
    }

    /**
     * Из модели: узел 0 — середина грани вывода кабеля, обращённой наружу (south без крена, west с креном),
     * узлы 1–4 — центры клемм l1, l2, l3, n
     */
    static List<float[]> terminationPoints(boolean rolled) {
        try {
            JsonObject model = JsonParser.parseString(Files.readString(MODELS.resolve(rolled ? "block_roll.json" : "block.json"))).getAsJsonObject();
            Map<String, float[][]> boxes = new LinkedHashMap<>();
            for (JsonElement el : model.getAsJsonArray("elements")) {
                JsonObject o = el.getAsJsonObject();
                boxes.put(o.get("name").getAsString(), new float[][] {vec(o.getAsJsonArray("from")), vec(o.getAsJsonArray("to"))});
            }
            List<float[]> out = new ArrayList<>();
            float[][] c = boxes.get("cable_entry");
            float cx = (c[0][0] + c[1][0]) / 2, cy = (c[0][1] + c[1][1]) / 2, cz = (c[0][2] + c[1][2]) / 2;
            out.add(rolled ? new float[] {c[0][0], cy, cz} : new float[] {cx, cy, c[1][2]});
            for (String t : new String[] {"l1", "l2", "l3", "n"}) {
                float[][] b = boxes.get(t);
                out.add(new float[] {(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2});
            }
            return out;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    static float[] vec(JsonArray a) {
        return new float[] {a.get(0).getAsFloat(), a.get(1).getAsFloat(), a.get(2).getAsFloat()};
    }

    public static void main(String[] args) {
        Map<Direction, int[]> rot = new LinkedHashMap<>();
        rot.put(Direction.UP, new int[] {0, 0});
        rot.put(Direction.DOWN, new int[] {180, 0});
        rot.put(Direction.SOUTH, new int[] {270, 0});
        rot.put(Direction.NORTH, new int[] {270, 180});
        rot.put(Direction.EAST, new int[] {270, 270});
        rot.put(Direction.WEST, new int[] {270, 90});
        int bad = 0, total = 0;
        for (Layout layout : new Layout[] {Layout.THREE_PHASE, Layout.SINGLE_PHASE, Layout.CONVERTER}) {
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
        // Четырёхжильный соединитель: клеммы и торец вывода кабеля в сгенерированных моделях (block, block_roll) против
        // точек проводов его NodeConfigurator (Layout.FOUR_CORE_TERMINATION, крен — как у выпрямителей)
        for (boolean rolled : new boolean[] {false, true}) {
            List<float[]> model = terminationPoints(rolled);
            NodeConfigurator nc = nodes(Layout.FOUR_CORE_TERMINATION, rolled);
            for (var e : rot.entrySet()) {
                Map<Integer, Vec3> nodes = nc.getNodes(e.getKey());
                var m = BlockModelRotation.by(e.getValue()[0], e.getValue()[1]).getRotation().getMatrix();
                for (int i = 0; i < model.size(); i++) {
                    float[] p = model.get(i);
                    Vector4f v = new Vector4f(p[0] / 16f - .5f, p[1] / 16f - .5f, p[2] / 16f - .5f, 1f);
                    m.transform(v);
                    Vec3 at = new Vec3(v.x + .5, v.y + .5, v.z + .5);
                    total++;
                    if (at.distanceTo(nodes.get(i)) > 1e-4) {
                        bad++;
                        System.out.printf("НЕ СОВПАЛО four_core_termination %s крен=%s узел %d: модель %s, провод %s%n",
                                e.getKey(), rolled, i, at, nodes.get(i));
                    }
                }
            }
        }
        System.out.println(bad == 0 ? "все " + total + " клемм совпали" : "несовпадений: " + bad + " из " + total);
        if (bad > 0) System.exit(1);
    }
}
