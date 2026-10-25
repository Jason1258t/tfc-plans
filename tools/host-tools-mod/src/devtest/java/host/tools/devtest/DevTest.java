package host.tools.devtest;

import host.tools.HostConfig;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.function.BooleanSupplier;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.ShareToLanScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientChatReceivedEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

/**
 * Клиент разработки сам создаёт плоский мир и проверяет аддон: /host (порт занят → понятная ошибка; свободен → открыт,
 * отвечает на запрос списка серверов), /host random с занятыми портами (прогресс, итог), /host stop (порт закрыт,
 * незашедшее соединение оборвано), кнопка «Закрыть для сети» в меню паузы, порт в окне «Открыть для сети», /ping,
 * таб с цифрами (скриншоты в run/screenshots). Итог — строки «HTTEST» в логе, затем выход.
 */
@Mod(value = "host_tools_devtest", dist = Dist.CLIENT)
public final class DevTest {
    private static final String P = "HTTEST ";
    private final Deque<Step> steps = new ArrayDeque<>();
    private final List<String> chat = new ArrayList<>();
    private final List<ServerSocket> blockers = new ArrayList<>();
    private Socket pendingLogin;
    private boolean started;
    private int wait;
    private int fails;
    private boolean renderTab;

    private record Step(int delay, String name, Runnable run) {}

    public DevTest() {
        NeoForge.EVENT_BUS.addListener(this::onScreen);
        NeoForge.EVENT_BUS.addListener(this::onTick);
        NeoForge.EVENT_BUS.addListener(this::onChat);
        NeoForge.EVENT_BUS.addListener(this::onRender);
        plan();
    }

    private Minecraft mc() { return Minecraft.getInstance(); }
    private IntegratedServer server() { return mc().getSingleplayerServer(); }

    private void step(int delay, String name, Runnable run) { steps.add(new Step(delay, name, run)); }

    private void check(String what, boolean ok) {
        if (!ok) fails++;
        System.out.println(P + (ok ? "ok   " : "FAIL ") + what);
    }

    private void cmd(String c) {
        chat.clear();
        System.out.println(P + "> /" + c);
        mc().player.connection.sendCommand(c);
    }

    private boolean chatHas(String s) { return chat.stream().anyMatch(m -> m.contains(s)); }

