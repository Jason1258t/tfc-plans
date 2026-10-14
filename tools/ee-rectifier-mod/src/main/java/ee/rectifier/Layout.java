package ee.rectifier;

/**
 * Раскладка выпрямителя: сколько входов и где клеммы. Номера контактов: 0…inputs−1 — входы, затем «+», затем «−».
 * Центры клемм {x, z} в пикселях для блока лицом вверх без крена, высота центра — 5. Те же координаты —
 * в art/gen_assets.py (модели), менять вместе; совпадение во всех положениях проверяет art/CheckNodes.java.
 */
public record Layout(String id, int inputs, float[][] terminals, String[] labels) {
    public static final Layout THREE_PHASE = new Layout("three_phase_rectifier", 3,
            new float[][] {{3, 3}, {8, 3}, {13, 3}, {3, 13}, {13, 13}},
            new String[] {"phase_1", "phase_2", "phase_3", "load_positive", "load_negative"});

    /** Однофазный: фаза и нейтраль (для моста они равноправны — можно перепутать), «+» и «−» */
    public static final Layout SINGLE_PHASE = new Layout("single_phase_rectifier", 2,
            new float[][] {{3, 3}, {13, 3}, {3, 13}, {13, 13}},
            new String[] {"phase_1", "neutral", "load_positive", "load_negative"});

    public static final float TERMINAL_Y = 5;

    public int plus() {
        return inputs;
    }

    public int minus() {
        return inputs + 1;
    }

    /** Крен: (x, z) → (16 − z, x) — поворот на 90° вокруг вертикальной оси блока */
    public static float[] roll(float[] t) {
        return new float[] {16 - t[1], t[0]};
    }
}
