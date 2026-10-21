package stress.fix;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(StressFix.MOD_ID)
public final class StressFix {
    public static final String MOD_ID = "stress_fix";
    public static final Logger LOGGER = LogUtils.getLogger();

    public StressFix() {
        NeoForge.EVENT_BUS.addListener(PhantomCleaner::onLevelTick);
        NeoForge.EVENT_BUS.addListener(StressFixCommand::register);
    }
}
