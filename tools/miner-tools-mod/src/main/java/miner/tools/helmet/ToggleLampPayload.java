package miner.tools.helmet;

import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Клиент → сервер: клавиша фонаря каски нажата */
public record ToggleLampPayload() implements CustomPacketPayload {
    public static final ToggleLampPayload INSTANCE = new ToggleLampPayload();
    public static final Type<ToggleLampPayload> TYPE = new Type<>(Helmet.id("toggle_lamp"));
    public static final StreamCodec<ByteBuf, ToggleLampPayload> CODEC = StreamCodec.unit(INSTANCE);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
