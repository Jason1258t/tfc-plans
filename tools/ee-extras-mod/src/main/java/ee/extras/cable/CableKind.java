package ee.extras.cable;

/**
 * Вид кабеля: сколько жил. Двухжильный — катушка двухпроводного кабеля EE (фаза и ноль), четырёхжильный — свой
 * (L1, L2, L3 и N). Жилы нумеруются с 1, как контакты соединителей; у четырёхжильного N — жила 4.
 */
public enum CableKind {
    DUPLEX(2),
    FOUR_CORE(4);

    public static final int NEUTRAL = 4;

    public final int conductors;

    CableKind(int conductors) {
        this.conductors = conductors;
    }
}
