package small.diesel.electric;

import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;

/**
 * Клеммы малого дизельного генератора: центры {x, z} в пикселях лицом вверх без крена, высота центра; 0 «+», 1 «−».
 * Отдельно от блока, чтобы art/CheckNodes.java читал их без загрузки классов блоков Minecraft. Те же числа — в
 * art/gen_assets.py.
 */
public final class Terminals {
    public static final float[][] CENTERS = {{4, 8}, {12, 8}};
    public static final float Y = 14.5f;
    public static final String[] LABELS = {"load_positive", "load_negative"};

    private Terminals() {}

    /** Крен: (x, z) → (16 − z, x) — поворот на 90° вокруг оси блока */
    public static float[] roll(float[] t) {
        return new float[] {16 - t[1], t[0]};
    }

    public static NodeConfigurator nodes(boolean rolled) {
        NodeConfigurator.Builder b = new NodeConfigurator.Builder();
        for (float[] t : CENTERS) {
            float[] p = rolled ? roll(t) : t;
            b.add(p[0], Y, p[1]);
        }
        return b.simple();
    }
}
