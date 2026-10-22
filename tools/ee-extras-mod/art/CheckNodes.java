import com.george_vi.electroenergetics.content.bundled_wire.BundledWireNodeConfigurator;
import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ee.extras.Layout;
import ee.extras.Tier;
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
    static final Path TAP_MODELS = Path.of("src/main/resources/assets/ee_extras/models/block/four_core_tap");
    static final Path EE_MODELS = Path.of("src/main/resources/assets/electroenergetics/models/block/duplex_wire_termination");
    /** По положению o = ROLL + 2·FLIP (CableOrientation) */
    static final String[] ORIENT_MODELS = {"block", "block_roll", "block_flip", "block_flip_roll"};

    /** Как CableEndBlock.configurator: o раз крен (x, z) → (16 − z, x) */
    static NodeConfigurator nodes(float[][] points, int o) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] p : points) {
            float x = p[0], z = p[2];
            for (int i = 0; i < o; i++) {
                float t = x;
                x = 16 - z;
                z = t;
            }
            b.add(x, p[1], z);
        }
        return b.simple();
    }

    static Map<String, float[][]> boxes(Path file) {
        try {
            JsonObject model = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            Map<String, float[][]> boxes = new LinkedHashMap<>();
            for (JsonElement el : model.getAsJsonArray("elements")) {
                JsonObject o = el.getAsJsonObject();
                if (o.has("name")) boxes.put(o.get("name").getAsString(), new float[][] {vec(o.getAsJsonArray("from")), vec(o.getAsJsonArray("to"))});
            }
            return boxes;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** Середина боковой грани коробки, дальней (outer) или ближней к центру блока по горизонтали */
    static float[] sideFace(float[][] c, boolean outer) {
        float cx = (c[0][0] + c[1][0]) / 2, cy = (c[0][1] + c[1][1]) / 2, cz = (c[0][2] + c[1][2]) / 2;
        float[][] faces = {{c[0][0], cy, cz}, {c[1][0], cy, cz}, {cx, cy, c[0][2]}, {cx, cy, c[1][2]}};
        float[] best = null;
        double bd = 0;
        for (float[] f : faces) {
            double d = Math.hypot(f[0] - 8, f[2] - 8);
            if (best == null || (outer ? d > bd : d < bd)) {
                best = f;
                bd = d;
            }
        }
        return best;
    }

    /** Из модели: узел 0 — середина наружной грани вывода кабеля, узлы 1–4 — центры клемм l1, l2, l3, n */
    static List<float[]> terminationPoints(Path dir, String[] terms, int o) {
        Map<String, float[][]> boxes = boxes(dir.resolve(ORIENT_MODELS[o] + ".json"));
        List<float[]> out = new ArrayList<>();
        out.add(sideFace(boxes.get("cable_entry"), true));
        for (String t : terms) {
            float[][] b = boxes.get(t);
            out.add(new float[] {(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2});
        }
        return out;
    }

    static Vec3 rotate(float[] p, int[] r) {
        var m = BlockModelRotation.by(r[0], r[1]).getRotation().getMatrix();
        Vector4f v = new Vector4f(p[0] / 16f - .5f, p[1] / 16f - .5f, p[2] / 16f - .5f, 1f);
        m.transform(v);
        return new Vec3(v.x + .5, v.y + .5, v.z + .5);
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
        for (Layout layout : new Layout[] {Layout.THREE_PHASE, Layout.SINGLE_PHASE, Layout.THREE_PHASE_INVERTER,
                Layout.SINGLE_PHASE_INVERTER, Layout.CONVERTER}) {
          for (Tier tier : layout == Layout.CONVERTER ? new Tier[] {Tier.LIGHT} : Tier.values()) {
            float y = tier.terminalY;
            for (boolean rolled : new boolean[] {false, true}) {
                NodeConfigurator.Builder b = new NodeConfigurator.Builder();
                for (float[] t : layout.terminals()) {
                    float[] p = rolled ? Layout.roll(t) : t;
                    b.add(p[0], y, p[1]);
                }
                NodeConfigurator nc = b.simple();
                for (var e : rot.entrySet()) {
                    Map<Integer, Vec3> nodes = nc.getNodes(e.getKey());
                    var m = BlockModelRotation.by(e.getValue()[0], e.getValue()[1]).getRotation().getMatrix();
                    for (int i = 0; i < layout.terminals().length; i++) {
                        float[] p = rolled ? Layout.roll(layout.terminals()[i]) : layout.terminals()[i];
                        Vector4f v = new Vector4f(p[0] / 16f - .5f, y / 16f - .5f, p[1] / 16f - .5f, 1f);
                        m.transform(v);
                        Vec3 model = new Vec3(v.x + .5, v.y + .5, v.z + .5);
                        total++;
                        if (model.distanceTo(nodes.get(i)) > 1e-4) {
                            bad++;
                            System.out.printf("НЕ СОВПАЛО %s%s %s крен=%s клемма %d: модель %s, провод %s%n",
                                    tier.prefix, layout.id(), e.getKey(), rolled, i, model, nodes.get(i));
                        }
                    }
                }
            }
          }
        }
        // Четырёхжильный соединитель: клеммы и торец вывода кабеля в сгенерированных моделях (4 положения) против
        // точек проводов его NodeConfigurator (Layout.FOUR_CORE_TERMINATION, повороты — как в CableEndBlock)
        // Отвод фазы — то же для его моделей и Layout.PHASE_TAP
        for (int o = 0; o < 8; o++) {
            boolean tap = o >= 4;
            List<float[]> model = terminationPoints(tap ? TAP_MODELS : MODELS,
                    tap ? new String[] {"phase", "n"} : new String[] {"l1", "l2", "l3", "n"}, o % 4);
            NodeConfigurator nc = nodes(tap ? Layout.PHASE_TAP : Layout.FOUR_CORE_TERMINATION, o % 4);
            for (var e : rot.entrySet()) {
                Map<Integer, Vec3> nodes = nc.getNodes(e.getKey());
                for (int i = 0; i < model.size(); i++) {
                    Vec3 at = rotate(model.get(i), e.getValue());
                    total++;
                    if (at.distanceTo(nodes.get(i)) > 1e-4) {
                        bad++;
                        System.out.printf("НЕ СОВПАЛО %s %s положение %d узел %d: модель %s, провод %s%n",
                                tap ? "four_core_tap" : "four_core_termination", e.getKey(), o % 4, i, at, nodes.get(i));
                    }
                }
            }
        }
        // Двухпроводной соединитель EE: внутренняя грань нашей втулки вывода (cable_gland в его моделях) — точка кабеля
        // EE (BundledWireNodeConfigurator, сторона = положение) во всех 24 положениях, блокстейт EE — те же повороты
        for (int o = 0; o < 4; o++) {
            float[] gland = sideFace(boxes(EE_MODELS.resolve(ORIENT_MODELS[o] + ".json")).get("cable_gland"), false);
            for (var e : rot.entrySet()) {
                Vec3 node = BundledWireNodeConfigurator.getPos(e.getKey(), 0x1000 | o << 4);
                Vec3 at = rotate(gland, e.getValue());
                total++;
                if (at.distanceTo(node) > 1e-4) {
                    bad++;
                    System.out.printf("НЕ СОВПАЛО duplex_wire_termination %s положение %d: вывод %s, кабель EE %s%n",
                            e.getKey(), o, at, node);
                }
            }
        }
        System.out.println(bad == 0 ? "все " + total + " клемм совпали" : "несовпадений: " + bad + " из " + total);
        if (bad > 0) System.exit(1);
    }
}
