// app.js
// Logic: take selected images and arrange them into a grid.

const { board } = window.miro;

/**
 * Extracts the LAST integer number from whatever name we can read.
 *
 * Uses item.title or item.alt (fallback to empty string).
 * Looks for the last group of digits anywhere in the string.
 *
 * Examples:
 *  "tile_01"          -> 1
 *  "tile01"           -> 1
 *  "tile_0003.png"    -> 3
 *  "my-tile-10 (copy)"-> 10
 *  "img_42"           -> 42
 */
function extractIndexFromItem(item) {
  const raw = (item.title || item.alt || "").toString();
  if (!raw) return null;

  // LAST group of digits in the string
  const match = raw.match(/(\d+)(?!.*\d)/);
  if (!match) return null;

  const num = Number.parseInt(match[1], 10);
  if (Number.isNaN(num)) return null;

  return num;
}

/**
 * Fallback compare: by geometry (top -> bottom, left -> right).
 */
function compareByGeometry(a, b) {
  const dy = a.y - b.y;
  if (Math.abs(dy) > Math.min(a.height, b.height) / 2) {
    return dy;
  }
  return a.x - b.x;
}

/**
 * Sort images either by number (if present) or by geometry.
 */
function sortImages(images, sortByNumber) {
  const withMeta = images.map((item) => {
    const index = extractIndexFromItem(item);
    return { item, index };
  });

  const anyIndex = withMeta.some((m) => m.index !== null);

  // Debug log — можно посмотреть в консоли порядок и индексы
  console.groupCollapsed("Image Grid Aligner – parsed indices");
  withMeta.forEach((m) => {
    console.log(m.item.title || m.item.alt || m.item.id, "->", m.index);
  });
  console.groupEnd();

  if (sortByNumber && anyIndex) {
    withMeta.sort((a, b) => {
      const ai = a.index;
      const bi = b.index;

      if (ai !== null && bi !== null) {
        if (ai !== bi) return ai - bi;
        // если числа равны, fallback к геометрии
        return compareByGeometry(a.item, b.item);
      }

      if (ai !== null) return -1; // с номером раньше без номера
      if (bi !== null) return 1;
      return compareByGeometry(a.item, b.item);
    });
  } else {
    withMeta.sort((a, b) => compareByGeometry(a.item, b.item));
  }

  return withMeta.map((m) => m.item);
}

/**
 * Reads values from the form.
 */
function getFormValues() {
  const form = document.getElementById("align-form");

  const imagesPerRow = Number(form.imagesPerRow.value) || 1;
  const horizontalGap = Number(form.horizontalGap.value) || 0;
  const verticalGap = Number(form.verticalGap.value) || 0;

  const sizeMode = form.sizeMode.value; // 'none' | 'width' | 'height'
  const startCorner = form.startCorner.value; // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  const sortByNumber = document.getElementById("sortByNumber").checked;

  return {
    imagesPerRow,
    horizontalGap,
    verticalGap,
    sizeMode,
    startCorner,
    sortByNumber,
  };
}

/**
 * Main handler — called on form submit.
 */
async function onAlignSubmit(event) {
  event.preventDefault();

  try {
    const {
      imagesPerRow,
      horizontalGap,
      verticalGap,
      sizeMode,
      startCorner,
      sortByNumber,
    } = getFormValues();

    const selection = await board.getSelection();
    let images = selection.filter((item) => item.type === "image");

    if (images.length === 0) {
      await board.notifications.showInfo(
        "Select at least one image on the board."
      );
      return;
    }

    if (imagesPerRow < 1) {
      await board.notifications.showError(
        "“Images per row” must be greater than 0."
      );
      return;
    }

    // 1. Sort images (by number if possible, otherwise by geometry)
    images = sortImages(images, sortByNumber);

    // 2. Resize images if needed
    if (sizeMode === "width") {
      const targetWidth = Math.min(...images.map((img) => img.width));
      for (const img of images) {
        img.width = targetWidth;
      }
      await Promise.all(images.map((img) => img.sync()));
    } else if (sizeMode === "height") {
      const targetHeight = Math.min(...images.map((img) => img.height));
      for (const img of images) {
        img.height = targetHeight;
      }
      await Promise.all(images.map((img) => img.sync()));
    }

    // После ресайза размеры актуальны
    const widths = images.map((img) => img.width);
    const heights = images.map((img) => img.height);

    const maxWidth = Math.max(...widths);
    const maxHeight = Math.max(...heights);

    // 3. Текущий bounding box выделения
    const bounds = images.map((img) => {
      return {
        item: img,
        left: img.x - img.width / 2,
        top: img.y - img.height / 2,
        right: img.x + img.width / 2,
        bottom: img.y + img.height / 2,
      };
    });

    const minLeft = Math.min(...bounds.map((b) => b.left));
    const minTop = Math.min(...bounds.map((b) => b.top));
    const maxRight = Math.max(...bounds.map((b) => b.right));
    const maxBottom = Math.max(...bounds.map((b) => b.bottom));

    // 4. Геометрия сетки
    const total = images.length;
    const cols = Math.max(1, imagesPerRow);
    const rows = Math.ceil(total / cols);

    const cellWidth = maxWidth + horizontalGap;
    const cellHeight = maxHeight + verticalGap;

    const gridWidth = cols * maxWidth + (cols - 1) * horizontalGap;
    const gridHeight = rows * maxHeight + (rows - 1) * verticalGap;

    let originLeft;
    let originTop;

    // куда «прилипает» сетка относительно старого bounding box
    if (startCorner.startsWith("top")) {
      originTop = minTop;
    } else {
      originTop = maxBottom - gridHeight;
    }

    if (startCorner.endsWith("left")) {
      originLeft = minLeft;
    } else {
      originLeft = maxRight - gridWidth;
    }

    // 5. Раскладываем по сетке
    images.forEach((img, index) => {
      // базовые row/col для режима top-left
      let row = Math.floor(index / cols); // 0..rows-1 сверху вниз
      let col = index % cols;            // 0..cols-1 слева направо

      // модифицируем row/col в зависимости от угла
      switch (startCorner) {
        case "top-left":
          // ничего
          break;
        case "top-right":
          col = cols - 1 - col;
          break;
        case "bottom-left":
          row = rows - 1 - row;
          break;
        case "bottom-right":
          row = rows - 1 - row;
          col = cols - 1 - col;
          break;
      }

      const left = originLeft + col * cellWidth;
      const top = originTop + row * cellHeight;

      img.x = left + img.width / 2;
      img.y = top + img.height / 2;
    });

    await Promise.all(images.map((img) => img.sync()));

    await board.notifications.showInfo(
      `Done: aligned ${images.length} image${images.length === 1 ? "" : "s"}.`
    );
  } catch (error) {
    console.error(error);
    await board.notifications.showError(
      "Something went wrong while aligning images. Please check the console."
    );
  }
}

/**
 * Attach handler after panel DOM is ready.
 */
window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("align-form");
  form.addEventListener("submit", onAlignSubmit);
});
