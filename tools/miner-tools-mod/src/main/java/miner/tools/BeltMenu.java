package miner.tools;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.world.Container;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.DataSlot;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemContainerContents;

/**
 * Окно фильтра пояса: 9 ячеек-образцов («призраки»: клик предметом кладёт его копию, пустой рукой — убирает; предметы
 * игрока остаются у игрока) и инвентарь. Пояс открыт из руки — эта ячейка заблокирована, чтобы его не переложили.
 * Кнопки: 0 — «все породы и почвы», 1 — работает/выключен.
 */
public class BeltMenu extends AbstractContainerMenu {
    public static final int SLOTS = 9;
    public static final int BUTTON_ANY = 0, BUTTON_ENABLED = 1;

    private final Player player;
    private final InteractionHand hand;
    private final Container filter = new SimpleContainer(SLOTS);
    /** Флаги для кнопок окна: бит 0 — работает, бит 1 — все породы (на сервере читаются с пояса) */
    private final DataSlot flags;

    /** Клиент: рука приходит от сервера */
    public BeltMenu(int id, Inventory inv, RegistryFriendlyByteBuf buf) {
        this(id, inv, buf.readEnum(InteractionHand.class));
    }

    public BeltMenu(int id, Inventory inv, InteractionHand hand) {
        super(MinerTools.MENU.get(), id);
        this.player = inv.player;
        this.hand = hand;
        ItemStack belt = belt();
        net.minecraft.core.NonNullList<ItemStack> items = net.minecraft.core.NonNullList.withSize(SLOTS, ItemStack.EMPTY);
        belt.getOrDefault(MinerTools.FILTER.get(), ItemContainerContents.EMPTY).copyInto(items);
        for (int i = 0; i < SLOTS; i++) filter.setItem(i, items.get(i));

        for (int i = 0; i < SLOTS; i++) addSlot(new GhostSlot(filter, i, 8 + i * 18, 18));
        int locked = hand == InteractionHand.MAIN_HAND ? inv.selected : -1;
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 9; col++) addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, 49 + row * 18));
        }
        for (int col = 0; col < 9; col++) {
            addSlot(col == locked ? new LockedSlot(inv, col, 8 + col * 18, 107) : new Slot(inv, col, 8 + col * 18, 107));
        }
        flags = addDataSlot(new DataSlot() {
            int client;

            @Override
            public int get() {
                if (player.level().isClientSide) return client;
                ItemStack b = belt();
                return (BeltFilter.enabled(b) ? 1 : 0) | (BeltFilter.anyVariant(b) ? 2 : 0);
            }

            @Override
            public void set(int value) {
                client = value;
            }
        });
    }

    public boolean enabled() {
        return (flags.get() & 1) != 0;
    }

    public boolean anyVariant() {
        return (flags.get() & 2) != 0;
    }

    private ItemStack belt() {
        return player.getItemInHand(hand);
    }

    @Override
    public boolean stillValid(Player player) {
        return belt().is(MinerTools.BELT.get());
    }

    @Override
    public boolean clickMenuButton(Player player, int id) {
        ItemStack b = belt();
        if (id == BUTTON_ANY) b.set(MinerTools.ANY_VARIANT.get(), !BeltFilter.anyVariant(b));
        else if (id == BUTTON_ENABLED) b.set(MinerTools.ENABLED.get(), !BeltFilter.enabled(b));
        else return false;
        return true;
    }

    @Override
    public void clicked(int slotId, int button, ClickType type, Player player) {
        if (slotId >= 0 && slotId < SLOTS) {
            if (type == ClickType.PICKUP || type == ClickType.QUICK_MOVE) {
                ItemStack carried = getCarried();
                if (!carried.is(MinerTools.BELT.get())) setSample(slotId, carried);
            }
            return;
        }
        // Цифрой (или F для второй руки) пояс тоже не переложить
        if (type == ClickType.SWAP && (hand == InteractionHand.MAIN_HAND ? button == player.getInventory().selected : button == 40)) {
            return;
        }
        super.clicked(slotId, button, type, player);
    }

    /** Shift+клик по своему предмету — в первую свободную ячейку образцов (если такого образца ещё нет) */
    @Override
    public ItemStack quickMoveStack(Player player, int index) {
        if (index < SLOTS) return ItemStack.EMPTY;
        Slot slot = slots.get(index);
        ItemStack stack = slot.getItem();
        if (stack.isEmpty() || stack.is(MinerTools.BELT.get())) return ItemStack.EMPTY;
        int free = -1;
        for (int i = 0; i < SLOTS; i++) {
            ItemStack s = filter.getItem(i);
            if (ItemStack.isSameItemSameComponents(s, stack)) return ItemStack.EMPTY;
            if (s.isEmpty() && free < 0) free = i;
        }
        if (free >= 0) setSample(free, stack);
        return ItemStack.EMPTY;
    }

    private void setSample(int i, ItemStack stack) {
        filter.setItem(i, stack.copyWithCount(1));
        if (player.level().isClientSide) return;
        java.util.List<ItemStack> items = new java.util.ArrayList<>(SLOTS);
        for (int k = 0; k < SLOTS; k++) items.add(filter.getItem(k));
        belt().set(MinerTools.FILTER.get(), ItemContainerContents.fromItems(items));
    }

    /** Образец: игрок его не забирает и не кладёт сам — только через {@link #clicked} */
    static class GhostSlot extends Slot {
        GhostSlot(Container c, int i, int x, int y) {
            super(c, i, x, y);
        }

        @Override
        public boolean mayPlace(ItemStack stack) {
            return false;
        }

        @Override
        public boolean mayPickup(Player player) {
            return false;
        }

        @Override
        public int getMaxStackSize() {
            return 1;
        }
    }

    static class LockedSlot extends Slot {
        LockedSlot(Container c, int i, int x, int y) {
            super(c, i, x, y);
        }

        @Override
        public boolean mayPlace(ItemStack stack) {
            return false;
        }

        @Override
        public boolean mayPickup(Player player) {
            return false;
        }
    }
}
