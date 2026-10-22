package ee.extras;

/**
 * Ступень мощности выпрямителя или инвертора. Лёгкий — плита 16×7 (как преобразователь EE), тяжёлый — целый блок с
 * рёбрами-радиаторами и проходными изоляторами сверху. Высота клемм — центр медной шапки; те же числа — в
 * art/gen_assets.py (модели), совпадение с точками проводов проверяет art/CheckNodes.java.
 */
public enum Tier {
    LIGHT("", 6_000, 5),
    HEAVY("heavy_", 48_000, 14);

    /** Приставка к id блока: three_phase_rectifier → heavy_three_phase_rectifier */
    public final String prefix;
    /** Номинальная мощность, Вт: до неё блок не греется до дыма (в масле — запас ещё в полтора раза) */
    public final double watts;
    public final float terminalY;

    Tier(String prefix, double watts, float terminalY) {
        this.prefix = prefix;
        this.watts = watts;
        this.terminalY = terminalY;
    }
}
