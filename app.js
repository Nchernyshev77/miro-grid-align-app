// app.js
// Логика: берём выделенные изображения и раскладываем их в сетку.

const { board } = window.miro;

/**
 * Читает значения из формы и приводит их к числам.
 */
function getFormValues() {
  const form = document.getElementById("align-form");

  const imagesPerRow = Number(form.imagesPerRow.value) || 1;
  const horizontalGap = Number(form.horizontalGap.value) || 0;
  const verticalGap = Number(form.verticalGap.value) || 0;

  const sizeMode = form.sizeMode.value; // 'none' | 'width' | 'height'

  return {
    imagesPerRow,
    horizontalGap,
    verticalGap,
    sizeMode,
  };
}

/**
 * Основной обработчик — вызывается при сабмите формы.
 */
async function onAlignSubmit(event) {
  event.preventDefault();

  try {
    const { imagesPerRow, horizontalGap, verticalGap, sizeMode } =
      getFormValues();

    // Берём текущее выделение на доске
    const selection = await board.getSelection();
    let images = selection.filter((item) => item.type === "image");

    if (images.length === 0) {
      await board.notifications.showInfo(
        "Сначала выдели хотя бы одно изображение."
      );
      return;
    }

    if (imagesPerRow < 1) {
      await board.notifications.showError(
        "Поле «Картинок в строке» должно быть больше 0."
      );
      return;
    }

    // Чтобы сетка вела себя предсказуемо, отсортируем картинки:
    // сначала по Y (сверху вниз), внутри строки по X (слева направо).
    images.sort((a, b) => {
      const dy = a.y - b.y;
      if (Math.abs(dy) > Math.min(a.height, b.height) / 2) {
        return dy;
      }
      return a.x - b.x;
    });

    // -----------------------------
    // 1. Выравниваем размеры
    // -----------------------------
    if (sizeMode === "width") {
      const targetWidth = Math.min(...images.map((img) => img.width));
      for (const img of images) {
        img.width = targetWidth; // высота подстроится автоматически
      }
      await Promise.all(images.map((img) => img.sync()));
    } else if (sizeMode === "height") {
      const targetHeight = Math.min(...images.map((img) => img.height));
      for (const img of images) {
        img.height = targetHeight; // ширина подстроится автоматически
      }
      await Promise.all(images.map((img) => img.sync()));
    }

    // После возможного ресайза размеры в объектах уже актуальные.
    const widths = images.map((img) => img.width);
    const heights = images.map((img) => img.height);

    const maxWidth = Math.max(...widths);
    const maxHeight = Math.max(...heights);

    // -----------------------------
    // 2. Считаем текущий bounding box
    // -----------------------------
    const bounds = images.map((img) => {
      return {
        item: img,
        left: img.x - img.width / 2,
        top: img.y - img.height / 2,
      };
    });

    const minLeft = Math.min(...bounds.map((b) => b.left));
    const minTop = Math.min(...bounds.map((b) => b.top));

    // -----------------------------
    // 3. Раскладываем в сетку
    // -----------------------------
    const cellWidth = maxWidth + horizontalGap;
    const cellHeight = maxHeight + verticalGap;

    const cols = Math.max(1, imagesPerRow);

    images.forEach((img, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;

      const targetLeft = minLeft + col * cellWidth;
      const targetTop = minTop + row * cellHeight;

      // Позиция задаётся по центру
      img.x = targetLeft + img.width / 2;
      img.y = targetTop + img.height / 2;
    });

    await Promise.all(images.map((img) => img.sync()));

    await board.notifications.showInfo(
      `Готово: выровнено ${images.length} изображений.`
    );
  } catch (error) {
    console.error(error);
    await board.notifications.showError(
      "Что-то пошло не так при выравнивании. Проверь консоль."
    );
  }
}

/**
 * Навешиваем обработчик на форму после загрузки панели.
 */
window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("align-form");
  form.addEventListener("submit", onAlignSubmit);
});
