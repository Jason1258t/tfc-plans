package tp.trace;

import com.mojang.logging.LogUtils;
import java.util.ArrayList;
import java.util.List;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;

/**
 * Временный диагностический аддон: пишет в лог каждый скачок позиции игрока больше чем на 4 блока (на сервере и в
 * игре), телепорты, которые сервер отправляет игре, и подтверждения от игры — с тем, кто их вызвал (стек вызовов).
 * Строки в логе начинаются с «[tp-trace]». Искали, кто в аду возвращает игрока в точку прибытия (2026-10-21).
 */
@Mod("tp_trace")
public final class TpTrace {
    public static final Logger LOGGER = LogUtils.getLogger();
    private static final int MAX_PER_SECOND = 10;
    private static final int MAX_FRAMES = 18;
    private static long second;
    private static int count;

    public TpTrace() {
        LOGGER.info("[tp-trace] включён: скачки игроков > 4 блоков, телепорты сервера и подтверждения пишутся в лог");
    }

    /** Строка лога со стеком вызовов (без кадров самого аддона и JDK); не больше MAX_PER_SECOND строк в секунду */
    public static synchronized void trace(String message, boolean withStack) {
        long now = System.currentTimeMillis() / 1000;
        if (now != second) {
            if (count > MAX_PER_SECOND) LOGGER.warn("[tp-trace] пропущено строк: {}", count - MAX_PER_SECOND);
            second = now;
            count = 0;
        }
        if (++count > MAX_PER_SECOND) return;
        if (!withStack) {
            LOGGER.warn("[tp-trace] [{}] {}", Thread.currentThread().getName(), message);
            return;
        }
        List<String> frames = new ArrayList<>();
        for (StackTraceElement e : new Throwable().getStackTrace()) {
            String c = e.getClassName();
            if (c.startsWith("tp.trace.") || c.startsWith("java.") || c.startsWith("jdk.")) continue;
            frames.add("    at " + c + "." + e.getMethodName() + ":" + e.getLineNumber());
            if (frames.size() >= MAX_FRAMES) break;
        }
        LOGGER.warn("[tp-trace] [{}] {}\n{}", Thread.currentThread().getName(), message, String.join("\n", frames));
    }

    public static String pos(double x, double y, double z) {
        return String.format("%.1f %.1f %.1f", x, y, z);
    }
}
