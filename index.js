// index.js
// Этот файл загружается первым и вешает обработчик клика по иконке приложения.

async function init() {
  // Подписываемся на событие клика по иконке приложения на тулбаре
  await miro.board.ui.on("icon:click", async () => {
    // Открываем панель с интерфейсом
    await miro.board.ui.openPanel({
      url: "panel.html",
    });
  });
}

// Просто вызываем init — НИКАКОГО miro.onReady в SDK v2
init();
