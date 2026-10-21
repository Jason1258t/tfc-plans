package ee.extras.lines;

import com.george_vi.electroenergetics.CEERegistries;
import com.george_vi.electroenergetics.CEEWireTypes;
import com.george_vi.electroenergetics.content.wire.WireAttachment;
import com.george_vi.electroenergetics.content.wire.WireAttachmentType;
import com.george_vi.electroenergetics.content.wire.interaction.WireInteractionBehaviour;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNode;
import com.george_vi.electroenergetics.foundation.nodes.InWorldNodeConnection;
import com.george_vi.electroenergetics.foundation.nodes.NodeConnectionPoint;
import com.george_vi.electroenergetics.simulation.WireType;
import com.george_vi.electroenergetics.simulation.infrastructure.InfrastructureSavedData;
import com.george_vi.electroenergetics.simulation.infrastructure.WireData;
import com.mojang.blaze3d.vertex.PoseStack;
import com.simibubi.create.AllSoundEvents;
import dev.engine_room.flywheel.lib.model.baked.PartialModel;
import ee.extras.EeExtras;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import net.createmod.catnip.data.Pair;
import net.createmod.catnip.render.CachedBuffers;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Натяжка проводов — меньше провис на длинных пролётах. В EE провис середины = 0,05 · sag · пролёт · f,
 * f = clamp(длина провода − пролёт + 1, 0,2, 30) (WireData.getSag): провод, повешенный как есть, имеет длину, равную
 * пролёту (f = 1), натянутый — короче (длина = пролёт − (1 − f), f до 0,2). EE даёт менять длину любого провода (провод в руке, Alt + колесо),
 * без оглядки на материал.
 *
 * Здесь, как в жизни: натянуть провод ЛЭП можно только натяжным зажимом, и не сильнее, чем позволяет материал
 * (LineWire.minFactor: сталь и АС — сильно, медь и алюминий — слабее). Зажим — навесная деталь EE у ближнего к клику
 * конца провода; клик зажимом по проводу ставит его и натягивает провод до предела. Без зажима провод ЛЭП не бывает
 * короче пролёта, с зажимом — короче предела: это раз в 2 секунды выправляет check (после Alt + колеса EE, после снятия
 * зажима). Заодно не даёт укоротить провод ради меньшего сопротивления (оно — R · длина).
 *
 * Провода EE этим не затронуты, кроме железного: ему провис 1 → 0,6 (железо прочнее меди) и тоже можно ставить зажим.
 */
public final class Tension {
    static final DeferredRegister<WireAttachmentType> ATTACHMENTS =
            DeferredRegister.create(CEERegistries.WIRE_ATTACHMENT_TYPE, EeExtras.MOD_ID);
    static final DeferredRegister<WireInteractionBehaviour> BEHAVIOURS =
            DeferredRegister.create(CEERegistries.WIRE_INTERACTION_BEHAVIOUR, EeExtras.MOD_ID);

    public static final PartialModel CLAMP_MODEL = PartialModel.of(EeExtras.rl("block/line/tension_clamp"));
    public static final DeferredHolder<WireAttachmentType, WireAttachmentType> CLAMP =
            ATTACHMENTS.register("tension_clamp", ClampAttachment::new);
    public static final DeferredHolder<WireInteractionBehaviour, WireInteractionBehaviour> CLAMP_BEHAVIOUR =
            BEHAVIOURS.register("tension_clamp", ClampBehaviour::new);
    public static DeferredItem<Item> CLAMP_ITEM;

    /** Провис железного провода EE после правки (был 1, как у меди) и его предел натяжки зажимом */
    static final float IRON_SAG = 0.6f;
    static final float IRON_MIN_FACTOR = 0.3f;
    public static final int CHECK_TICKS = 40;
    /** Зажим — на этом расстоянии от конца провода, блоков */
    static final double CLAMP_FROM_END = 0.7;

    public static void register(IEventBus modBus) {
        CLAMP_ITEM = EeExtras.ITEMS.register("tension_clamp", () -> new Item(new Item.Properties()));
        ATTACHMENTS.register(modBus);
        BEHAVIOURS.register(modBus);
    }

    /** Предел натяжки (f) для типа провода; NaN — зажим на него не ставится */
    public static float minFactor(WireType t) {
        LineWire w = LineWire.of(t);
        if (w != null) return w.minFactor < 1 ? w.minFactor : Float.NaN;
        return t == CEEWireTypes.IRON.get() ? IRON_MIN_FACTOR : Float.NaN;
    }

    public static boolean hasClamp(WireData data) {
        for (Pair<Float, WireAttachment> a : data.attachments()) if (a.getSecond().type == CLAMP.get()) return true;
        return false;
    }

    /** Самая короткая допустимая длина провода: без зажима — пролёт, с зажимом — пролёт − (1 − f) */
    public static double minLength(WireData data, double distance) {
        float f = minFactor(data.wireType());
        return hasClamp(data) && !Float.isNaN(f) ? distance - (1 - f) : distance;
    }

