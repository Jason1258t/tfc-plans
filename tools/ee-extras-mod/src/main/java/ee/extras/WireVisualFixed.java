package ee.extras;

import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.WireType;
import dev.engine_room.flywheel.api.instance.Instance;
import java.util.List;

/**
 * Метка и доступ для замера: миксин {@code ee.extras.mixin.WireVisualMixin} применился к отрисовке проводов EE. Лежит
 * вне пакета миксинов: на классы из него Mixin запрещает ссылаться напрямую.
 */
public interface WireVisualFixed {
    InWorldNodeConnection eeExtrasConnection();

    WireType eeExtrasWireType();

    /** Отрезки провода, концевой изолятор в начале и в конце (может быть null) */
    List<? extends Instance> eeExtrasSegments();

    Instance eeExtrasStart();

    Instance eeExtrasEnd();

    /** Сколько отрезков создано и ещё не удалено уборкой */
    int eeExtrasCreated();

    /** System.nanoTime() последнего кадра, в котором провод перерисовывался (0 — ни разу) */
    long eeExtrasLastFrame();
}
