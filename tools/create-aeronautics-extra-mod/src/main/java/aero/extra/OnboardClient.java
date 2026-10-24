package aero.extra;

import com.simibubi.create.AllPartialModels;
import com.simibubi.create.content.kinetics.base.KineticBlockEntityRenderer;
import com.simibubi.create.content.kinetics.base.OrientedRotatingVisual;
import dev.engine_room.flywheel.lib.model.Models;
import dev.engine_room.flywheel.lib.visualization.SimpleBlockEntityVisualizer;
import net.createmod.catnip.render.CachedBuffers;
import net.createmod.catnip.render.SuperByteBuffer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/**
 * Клиент: вращающийся полувал Create из задней грани — как у компактного генератора EE Extras (OrientedRotatingVisual
 * с SHAFT_HALF, развёрнутым назад).
 */
final class OnboardClient {
    private OnboardClient() {}

    static void register(IEventBus modBus) {
        modBus.addListener((EntityRenderersEvent.RegisterRenderers e) ->
                e.registerBlockEntityRenderer(AeroExtra.ONBOARD_COMPUTER_BE.get(), Renderer::new));
        modBus.addListener((FMLClientSetupEvent e) -> e.enqueueWork(() ->
                SimpleBlockEntityVisualizer.builder(AeroExtra.ONBOARD_COMPUTER_BE.get())
                        .factory((ctx, be, partialTick) -> new OrientedRotatingVisual<>(ctx, be, partialTick,
                                Direction.SOUTH, back(be.getBlockState()), Models.partial(AllPartialModels.SHAFT_HALF)))
                        .apply()));
    }

    static Direction back(BlockState state) {
        return state.getValue(OnboardComputerBlock.FACING).getOpposite();
    }

    static class Renderer extends KineticBlockEntityRenderer<OnboardComputerBlockEntity> {
        Renderer(BlockEntityRendererProvider.Context context) {
            super(context);
        }

        @Override
        protected SuperByteBuffer getRotatedModel(OnboardComputerBlockEntity be, BlockState state) {
            return CachedBuffers.partialFacing(AllPartialModels.SHAFT_HALF, state, back(state));
        }
    }
}
