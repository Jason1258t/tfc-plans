import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.resources.model.BlockModelRotation;
import net.minecraft.core.Direction;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector4f;
import small.diesel.electric.Terminals;

/**
 * Совпадают ли клеммы модели малого дизельного генератора (коробки «plus» и «minus» в block.json и block_roll.json)
 * с точками крепления проводов (настоящий NodeConfigurator EE из Terminals.nodes) во всех 12 положениях:
 * повороты — настоящий BlockModelRotation Minecraft с углами из блокстейта. Запуск — check-nodes.sh.
 */
public class CheckNodes {
    static final Path MODELS = Path.of("src/main/resources/assets/small_diesel/models/block/small_diesel_generator");

    public static void main(String[] args) throws Exception {
        Map<Direction, int[]> rot = new LinkedHashMap<>();
        rot.put(Direction.UP, new int[] {0, 0});
        rot.put(Direction.DOWN, new int[] {180, 0});
        rot.put(Direction.SOUTH, new int[] {270, 0});
        rot.put(Direction.NORTH, new int[] {270, 180});
        rot.put(Direction.EAST, new int[] {270, 270});
        rot.put(Direction.WEST, new int[] {270, 90});
        String[] terms = {"plus", "minus"};
        int bad = 0, total = 0;
        for (boolean rolled : new boolean[] {false, true}) {
            JsonObject model = JsonParser.parseString(Files.readString(MODELS.resolve(rolled ? "block_roll.json" : "block.json"))).getAsJsonObject();
            Map<String, float[]> centers = new LinkedHashMap<>();
            for (JsonElement el : model.getAsJsonArray("elements")) {
                JsonObject o = el.getAsJsonObject();
                if (!o.has("name")) continue;
                var f = o.getAsJsonArray("from");
                var t = o.getAsJsonArray("to");
                float[] c = new float[3];
                for (int i = 0; i < 3; i++) c[i] = (f.get(i).getAsFloat() + t.get(i).getAsFloat()) / 2;
                centers.put(o.get("name").getAsString(), c);
            }
            NodeConfigurator nc = Terminals.nodes(rolled);
            for (var e : rot.entrySet()) {
                Map<Integer, Vec3> nodes = nc.getNodes(e.getKey());
                var m = BlockModelRotation.by(e.getValue()[0], e.getValue()[1]).getRotation().getMatrix();
                for (int i = 0; i < terms.length; i++) {
                    float[] p = centers.get(terms[i]);
                    Vector4f v = new Vector4f(p[0] / 16f - .5f, p[1] / 16f - .5f, p[2] / 16f - .5f, 1f);
                    m.transform(v);
                    Vec3 at = new Vec3(v.x + .5, v.y + .5, v.z + .5);
                    total++;
                    if (at.distanceTo(nodes.get(i)) > 1e-4) {
                        bad++;
                        System.out.printf("НЕ СОВПАЛО %s крен=%s клемма %s: модель %s, провод %s%n", e.getKey(), rolled, terms[i], at, nodes.get(i));
                    }
                }
            }
        }
        System.out.println(bad == 0 ? "все " + total + " клемм совпали" : "несовпадений: " + bad + " из " + total);
        if (bad > 0) System.exit(1);
    }
}
