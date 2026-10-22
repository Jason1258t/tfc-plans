package ee.extras;

import com.george_vi.electroenergetics.client.ClientNodeData;
import com.george_vi.electroenergetics.client.WireRenderer;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.simulation.WireType;
import com.george_vi.electroenergetics.simulation.infrastructure.WireData;
import com.mojang.brigadier.Command;
import dev.engine_room.flywheel.api.instance.Instance;
import dev.engine_room.flywheel.api.model.Model;
import dev.engine_room.flywheel.api.visual.Visual;
import dev.engine_room.flywheel.backend.engine.AbstractInstancer;
import dev.engine_room.flywheel.backend.engine.InstanceHandleImpl;
import dev.engine_room.flywheel.backend.engine.InstancerKey;
import dev.engine_room.flywheel.impl.visualization.VisualManagerImpl;
import dev.engine_room.flywheel.impl.visualization.VisualizationManagerImpl;
import dev.engine_room.flywheel.impl.visualization.storage.Storage;
import dev.engine_room.flywheel.lib.model.Models;
import dev.engine_room.flywheel.lib.model.baked.PartialModel;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.Vec3;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;

/**
 * Клиент: команда {@code /eeextras wires} — замер отрисовки проводов EE, когда в мире виден «веер» застывших копий.
 * Сравнивает три слоя: список проводов EE на клиенте ({@code WireRenderer}), отрисовки Flywheel ({@code WireVisual}) и
 * число кусков в самом Flywheel по моделям. Итог — в чат, подробности по каждой гирлянде — в лог.
 */
public final class WireDiag {
    private WireDiag() {}

    public static void register(IEventBus gameBus) {
        gameBus.addListener((RegisterClientCommandsEvent e) -> e.getDispatcher().register(Commands.literal("eeextras")
                .then(Commands.literal("wires").executes(ctx -> {
                    report();
                    return Command.SINGLE_SUCCESS;
                }))));
    }

    private static void say(String text) {
        EeExtras.LOGGER.info("[провода EE] {}", text);
        Minecraft mc = Minecraft.getInstance();
        if (mc.player != null) mc.player.displayClientMessage(Component.literal(text), false);
    }

    private static void log(String text) {
        EeExtras.LOGGER.info("[провода EE] {}", text);
    }

    private static boolean hanging(WireType type) {
        return type != null && type.getModel() != null && type.getModel().modelLocation().getPath().contains("insulator");
    }

    static void report() {
        try {
            reportInner();
        } catch (Throwable t) {
            EeExtras.LOGGER.error("[провода EE] замер упал", t);
            say("Замер упал: " + t + " (подробности в логе)");
        }
    }

