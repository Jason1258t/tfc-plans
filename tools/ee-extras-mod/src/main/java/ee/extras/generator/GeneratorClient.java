package ee.extras.generator;

import com.simibubi.create.AllPartialModels;
import com.simibubi.create.content.kinetics.base.KineticBlockEntityRenderer;
import com.simibubi.create.content.kinetics.base.OrientedRotatingVisual;
import dev.engine_room.flywheel.lib.model.Models;
import dev.engine_room.flywheel.lib.visualization.SimpleBlockEntityVisualizer;
import ee.extras.EeExtras;
import net.createmod.catnip.render.CachedBuffers;
import net.createmod.catnip.render.SuperByteBuffer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.Direction;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/**
 * Клиент: вращающийся полувал Create из задней грани компактного генератора — как у творческого мотора Create
 * (CreativeMotorRenderer, OrientedRotatingVisual с SHAFT_HALF), только полувал смотрит назад, а не вперёд.
 */
public final class GeneratorClient {
    private GeneratorClient() {}

    public static void register(IEventBus modBus) {
        modBus.addListener((EntityRenderersEvent.RegisterRenderers e) ->
                e.registerBlockEntityRenderer(EeExtras.KINETIC_GENERATOR_BE.get(), Renderer::new));
        modBus.addListener((FMLClientSetupEvent e) -> e.enqueueWork(() ->
                SimpleBlockEntityVisualizer.builder(EeExtras.KINETIC_GENERATOR_BE.get())
                        .factory((ctx, be, partialTick) -> new OrientedRotatingVisual<>(ctx, be, partialTick,
                                Direction.SOUTH, back(be.getBlockState()), Models.partial(AllPartialModels.SHAFT_HALF)))
                        .apply()));
    }

    static Direction back(BlockState state) {
        return state.getValue(KineticGeneratorBlock.FACING).getOpposite();
    }

    static class Renderer extends KineticBlockEntityRenderer<KineticGeneratorBlockEntity> {
        Renderer(BlockEntityRendererProvider.Context context) {
            super(context);
        }

        @Override
        protected SuperByteBuffer getRotatedModel(KineticGeneratorBlockEntity be, BlockState state) {
            return CachedBuffers.partialFacing(AllPartialModels.SHAFT_HALF, state, back(state));
        }
    }
}
