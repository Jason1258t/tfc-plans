package ee.extras;

/**
 * Раскладка выпрямителя или инвертора: сколько фаз и где клеммы. Номера контактов: 0…inputs−1 — переменный ток
 * (у выпрямителя — вход, у инвертора — выход), затем «+», затем «−». Центры клемм {x, z} в пикселях для блока лицом
 * вверх без крена, высота центра — Tier.terminalY (у лёгких и тяжёлых раскладка одна). Те же координаты —
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

    /** Инверторы: клеммы там же, где у выпрямителей; переменный ток — медные, постоянный — красная «+» и синяя «−» */
    public static final Layout THREE_PHASE_INVERTER = new Layout("three_phase_inverter", 3,
            THREE_PHASE.terminals, new String[] {"phase_1", "phase_2", "phase_3", "feed_positive", "feed_negative"});

    public static final Layout SINGLE_PHASE_INVERTER = new Layout("single_phase_inverter", 2,
            SINGLE_PHASE.terminals, new String[] {"phase_1", "neutral", "feed_positive", "feed_negative"});

    /**
     * Двусторонний преобразователь: 0 «+» и 1 «−» — заряд (из сети EE в FE), 2 «+» и 3 «−» — разряд (из FE в сеть EE).
     * Не выпрямитель (inputs здесь не нужен), раскладка общая, чтобы клеммы проверял тот же CheckNodes.
     */
    public static final Layout CONVERTER = new Layout("bidirectional_converter", 2,
            new float[][] {{3, 3}, {13, 3}, {3, 13}, {13, 13}},
            new String[] {"charge_positive", "charge_negative", "discharge_positive", "discharge_negative"});

    /**
     * Компактные генераторы (2.3), кинетический и топливный: две клеммы сверху — 0 «+» (красная), 1 «−» (синяя), центр
     * на высоте GENERATOR_Y. Здесь inputs = 0, поэтому plus() = 0, minus() = 1.
     */
    public static final Layout COMPACT_GENERATOR = new Layout("compact_generator", 0,
            new float[][] {{4, 8}, {12, 8}}, new String[] {"load_positive", "load_negative"});
    public static final float GENERATOR_Y = 14.5f;

    /**
     * Четырёхжильный соединитель, {x, y, z} в пикселях лицом вверх: узел 0 — торец вывода кабеля, 1–4 — клеммы L1, L2,
     * L3, N в ряд. Здесь, а не в блоке, чтобы CheckNodes читал без загрузки классов блоков Minecraft.
     */
    public static final float[][] FOUR_CORE_TERMINATION = {
            {8, 2, 13}, {2, 3.5f, 4}, {6, 3.5f, 4}, {10, 3.5f, 4}, {14, 3.5f, 4}};

    /** Отвод фазы (четырёхжильный кабель → фаза и ноль): узел 0 — ввод кабеля, 1 — фаза, 2 — ноль; те же — в art/cables.py */
    public static final float[][] PHASE_TAP = {{8, 2, 13}, {5, 3.5f, 4}, {11, 3.5f, 4}};

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
