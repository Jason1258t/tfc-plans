package ee.extras.lantern;

import com.george_vi.electroenergetics.content.bundled_wire.BundledWireTerminationBlock;
import ee.extras.EeExtras;
import ee.extras.TooltipBlockItem;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.entity.player.ItemTooltipEvent;

/**
 * Фонарь IE → фонарь в сети EE: клик катушкой двухпроводного кабеля EE по электрическому фонарю IE ставит на его место
 * LanternBlock (то же положение), и клик сразу же идёт в прокладку кабеля (CableEvents). Отдельного предмета нет:
 * сломанный фонарь — снова фонарь IE. Фонарь с проводами IE не превращается (они бы оборвались) — просим снять.
 * Классы IE трогает только IeWires — его зовут, когда фонарь IE уже стоит в мире (значит, IE загружен).
 */
public final class LanternConversion {
    public static final ResourceLocation IE_LANTERN = ResourceLocation.fromNamespaceAndPath("immersiveengineering", "electric_lantern");

    public static boolean isIeLantern(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()).equals(IE_LANTERN);
    }

    public static ItemStack ieLantern() {
        return new ItemStack(BuiltInRegistries.ITEM.get(IE_LANTERN));
    }

    /** null — фонарь заменён, прокладка продолжается; иначе — итог клика (на клиенте — успех, ждём сервер) */
    public static InteractionResult convert(Level level, BlockPos pos, Player player) {
        if (!(level instanceof ServerLevel sl)) return InteractionResult.SUCCESS;
        BlockState old = level.getBlockState(pos);
        if (IeWires.connected(sl, pos)) {
            player.displayClientMessage(Component.translatable("ee_extras.lantern.ie_wired"), true);
            return InteractionResult.FAIL;
        }
        // У IE facing=down — стоит основанием вниз (провод снизу), up — висит
        Direction facing = ieFacing(old) == Direction.UP ? Direction.DOWN : Direction.UP;
        BlockState state = EeExtras.LANTERN.get().defaultBlockState().setValue(BundledWireTerminationBlock.FACING, facing);
        level.setBlock(pos, state, Block.UPDATE_ALL);
        return null;
    }

    static Direction ieFacing(BlockState state) {
        for (Property<?> p : state.getProperties())
            if (p.getName().equals("facing") && state.getValue(p) instanceof Direction d) return d;
        return Direction.DOWN;
    }

    /** Подсказка у фонаря IE: его можно подключить к кабелю EE */
    public static void registerTooltip(IEventBus bus) {
        bus.addListener((ItemTooltipEvent e) -> {
            if (BuiltInRegistries.ITEM.getKey(e.getItemStack().getItem()).equals(IE_LANTERN))
                TooltipBlockItem.tooltip("block.ee_extras.electric_lantern", e.getToolTip());
        });
    }

    private LanternConversion() {
    }
}