    private void plan() {
        step(60, "старт", () -> check("мир загружен, хост в мире", server() != null && mc().player != null));
        // 1. порт по умолчанию занят другой программой
        step(1, "занять 57016", () -> blockers.add(bind(57016)));
        step(1, "/host при занятом", () -> cmd("host"));
        step(20, "итог занятого", () -> {
            check("занятый 57016: мир не открыт", !server().isPublished());
            check("занятый 57016: сообщение «не открылся»", chatHas("57016 не открылся"));
            freeBlockers();
        });
        // 2. открыть на 57016 — сразу после команды пауза (сервер не тикает)
        step(1, "/host", () -> {
            cmd("host");
            mc().setScreen(new PauseScreen(true));
        });
        step(20, "итог /host", () -> {
            check("/host: открыт на 57016", server().isPublished() && server().getPort() == 57016);
            check("/host: сообщение с портом", chatHas("на порте [57016]"));
            String motd = statusPing(57016);
            check("порт 57016 отвечает на запрос списка серверов: " + motd, motd != null && motd.contains("version"));
            mc().setScreen(null);
        });
        step(1, "/host повторно", () -> cmd("host"));
        step(10, "итог повтора", () -> check("повторный /host: «уже открыт»", chatHas("уже открыт")));
        step(1, "/host status", () -> cmd("host status"));
        step(10, "итог status", () -> check("/host status: порт 57016", chatHas("57016")));
        // 3. пинг: себе (хосту) ставим 123 мс в клиентском списке — у хоста настоящий пинг 0 и цифра не рисуется
        step(1, "/ping", () -> cmd("ping"));
        step(10, "итог /ping", () -> check("/ping: строка про хоста", chatHas("хост")));
        step(1, "таб", () -> {
            setLatency(123);
            renderTab = true;
        });
        step(10, "скриншот таба", () -> shot("tab"));
        step(1, "таб: 1500 мс", () -> setLatency(1500));
        step(10, "скриншот таба 2", () -> {
            shot("tab-red");
            renderTab = false;
            setLatency(0);
        });
        // 4. /host stop при незашедшем соединении
        step(1, "незашедший гость", () -> pendingLogin = loginHandshake(57016));
        step(5, "/host stop", () -> cmd("host stop"));
        step(20, "итог stop", () -> {
            check("/host stop: мир не открыт", !server().isPublished());
            check("/host stop: сообщение", chatHas("закрыт для сети"));
            check("/host stop: порт 57016 закрыт", !canConnect(57016));
            check("/host stop: незашедший гость отключён", isClosed(pendingLogin));
        });
        step(1, "/host stop повторно", () -> cmd("host stop"));
        step(10, "итог stop 2", () -> check("повторный stop: «не открыт»", chatHas("не открыт")));
        // 5. random: из 5 портов заняты 4
        step(1, "random с занятыми", () -> {
            HostConfig.RANDOM_FROM.set(30000);
            HostConfig.RANDOM_TO.set(30004);
            for (int p = 30000; p < 30004; p++) blockers.add(bind(p));
            cmd("host random");
        });
        step(30, "итог random", () -> {
            check("random: открыт на 30004 — " + server().getPort(), server().isPublished() && server().getPort() == 30004);
            check("random: сообщение с портом", chatHas("порте [30004]"));
            check("random: доступен", statusPing(30004) != null);
            freeBlockers();
        });
        // 6. кнопка в меню паузы
        step(1, "меню паузы", () -> mc().setScreen(new PauseScreen(true)));
        step(10, "кнопка", () -> {
            shot("pause-published");
            Button b = findButton("Закрыть для сети");
            check("меню паузы: кнопка «Закрыть для сети»", b != null);
            if (b != null) b.onPress();
        });
        step(20, "итог кнопки", () -> {
            check("кнопка: мир не открыт", !server().isPublished());
            check("кнопка: порт 30004 закрыт", !canConnect(30004));
            check("кнопка: меню снова с «Открыть для сети»", findButton("Открыть для сети") != null);
            shot("pause-closed");
        });
        // 7. окно «Открыть для сети» — порт из настроек
        step(1, "окно LAN", () -> mc().setScreen(new ShareToLanScreen(new PauseScreen(true))));
        step(10, "порт в окне", () -> {
            shot("share-to-lan");
            String value = mc().screen.children().stream().filter(EditBox.class::isInstance)
                    .map(e -> ((EditBox) e).getValue()).findFirst().orElse("");
            check("окно «Открыть для сети»: порт 57016 — " + value, value.equals("57016"));
            mc().setScreen(null);
        });
        // 8. снова открыть после закрытия; random без занятых
        step(1, "/host 41234", () -> cmd("host 41234"));
        step(20, "итог 41234", () -> check("/host 41234 после закрытий", server().isPublished() && server().getPort() == 41234));
        step(1, "конец", () -> {
            System.out.println(P + "итог: " + (fails == 0 ? "всё ок" : "ошибок " + fails));
            mc().stop();
        });
    }

    private void onScreen(ScreenEvent.Init.Post e) {
        if (started || !(e.getScreen() instanceof TitleScreen)) return;
        started = true;
        Minecraft mc = mc();
        mc.options.pauseOnLostFocus = false; // окно проверки может быть не в фокусе; паузу проверяет отдельный шаг
        LevelSettings settings = new LevelSettings("httest", GameType.CREATIVE, false, Difficulty.PEACEFUL, true,
                new GameRules(), WorldDataConfiguration.DEFAULT);
        mc.createWorldOpenFlows().createFreshLevel("httest", settings, new WorldOptions(1, false, false),
                reg -> reg.registryOrThrow(Registries.WORLD_PRESET).getHolderOrThrow(WorldPresets.FLAT).value()
                        .createWorldDimensions(), e.getScreen());
    }

    private void onTick(ClientTickEvent.Post e) {
        if (mc().player == null || server() == null || steps.isEmpty()) return;
        if (wait > 0) { wait--; return; }
        Step s = steps.peek();
        if (s.delay > 0) { wait = s.delay; steps.poll(); steps.addFirst(new Step(0, s.name, s.run)); return; }
        steps.poll();
        try { s.run.run(); } catch (Exception ex) { check(s.name + ": " + ex, false); }
    }

