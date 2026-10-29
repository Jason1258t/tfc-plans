package ie.extras.basin;

/** Чаша Create с теплом от внешнего нагревателя IE (добавляет миксин BasinBlockEntityMixin) */
public interface BasinHeat {
    /** Внешний нагреватель держит чашу на temperature °C до тика until (игровое время мира) */
    void ieExtras$setExternalHeat(float temperature, long until);

    /** Температура от внешнего нагревателя IE, если он грел чашу не позже чем until */
    float ieExtras$externalHeat(long now);
}
