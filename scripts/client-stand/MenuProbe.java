package tfc.stand.probe;

/** Наблюдатель кадра в bootstrap loader: доступен из изолированного модуля Minecraft. */
public final class MenuProbe {
    private static long lastFrame;
    public static void mark(Object minecraft) {
        long time = System.currentTimeMillis();
        if (time - lastFrame < 1000) return;
        lastFrame = time;
        Object screen;
        boolean overlay;
        try {
            overlay = minecraft.getClass().getMethod("getOverlay").invoke(minecraft) != null;
            screen = minecraft.getClass().getField("screen").get(minecraft);
        } catch (Throwable error) { System.err.println("TFC MENU PROBE FAIL: " + error); Runtime.getRuntime().halt(86); return; }
        boolean title = false;
        if (screen != null) for (Class<?> type = screen.getClass(); type != null; type = type.getSuperclass())
            if (type.getName().equals("net.minecraft.client.gui.screens.TitleScreen")) title = true;
        System.out.println("TFC MENU " + (title && !overlay ? "FRAME " : "BLOCKED ") + time);
    }

}