    private void onChat(ClientChatReceivedEvent e) {
        String text = e.getMessage().getString();
        chat.add(text);
        System.out.println(P + "чат" + (e.isSystem() ? "" : "*") + ": " + text.replace('\n', '|'));
    }

    private void onRender(RenderGuiEvent.Post e) {
        if (!renderTab || mc().level == null) return;
        var tab = mc().gui.getTabList();
        tab.setVisible(true);
        tab.render(e.getGuiGraphics(), e.getGuiGraphics().guiWidth(), mc().level.getScoreboard(), null);
    }

    private void setLatency(int ms) {
        try {
            PlayerInfo info = mc().getConnection().getPlayerInfo(mc().player.getUUID());
            Method m = PlayerInfo.class.getDeclaredMethod("setLatency", int.class);
            m.setAccessible(true);
            m.invoke(info, ms);
        } catch (ReflectiveOperationException ex) {
            check("setLatency: " + ex, false);
        }
    }

    private void shot(String name) {
        Screenshot.grab(mc().gameDirectory, "httest-" + name + ".png", mc().getMainRenderTarget(),
                c -> System.out.println(P + "скриншот " + name + ": " + c.getString()));
    }

    private Button findButton(String label) {
        if (mc().screen == null) return null;
        return mc().screen.children().stream().filter(Button.class::isInstance).map(Button.class::cast)
                .filter(b -> b.getMessage().getString().equals(label)).findFirst().orElse(null);
    }

    private ServerSocket bind(int port) {
        try {
            return new ServerSocket(port);
        } catch (IOException ex) {
            throw new RuntimeException("не занять " + port, ex);
        }
    }

    private void freeBlockers() {
        for (ServerSocket s : blockers) try { s.close(); } catch (IOException ignored) {}
        blockers.clear();
    }

    private static boolean canConnect(int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", port), 500);
            return true;
        } catch (IOException ex) {
            return false;
        }
    }

    /** Запрос списка серверов (handshake next=1 + status request), как делает меню «Сетевая игра». */
    private static String statusPing(int port) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", port), 1000);
            s.setSoTimeout(3000);
            OutputStream out = s.getOutputStream();
            out.write(packet(handshake(port, 1)));
            out.write(packet(new byte[] {0x00}));
            DataInputStream in = new DataInputStream(s.getInputStream());
            readVarInt(in);
            readVarInt(in); // id 0
            byte[] json = new byte[readVarInt(in)];
            in.readFully(json);
            return new String(json, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return null;
        }
    }

    /** Гость, который начал вход и висит (handshake next=2 без login start). */
    private static Socket loginHandshake(int port) {
        try {
            Socket s = new Socket();
            s.connect(new InetSocketAddress("127.0.0.1", port), 1000);
            s.getOutputStream().write(packet(handshake(port, 2)));
            s.getOutputStream().flush();
            return s;
        } catch (IOException ex) {
            throw new RuntimeException(ex);
        }
    }

    private static boolean isClosed(Socket s) {
        try {
            s.setSoTimeout(2000);
            InputStream in = s.getInputStream();
            while (true) if (in.read() < 0) return true;
        } catch (IOException ex) {
            return ex.getMessage() != null && !ex.getMessage().contains("timed out");
        }
    }

    private static byte[] handshake(int port, int next) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.write(0x00);
        writeVarInt(b, 767); // 1.21.1
        byte[] host = "127.0.0.1".getBytes(StandardCharsets.UTF_8);
        writeVarInt(b, host.length);
        b.writeBytes(host);
        b.write((port >> 8) & 0xFF);
        b.write(port & 0xFF);
        writeVarInt(b, next);
        return b.toByteArray();
    }

    private static byte[] packet(byte[] body) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        writeVarInt(b, body.length);
        b.writeBytes(body);
        return b.toByteArray();
    }

    private static void writeVarInt(ByteArrayOutputStream b, int v) {
        while ((v & ~0x7F) != 0) { b.write((v & 0x7F) | 0x80); v >>>= 7; }
        b.write(v);
    }

    private static int readVarInt(DataInputStream in) throws IOException {
        int v = 0, i = 0, k;
        do { k = in.readByte(); v |= (k & 0x7F) << (7 * i++); } while ((k & 0x80) != 0);
        return v;
    }
}
