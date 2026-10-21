package ee.extras;

import com.george_vi.electroenergetics.client.WireVisual;

/** Клиент: пишет в лог, применилось ли исправление отрисовки проводов EE (миксины аддона необязательные и молчат) */
public final class WireFixCheck {
    private WireFixCheck() {}

    public static void log() {
        if (WireVisualFixed.class.isAssignableFrom(WireVisual.class))
            EeExtras.LOGGER.info("EE Extras: исправление отрисовки проводов EE применено (WireVisualMixin)");
        else
            EeExtras.LOGGER.warn("EE Extras: исправление отрисовки проводов EE НЕ применено — гирлянды изоляторов могут оставлять веер");
    }
}
