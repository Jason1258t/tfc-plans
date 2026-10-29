# Окно Euphoria Patcher при запуске

Dev [#150](https://tfc-plans-fd2c.web.app/dev?task=150), обновление `u20261029-193554-dd27`.
Исходник: `config/euphoria_patcher/settings.toml` снимка `20261029-192724-29d7`,
SHA256 `d4ff06f1b6d8b191853b72996f8ba1d20cc90fa4e98e3222ab7fe552cf52b31e`.

Euphoria Patcher 1.9.3-r5.8.1 сообщает об отсутствии Complementary Shaders r5.8.1.
Изменено только `display.doPopUpLogging`: `true` → `false`.
Всплывающие сообщения этого мода в Sodium отключены, сообщения в журнале сохраняются.
Шейдер не устанавливается; установка совместимого Complementary нужна отдельно, если игрок хочет Euphoria Patches.

Через MCP проверен код `ConfigHandler.configStuff`, конструктора `EuphoriaPatcher`,
`EuphoriaLogger.checkAndSetupSodiumLogging` и `EuphoriaLogger.log`: настройка отключает подключение
к всплывающей консоли Sodium. Хеш исходного файла проверен; обратная замена единственного значения
восстанавливает исходные байты, включая CRLF. Пробная отправка показала ровно один конфиг.
В игре не проверялось.

Хосту:

```sh
tfc admin updates pull u20261029-193554-dd27
# Перезапустить клиент и проверить отсутствие красного окна.
tfc admin updates approve u20261029-193554-dd27
```

Для ручного исправления существующей клиентской копии: закрыть Minecraft и установить
`doPopUpLogging = false` в секции `[display]` файла `config/euphoria_patcher/settings.toml`.
Откат — вернуть `true`. Не заменять остальные настройки игрока.

Конфиг не импортирован в Firestore (`config_get` его не находит), поэтому вместо `config_propose`
отправлена накладка через `tfc admin propose`, взятая из актуального снимка.
