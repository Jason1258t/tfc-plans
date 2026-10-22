package small.diesel;

import com.simibubi.create.AllPartialModels;
import com.simibubi.create.content.kinetics.base.KineticBlockEntityRenderer;
import com.simibubi.create.content.kinetics.base.OrientedRotatingVisual;
import dev.engine_room.flywheel.lib.visualization.SimpleBlockEntityVisualizer;
import net.createmod.catnip.render.CachedBuffers;
import net.createmod.catnip.render.SuperByteBuffer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/** Клиент: вращающийся полувал из лицевой грани двигателя — как у творческого мотора Create (SHAFT_HALF) */
final class EngineClient {
    private EngineClient() {}

    static void register(IEventBus modBus) {
        modBus.addListener((EntityRenderersEvent.RegisterRenderers e) ->
                e.registerBlockEntityRenderer(SmallDiesel.ENGINE_BE.get(), Renderer::new));
        modBus.addListener((FMLClientSetupEvent e) -> e.enqueueWork(() ->
                SimpleBlockEntityVisualizer.builder(SmallDiesel.ENGINE_BE.get())
                        .factory(OrientedRotatingVisual.of(AllPartialModels.SHAFT_HALF))
                        .apply()));
    }

    static class Renderer extends KineticBlockEntityRenderer<EngineBlockEntity> {
        Renderer(BlockEntityRendererProvider.Context context) {
            super(context);
        }

        @Override
        protected SuperByteBuffer getRotatedModel(EngineBlockEntity be, BlockState state) {
            return CachedBuffers.partialFacing(AllPartialModels.SHAFT_HALF, state);
        }
    }
}
