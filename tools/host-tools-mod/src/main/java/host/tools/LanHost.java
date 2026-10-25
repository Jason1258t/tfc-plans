package host.tools;

/** Реализует миксин на IntegratedServer: есть только в мире хоста (не на выделенном сервере). */
public interface LanHost {
    /** Сбросить «открыт для сети»: порт −1, остановить LAN-объявление. Соединения закрывает {@link HostService}. */
    void hosttools$unpublish();
}
