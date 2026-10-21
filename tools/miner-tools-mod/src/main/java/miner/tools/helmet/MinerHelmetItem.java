package miner.tools.helmet;

import java.util.List;
import java.util.function.Consumer;
import net.minecraft.ChatFormatting;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.core.Holder;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterial;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;
import software.bernie.geckolib.animatable.GeoItem;
import software.bernie.geckolib.animatable.client.GeoRenderProvider;
import software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;
import software.bernie.geckolib.animation.AnimatableManager;
import software.bernie.geckolib.util.GeckoLibUtil;

/** Каска шахтёра. Модель на игроке рисует GeckoLib ({@code client/HelmetRenderer}), в руке и в инвентаре — обычная */
public class MinerHelmetItem extends ArmorItem implements GeoItem {
    private final AnimatableInstanceCache cache = GeckoLibUtil.createInstanceCache(this);

    public MinerHelmetItem(Holder<ArmorMaterial> material, Properties properties) {
        super(material, Type.HELMET, properties);
    }

    /** Shift+ПКМ — выключатель фонаря; просто ПКМ — надеть, как любой шлем */
    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (!player.isShiftKeyDown()) return super.use(level, player, hand);
        if (!level.isClientSide) HelmetEvents.toggle(player, stack);
        return InteractionResultHolder.sidedSuccess(stack, level.isClientSide);
    }

    /**
     * Снятая каска не светит. Inventory.tick вызывает это и для брони, поэтому надетую (тот же объект в слоте головы)
     * не трогаем — её ведёт {@link HelmetEvents}. Каски в слотах Curios сюда не попадают.
     */
    @Override
    public void inventoryTick(ItemStack stack, Level level, Entity entity, int slot, boolean selected) {
        if (level.isClientSide || !Helmet.lit(stack)) return;
        if (entity instanceof LivingEntity living && living.getItemBySlot(EquipmentSlot.HEAD) == stack) return;
        Helmet.setLit(stack, false);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.translatable("item.miner_tools.miner_helmet.energy",
                String.format("%,d", Helmet.energy(stack)).replace(',', ' '),
                String.format("%,d", Helmet.CAPACITY).replace(',', ' ')).withStyle(ChatFormatting.GRAY));
        tooltip.add(Component.translatable(Helmet.lampOn(stack)
                ? "item.miner_tools.miner_helmet.lamp_on" : "item.miner_tools.miner_helmet.lamp_off")
                .withStyle(Helmet.lampOn(stack) ? ChatFormatting.YELLOW : ChatFormatting.DARK_GRAY));
        tooltip.add(Component.translatable("item.miner_tools.miner_helmet.hint").withStyle(ChatFormatting.DARK_GRAY));
        tooltip.add(Component.translatable("item.miner_tools.miner_helmet.cushion",
                Math.round(Helmet.CUSHION.get() * 100)).withStyle(ChatFormatting.BLUE));
    }

    /** Заряд меняет компонент (зарядка — каждый тик) — без этого каска в руке дёргалась бы */
    @Override
    public boolean shouldCauseReequipAnimation(ItemStack oldStack, ItemStack newStack, boolean slotChanged) {
        return slotChanged || !ItemStack.isSameItem(oldStack, newStack);
    }

    // GeckoLib: модель неподвижна, анимаций нет

    @Override
    public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {}

    @Override
    public AnimatableInstanceCache getAnimatableInstanceCache() {
        return cache;
    }

    /** Рендерер создаётся на клиенте при первой отрисовке каски на игроке */
    @Override
    public void createGeoRenderer(Consumer<GeoRenderProvider> consumer) {
        consumer.accept(new GeoRenderProvider() {
            private miner.tools.helmet.client.HelmetRenderer renderer;

            @Override
            public <T extends LivingEntity> HumanoidModel<?> getGeoArmorRenderer(T entity, ItemStack stack,
                    EquipmentSlot slot, HumanoidModel<T> original) {
                if (renderer == null) renderer = new miner.tools.helmet.client.HelmetRenderer();
                return renderer;
            }
        });
    }
}
