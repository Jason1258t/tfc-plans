package ee.extras.cable;

import com.george_vi.electroenergetics.CEEDataComponents;
import com.george_vi.electroenergetics.client.ElectricPropertiesOverlay;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireApplyingBehaviour;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireItem;
import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationState;
import ee.extras.EeExtras;
import net.minecraft.ChatFormatting;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterGuiLayersEvent;
import net.neoforged.neoforge.client.gui.VanillaGuiLayers;

/**
 * Только клиент: катушка кабеля в руке. Подсветку узла кабеля и «пунктир» будущего кабеля в EE 1.1.2 рисует
 * BundledWireApplyingBehaviour.tick, но его никто не вызывает (по байткоду — ни одного вызова) — вызываем сами. Подпись
 * узла кабеля — своя, в том же месте и цветах, что подпись узла у EE (ElectricPropertiesOverlay): у EE она только для
 * открытых узлов, а узел кабеля скрыт, чтобы к нему не цепляли обычный провод.
 */
public final class CableHud {
    /** Цвет заголовка подписи узла у EE */
    private static final int TITLE = 0xFBDE7D;

    public static void register(IEventBus modBus, IEventBus gameBus) {
        modBus.addListener(CableHud::layers);
        gameBus.addListener(CableHud::tick);
    }

    static void layers(RegisterGuiLayersEvent e) {
        e.registerAbove(VanillaGuiLayers.CROSSHAIR, EeExtras.rl("cable_node"), CableHud::render);
    }

    static void tick(ClientTickEvent.Post e) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null || !(mc.player.getMainHandItem().getItem() instanceof BundledWireItem))
            return;
        BundledWireApplyingBehaviour.tick();
        // Подпись узла от прошлого предмета (катушки провода) иначе висела бы поверх своей
        ElectricPropertiesOverlay.INSTANCE.removeHoveredNode();
    }

    static void render(GuiGraphics g, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.options.hideGui || mc.level == null || mc.player == null) return;
        ItemStack stack = mc.player.getMainHandItem();
        if (!(stack.getItem() instanceof BundledWireItem) || !(mc.hitResult instanceof BlockHitResult hit)) return;
        BlockState state = mc.level.getBlockState(hit.getBlockPos());
        CableEnd end = CableEnd.of(hit.getBlockPos(), state);
        if (end == null) return;

        CableKind spool = stack.getItem() instanceof FourCoreSpoolItem ? CableKind.FOUR_CORE : CableKind.DUPLEX;
        boolean fits = CableLaying.fits(spool, end);
        BundledWireTerminationState selected = stack.get(CEEDataComponents.SELECTED_WIRE_TERMINATION);
        MutableComponent title = Component.translatable("ee_extras.nodes.cable").withStyle(ChatFormatting.BOLD);
        MutableComponent line;
        if (!fits) line = Component.translatable("ee_extras.cable." + (spool == CableKind.DUPLEX ? "needs_duplex" : "needs_four_core"));
        else if (selected != null && selected.pos().equals(end.pos())) line = Component.translatable("ee_extras.cable.selected");
        else line = Component.translatable("ee_extras.cable.accepts." + (end.eeTermination() ? "ee" : end.kind() == CableKind.DUPLEX ? "duplex" : "four_core"));

        int x = g.guiWidth() / 2, y = g.guiHeight() / 2 + 33;
        g.drawString(mc.font, title, x - mc.font.width(title) / 2, y, fits ? TITLE : ChatFormatting.RED.getColor());
        g.drawString(mc.font, line, x - mc.font.width(line) / 2, y + 12, fits ? 0xFFFFFF : ChatFormatting.RED.getColor());
    }

    private CableHud() {
    }
}
