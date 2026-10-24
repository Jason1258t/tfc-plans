package aero.extra;

import com.george_vi.electroenergetics.foundation.nodes.NodeConfigurator;

/**
 * Клеммы бортового компьютера: центры {x, z} в пикселях для блока лицом вверх без крена, высота центра; 0 «+», 1 «−».
 * Сторона −Z модели — верх, когда блок стоит валом вбок. Отдельно от блока, чтобы art/CheckNodes.java читал их без
 * загрузки классов блоков Minecraft. Те же числа — в art/gen_assets.py.
 */
public final class Terminals {
    public static final float[][] CENTERS = {{5.5f, 1.5f}, {10.5f, 1.5f}};
    public static final float Y = 9;
    public static final String[] LABELS = {"load_positive", "load_negative"};
    public static final int PLUS = 0;
    public static final int MINUS = 1;

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
