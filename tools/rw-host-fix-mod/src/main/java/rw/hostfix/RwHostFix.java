package rw.hostfix;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(RwHostFix.MOD_ID)
public final class RwHostFix {
    public static final String MOD_ID = "rw_host_fix";
    public static final Logger LOGGER = LogUtils.getLogger();

    public RwHostFix() {
        NeoForge.EVENT_BUS.addListener(NetherPortalClamp::onTravel);
    }
}
