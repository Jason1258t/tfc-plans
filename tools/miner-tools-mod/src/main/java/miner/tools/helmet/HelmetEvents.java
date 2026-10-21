package miner.tools.helmet;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.living.LivingEquipmentChangeEvent;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import net.neoforged.neoforge.event.tick.PlayerTickEvent;

/** Фонарь (расход заряда, свет) и защита каски. Всё — на сервере */
public final class HelmetEvents {
    private HelmetEvents() {}

    /** Расход списывается раз в столько тиков: каждое изменение заряда — пакет надетого предмета всем, кто рядом */
    static final int DRAIN_PERIOD = 20;

    private static final boolean CURIOS = ModList.get().isLoaded("curios");

    /** Надетая каска: слот головы, иначе слот Curios «голова»; нет — пустой стек */
    public static ItemStack worn(LivingEntity entity) {
        ItemStack head = entity.getItemBySlot(EquipmentSlot.HEAD);
        if (head.is(Helmet.HELMET.get())) return head;
        return CURIOS ? HelmetCurios.worn(entity) : ItemStack.EMPTY;
    }

    @SubscribeEvent
    static void tick(PlayerTickEvent.Post event) {
        Player player = event.getEntity();
        if (player.level().isClientSide) return;
        ItemStack stack = worn(player);
        if (!stack.isEmpty()) tickWorn(player, stack);
    }

    /** Тик надетой каски: списать заряд, если фонарь горит, и поставить/снять {@link Helmet#LIT} */
    public static void tickWorn(Player player, ItemStack stack) {
        boolean on = Helmet.lampOn(stack);
        int energy = Helmet.energy(stack);
        int cost = Helmet.LAMP_COST.get();
        if (on && cost > 0 && energy > 0 && player.tickCount % DRAIN_PERIOD == 0) {
            energy = Math.max(0, energy - cost * DRAIN_PERIOD);
            stack.set(Helmet.ENERGY.get(), energy);
            if (energy == 0) {
                player.displayClientMessage(Component.translatable("message.miner_tools.miner_helmet.empty")
                        .withStyle(ChatFormatting.RED), true);
                player.level().playSound(null, player.blockPosition(), SoundEvents.STONE_BUTTON_CLICK_OFF,
                        SoundSource.PLAYERS, 0.5F, 0.6F);
            }
        }
        Helmet.setLit(stack, on && (energy > 0 || cost == 0));
    }

    /** Выключатель: Shift+ПКМ каской или клавиша (пакет {@link ToggleLampPayload}) */
    public static void toggle(Player player, ItemStack stack) {
        boolean on = !Helmet.lampOn(stack);
        if (on) stack.set(Helmet.LAMP_ON.get(), true);
        else stack.remove(Helmet.LAMP_ON.get());
        if (!on) Helmet.setLit(stack, false);
        boolean empty = on && Helmet.energy(stack) == 0 && Helmet.LAMP_COST.get() > 0;
        player.displayClientMessage(Component.translatable(empty ? "message.miner_tools.miner_helmet.on_empty"
                : on ? "message.miner_tools.miner_helmet.on" : "message.miner_tools.miner_helmet.off")
                .withStyle(empty ? ChatFormatting.RED : on ? ChatFormatting.YELLOW : ChatFormatting.GRAY), true);
        player.level().playSound(null, player.blockPosition(),
                on ? SoundEvents.STONE_BUTTON_CLICK_ON : SoundEvents.STONE_BUTTON_CLICK_OFF, SoundSource.PLAYERS,
                0.5F, on ? 0.9F : 0.7F);
    }

    /** Клавиша: выключатель надетой каски */
    static void toggleWorn(Player player) {
        ItemStack stack = worn(player);
        if (stack.isEmpty()) {
            player.displayClientMessage(Component.translatable("message.miner_tools.miner_helmet.not_worn")
                    .withStyle(ChatFormatting.GRAY), true);
            return;
        }
        toggle(player, stack);
        tickWorn(player, stack);
    }

    /**
     * Удар падающего блока (наковальня, сталактит, обвал TFC — у него обычный FallingBlockEntity и урон
     * minecraft:falling_block) по голове в каске. Событие приходит до того, как Minecraft снимет 25% за любой шлем и
     * посчитает броню, — всё это ещё сверху.
     */
    @SubscribeEvent
    static void incomingDamage(LivingIncomingDamageEvent event) {
        if (!event.getSource().is(Helmet.CUSHIONED) || event.getEntity().level().isClientSide) return;
        if (worn(event.getEntity()).isEmpty()) return;
        event.setAmount(event.getAmount() * (float) (1.0 - Helmet.CUSHION.get()));
    }

    /** Выпавшая каска (выбросили, смерть) не светит на земле */
    @SubscribeEvent
    static void itemJoin(EntityJoinLevelEvent event) {
        if (event.getLevel().isClientSide || !(event.getEntity() instanceof ItemEntity item)) return;
        ItemStack stack = item.getItem();
        if (stack.is(Helmet.HELMET.get()) && Helmet.lit(stack)) {
            ItemStack copy = stack.copy();
            Helmet.setLit(copy, false);
            item.setItem(copy);
        }
    }

    /** Каску надели на стойку или существо: их тик каску не ведёт — не светит */
    @SubscribeEvent
    static void equipment(LivingEquipmentChangeEvent event) {
        if (event.getEntity() instanceof Player || event.getEntity().level().isClientSide) return;
        ItemStack to = event.getTo();
        if (to.is(Helmet.HELMET.get())) Helmet.setLit(to, false);
    }
}
