package host.tools;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(HostTools.MOD_ID)
public final class HostTools {
    public static final String MOD_ID = "host_tools";
    public static final Logger LOGGER = LogUtils.getLogger();

    public HostTools(ModContainer container) {
        container.registerConfig(ModConfig.Type.COMMON, HostConfig.SPEC);
        NeoForge.EVENT_BUS.addListener(HostCommand::register);
        NeoForge.EVENT_BUS.addListener(PingCommand::register);
        NeoForge.EVENT_BUS.addListener(HostService::onServerStopping);
        NeoForge.EVENT_BUS.addListener(PingCommand::onServerTick);
    }
}
