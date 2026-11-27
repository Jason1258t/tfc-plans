package tfc.stand;

import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;
import java.security.ProtectionDomain;
import jdk.internal.org.objectweb.asm.ClassReader;
import jdk.internal.org.objectweb.asm.ClassWriter;
import jdk.internal.org.objectweb.asm.Opcodes;
import jdk.internal.org.objectweb.asm.tree.AbstractInsnNode;
import jdk.internal.org.objectweb.asm.tree.ClassNode;
import jdk.internal.org.objectweb.asm.tree.FieldInsnNode;
import jdk.internal.org.objectweb.asm.tree.MethodInsnNode;

/** Только JVM изолированного стенда. Не меняет jar снимка и не входит в аддоны игроков. */
public final class RegistrateGuard {
    private static final String TARGET = "com/tterrag/registrate/AbstractRegistrate";
    private static final String TABLE = "Lcom/google/common/collect/Table;";
    private static final String APPLIED = "TFC REGISTRATE GUARD APPLIED synchronizedTable assignments=1";

    public static void premain(String options, Instrumentation instrumentation) {
        if (Runtime.version().feature() != 21) fail("нужна Java 21, получена " + Runtime.version());
        instrumentation.addTransformer(new ClassFileTransformer() {
            @Override
            public byte[] transform(ClassLoader loader, String name, Class<?> redefining,
                    ProtectionDomain protectionDomain, byte[] bytes) {
                if (!TARGET.equals(name)) return null;
                try {
                    ClassNode node = new ClassNode(Opcodes.ASM8);
                    new ClassReader(bytes).accept(node, 0);
                    long fields = node.fields.stream().filter(field -> field.name.equals("registrations")
                            && field.desc.equals(TABLE) && (field.access & Opcodes.ACC_FINAL) != 0
                            && (field.access & Opcodes.ACC_STATIC) == 0).count();
                    if (fields != 1) throw new IllegalStateException("не совпала структура поля registrations");
                    int assignments = 0;
                    for (var method : node.methods) {
                        for (AbstractInsnNode instruction : method.instructions.toArray()) {
                            if (!(instruction instanceof FieldInsnNode field) || field.getOpcode() != Opcodes.PUTFIELD
                                    || !field.owner.equals(TARGET) || !field.name.equals("registrations")) continue;
                            AbstractInsnNode previous = field.getPrevious();
                            while (previous != null && previous.getOpcode() < 0) previous = previous.getPrevious();
                            if (!method.name.equals("<init>") || !field.desc.equals(TABLE)
                                    || !(previous instanceof MethodInsnNode factory)
                                    || factory.getOpcode() != Opcodes.INVOKESTATIC
                                    || !factory.owner.equals("com/google/common/collect/HashBasedTable")
                                    || !factory.name.equals("create")
                                    || !factory.desc.equals("()Lcom/google/common/collect/HashBasedTable;")) {
                                throw new IllegalStateException("не совпало присваивание registrations=HashBasedTable.create()");
                            }
                            method.instructions.insertBefore(field, new MethodInsnNode(Opcodes.INVOKESTATIC,
                                    "com/google/common/collect/Tables", "synchronizedTable", "(" + TABLE + ")" + TABLE, false));
                            assignments++;
                        }
                    }
                    if (assignments != 1) throw new IllegalStateException("ожидалось одно присваивание, найдено " + assignments);
                    ClassWriter writer = new ClassWriter(0);
                    node.accept(writer);
                    byte[] guarded = writer.toByteArray();
                    System.err.println(APPLIED);
                    return guarded;
                } catch (Throwable error) {
                    fail(error.toString());
                    return null;
                }
            }
        });
        System.err.println("TFC REGISTRATE GUARD ARMED Java=" + Runtime.version());
    }

    private static void fail(String reason) {
        System.err.println("TFC REGISTRATE GUARD FAIL: " + reason);
        // Исключения transformer JVM может проигнорировать: несовместимый клиент не должен продолжить без защиты.
        Runtime.getRuntime().halt(86);
    }
}
