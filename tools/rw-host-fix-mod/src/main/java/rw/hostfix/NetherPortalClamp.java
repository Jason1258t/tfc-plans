package rw.hostfix;

import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.TickTask;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.PortalProcessor;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Portal;
import net.minecraft.world.level.dimension.DimensionType;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.neoforge.event.entity.EntityTravelToDimensionEvent;
import net.yazloysasha.tfcrealworld.config.TFCRealWorldConfig;

/**
 * Выход из ада через портал за край карты: вместо него — ближайшая точка у края карты (запас MARGIN блоков).
 * Замена скрипта KubeJS eratosthenes_portal_clamp.js из чужой сборки: у того граница была ±19 500 под мир
 * 40 000 блоков (наша карта — x ±100 000, z ±50 000), а перенос командой /tp снова запускал тот же переход
 * и скрипт вызывал сам себя. Здесь — только портал ада (команды и другие измерения не трогаем), граница —
 * из настроек TFC Real World, перенос — следующим заданием сервера, вне обработки текущего перехода.
 */
final class NetherPortalClamp {
    private static final int MARGIN = 1000;
    private static boolean teleporting;

    private NetherPortalClamp() {
    }

    static void onTravel(EntityTravelToDimensionEvent event) {
        if (teleporting || !(event.getEntity() instanceof ServerPlayer player)) return;
        if (event.getDimension() != Level.OVERWORLD || player.level().dimension() != Level.NETHER) return;
        PortalProcessor portal = player.portalProcess;
        if (portal == null || !portal.isSamePortal((Portal) Blocks.NETHER_PORTAL)) return;

        MinecraftServer server = player.server;
        ServerLevel overworld = server.getLevel(Level.OVERWORLD);
        if (overworld == null) return;
        double scale = DimensionType.getTeleportationScale(player.level().dimensionType(), overworld.dimensionType());
        double x = player.getX() * scale;
        double z = player.getZ() * scale;
        int limitX = TFCRealWorldConfig.HORIZONTAL_SCALE.get() - MARGIN;
        int limitZ = TFCRealWorldConfig.VERTICAL_SCALE.get() - MARGIN;
        if (Math.abs(x) <= limitX && Math.abs(z) <= limitZ) return;

        event.setCanceled(true);
        int cx = Mth.clamp(Mth.floor(x), -limitX, limitX);
        int cz = Mth.clamp(Mth.floor(z), -limitZ, limitZ);
        RwHostFix.LOGGER.info("{}: выход из ада за край карты ({}, {}) → ({}, {})", player.getGameProfile().getName(),
                Mth.floor(x), Mth.floor(z), cx, cz);
        server.tell(new TickTask(server.getTickCount(), () -> {
            if (player.isRemoved() || player.level().dimension() != Level.NETHER) return;
            int y = overworld.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, cx, cz);
            teleporting = true;
            try {
                player.teleportTo(overworld, cx + 0.5, y, cz + 0.5, player.getYRot(), player.getXRot());
            } finally {
                teleporting = false;
            }
            player.sendSystemMessage(Component.literal("Портал вёл за край карты — вы вышли у её края."));
        }));
    }
}
