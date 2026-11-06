import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.Toolkit;
import java.io.File;
import javax.imageio.ImageIO;

/** Снимок всего экрана DISPLAY в PNG: java Capture.java <файл.png> (клиентский стенд, scripts/client-stand.mjs) */
class Capture {
    public static void main(String[] args) throws Exception {
        var screen = new Rectangle(Toolkit.getDefaultToolkit().getScreenSize());
        ImageIO.write(new Robot().createScreenCapture(screen), "png", new File(args[0]));
    }
}