    private static void reportInner() throws Exception {
        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;
        if (level == null) return;
        long now = System.nanoTime();

        // 1. Список проводов EE на клиенте
        List<net.createmod.catnip.data.Pair<InWorldNodeConnection, WireData>> connections = WireRenderer.getAllConnections();
        int hangingConnections = 0;
        for (var c : connections) if (hanging(c.getSecond().wireType())) hangingConnections++;
        Field effectsField = WireRenderer.class.getDeclaredField("WIRE_EFFECTS");
        effectsField.setAccessible(true);
        Map<?, ?> wireEffects = (Map<?, ?>) effectsField.get(null);
        Set<Object> currentEffects = Collections.newSetFromMap(new IdentityHashMap<>());
        currentEffects.addAll(wireEffects.values());
        say("Провода EE на клиенте: " + connections.size() + " (гирлянд " + hangingConnections + "), эффектов "
                + wireEffects.size() + ", подвесных узлов " + WireRenderer.NODE_DATA.size());

        // 2. Отрисовки Flywheel
        VisualizationManagerImpl manager = VisualizationManagerImpl.get(level);
        if (manager == null) {
            say("Flywheel для этого мира не работает — провода рисуются без него, веера быть не должно");
            return;
        }
        Storage<?> storage = ((VisualManagerImpl<?, ?>) manager.effects()).getStorage();
        Field visualsField = Storage.class.getDeclaredField("visuals");
        visualsField.setAccessible(true);
        Map<?, ?> visuals = (Map<?, ?>) visualsField.get(storage);

        int wireVisuals = 0, orphanVisuals = 0, frozen = 0, hangingVisuals = 0, pendingSweep = 0;
        Map<Model, Integer> expected = new IdentityHashMap<>();
        Map<Model, String> names = new IdentityHashMap<>();
        Map<InWorldNodeConnection, Integer> perConnection = new HashMap<>();
        List<String> details = new ArrayList<>();
        for (Map.Entry<?, ?> e : visuals.entrySet()) {
            Visual visual = (Visual) e.getValue();
            if (!(visual instanceof WireVisualFixed wire)) continue;
            wireVisuals++;
            boolean orphan = !currentEffects.contains(e.getKey());
            if (orphan) orphanVisuals++;
            long last = wire.eeExtrasLastFrame();
            boolean stale = last == 0 || now - last > 2_000_000_000L;
            if (stale) frozen++;
            WireType type = wire.eeExtrasWireType();
            perConnection.merge(wire.eeExtrasConnection(), 1, Integer::sum);
            int visible = 0;
            if (type != null && type.getModel() != null) {
                Model model = Models.partial(type.getModel());
                names.put(model, type.getModel().modelLocation().toString());
                for (Instance i : wire.eeExtrasSegments()) if (shown(i)) visible++;
                expected.merge(model, visible, Integer::sum);
            }
            PartialModel end = type == null ? null : type.getEndPointModel();
            if (end != null) {
                Model model = Models.partial(end);
                names.put(model, end.modelLocation().toString());
                int ends = 0;
                if (wire.eeExtrasStart() != null && shown(wire.eeExtrasStart())) ends++;
                if (wire.eeExtrasEnd() != null && shown(wire.eeExtrasEnd())) ends++;
                expected.merge(model, ends, Integer::sum);
            }
            int live = wire.eeExtrasSegments().size() + 2;
            if (wire.eeExtrasCreated() > live) pendingSweep += wire.eeExtrasCreated() - live;
            if (hanging(type)) {
                hangingVisuals++;
                InWorldNodeConnection c = wire.eeExtrasConnection();
                details.add("гирлянда " + c.node1() + " → " + c.node2() + ": отрезков видно " + visible + " из "
                        + wire.eeExtrasSegments().size() + ", создано " + wire.eeExtrasCreated()
                        + (orphan ? ", ОТРИСОВКА БЕЗ ЭФФЕКТА EE" : "")
                        + (stale ? ", НЕ ОБНОВЛЯЛАСЬ " + (last == 0 ? "ни разу" : (now - last) / 1_000_000 + " мс") : "")
                        + ", концы " + pos(level, c.node1()) + " / " + pos(level, c.node2()));
            }
        }
        int duplicated = 0;
        for (int n : perConnection.values()) if (n > 1) duplicated += n - 1;
        say("Flywheel: отрисовок проводов " + wireVisuals + " (гирлянд " + hangingVisuals + "), без эффекта EE "
                + orphanVisuals + ", лишних на тот же провод " + duplicated + ", не обновлялись больше 2 с " + frozen
                + ", ждут уборки " + pendingSweep);

        // 3. Куски в самом Flywheel против тех, что держат отрисовки
        Map<InstancerKey<?>, ? extends AbstractInstancer<?>> instancers = manager.getEngineImpl().drawManager().instancers();
        Map<Model, Integer> actual = new IdentityHashMap<>();
        for (var e : instancers.entrySet()) {
            Model model = e.getKey().model();
            if (expected.containsKey(model)) actual.merge(model, e.getValue().instanceCount(), Integer::sum);
        }
        List<String> extra = new ArrayList<>();
        for (var e : expected.entrySet()) {
            int has = actual.getOrDefault(e.getKey(), 0);
            String line = names.get(e.getKey()) + ": во Flywheel " + has + ", у отрисовок проводов " + e.getValue();
            log(line);
            if (has > e.getValue()) extra.add(names.get(e.getKey()) + " +" + (has - e.getValue()));
        }
        say(extra.isEmpty() ? "Лишних кусков во Flywheel нет" : "Лишние куски во Flywheel (ничьи): " + String.join(", ", extra));
        for (String d : details) log(d);
        say("Подробности по гирляндам — в logs/latest.log, строки «[провода EE]»");
    }

    /**
     * Кусок сейчас в Flywheel. {@code handle().isVisible()} не годится: у непрямой отрисовки (GL 4.6, видеокарты
     * NVIDIA/AMD) состояние видимого куска — страница, а не AbstractInstancer, и isVisible() всегда false.
     */
    private static boolean shown(Instance instance) {
        if (!(instance.handle() instanceof InstanceHandleImpl<?> handle)) return instance.handle().isVisible();
        return !(handle.state instanceof InstanceHandleImpl.Hidden<?>) && !(handle.state instanceof InstanceHandleImpl.Deleted<?>);
    }

    private static String pos(ClientLevel level, InWorldNode node) {
        Vec3 p = node.getPosition(level);
        ClientNodeData data = WireRenderer.getNodeData(node);
        String at = p == null ? "нет позиции" : String.format("%.1f %.1f %.1f", p.x, p.y, p.z);
        return data == null ? at : at + " (подвесной)";
    }
}