    /**
     * Провис железного провода EE: поле sag у WireType — final без сеттера, правим отражением один раз при запуске
     * (FMLCommonSetupEvent). Не вышло (EE изменил класс) — останется провис EE, остальное работает.
     */
    public static void tuneIronSag() {
        try {
            Field f = WireType.class.getDeclaredField("sag");
            f.setAccessible(true);
            f.setFloat(CEEWireTypes.IRON.get(), IRON_SAG);
        } catch (ReflectiveOperationException | RuntimeException e) {
            EeExtras.LOGGER.warn("Не удалось уменьшить провис железного провода EE: {}", e.toString());
        }
    }

    /** Раз в CHECK_TICKS: провода ЛЭП не короче допустимого (после Alt + колеса EE и снятия зажима) */
    public static void check(ServerLevel level) {
        InfrastructureSavedData sd = InfrastructureSavedData.load(level);
        Set<InWorldNodeConnection> seen = new HashSet<>();
        List<Pair<InWorldNodeConnection, WireData>> fix = new ArrayList<>();
        for (InWorldNode node : new ArrayList<>(sd.getNodes())) {
            for (InWorldNodeConnection c : sd.getConnections(node)) {
                if (!seen.add(c)) continue;
                WireData data = sd.getConnectionData(c);
                if (data == null || LineWire.of(data.wireType()) == null) continue;
                Vec3 a = sd.getNodePosition(c.node1()), b = sd.getNodePosition(c.node2());
                if (a == null || b == null) continue;
                double min = minLength(data, a.distanceTo(b));
                if (data.length < min - 1e-3)
                    fix.add(Pair.of(c, new WireData(data.wireType(), data.temperature(), data.attachments(), min)));
            }
        }
        for (Pair<InWorldNodeConnection, WireData> p : fix) sd.setConnectionData(p.getFirst(), p.getSecond());
    }

    /** Клик натяжным зажимом по проводу: зажим у ближнего конца, провод натягивается до предела материала */
    static class ClampBehaviour extends WireInteractionBehaviour {
        @Override
        public boolean isActiveFor(ItemStack stack, Player player) {
            return CLAMP_ITEM != null && stack.is(CLAMP_ITEM.get());
        }

        @Override
        @OnlyIn(Dist.CLIENT)
        public int getWireDisplayColor(NodeConnectionPoint point, Level level, Player player, ItemStack stack) {
            return attachmentColor();
        }

        @Override
        public void interactWire(NodeConnectionPoint point, Level level, Player player, ItemStack stack) {
            if (!(level instanceof ServerLevel sl)) return;
            InfrastructureSavedData sd = InfrastructureSavedData.load(sl);
            InWorldNodeConnection c = point.connection();
            WireData data = sd.getConnectionData(c);
            if (data == null) return;
            if (Float.isNaN(minFactor(data.wireType()))) {
                player.displayClientMessage(Component.translatable("ee_extras.tension.not_tensionable"), true);
                return;
            }
            if (hasClamp(data)) {
                player.displayClientMessage(Component.translatable("ee_extras.tension.already"), true);
                return;
            }
            Vec3 a = sd.getNodePosition(c.node1()), b = sd.getNodePosition(c.node2());
            if (a == null || b == null) return;
            double d = a.distanceTo(b);
            float at = (float) (point.point() < 0.5 ? Math.min(0.5, CLAMP_FROM_END / d) : Math.max(0.5, 1 - CLAMP_FROM_END / d));
            List<Pair<Float, WireAttachment>> list = new ArrayList<>(data.attachments());
            list.add(Pair.of(at, new WireAttachment(CLAMP.get())));
            WireData tight = new WireData(data.wireType(), data.temperature(), list, 0);
            tight.length = minLength(tight, d);
            sd.setConnectionData(c, tight);
            AllSoundEvents.WRENCH_ROTATE.playOnServer(level, BlockPos.containing(a.lerp(b, at)));
            if (!player.isCreative()) stack.shrink(1);
            float f = minFactor(data.wireType());
            player.displayClientMessage(Component.translatable("ee_extras.tension.done", Math.round((1 - f) * 100)), true);
        }
    }

    /** Натяжной зажим на проводе: модель вдоль провода (ось X модели — вдоль провода, как у гасителя EE) */
    static class ClampAttachment extends WireAttachmentType {
        @Override
        public float getWidth(WireAttachment attachment) {
            return 0.6f;
        }

        @Override
        public float getHeight(WireAttachment attachment) {
            return 0.25f;
        }

        @Override
        @OnlyIn(Dist.CLIENT)
        public void render(PoseStack pose, MultiBufferSource buffer, WireAttachment attachment, Vec3 pos, int light, float pitch) {
            CachedBuffers.partial(CLAMP_MODEL, Blocks.ANDESITE.defaultBlockState())
                    .light(light)
                    .rotateZDegrees(-pitch + 180.0F)
                    .renderInto(pose, buffer.getBuffer(RenderType.solid()));
        }

        @Override
        public List<ItemStack> getDrops(WireAttachment attachment, Level level) {
            return List.of(new ItemStack(CLAMP_ITEM.get()));
        }

        @Override
        public List<ItemStack> getItemRequirements(WireAttachment attachment) {
            return List.of(new ItemStack(CLAMP_ITEM.get()));
        }
    }

    private Tension() {
    }
}
