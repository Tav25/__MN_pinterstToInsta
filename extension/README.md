# Chrome Extension (MV3)

Сборка/установка:
1. Открыть chrome://extensions → включить «Режим разработчика»
2. «Загрузить распакованное расширение» → выбрать папку extension/
3. Открыть pinterest.com — панель VD появится справа сверху

Особенности:
- content.js исполняется в MAIN world (`"world": "MAIN"`), чтобы перехватывать
  fetch/XHR самой страницы Pinterest, а не изолированный мир контент-скрипта.
- localStorage используется из MAIN world — данные лежат в origin pinterest.com.

Публикация в Web Store: упаковать папку в ZIP ($5 разовый взнос аккаунта разработчика).
