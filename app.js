// app.js
// Arrange selected images into a grid.

const { board } = window.miro;

/**
 * Extract the LAST integer number from a name (title/alt).
 * Any number of leading zeros is OK: 1, 01, 0001, 10, 011…
 */
function extractIndexFromItem(item) {
  const raw = (item.title || item.alt || "").toString();
  if (!raw) return null;

  // Last group of digits in the string
  const match = raw.match(/(\d+)(?!.*\d)/);
  if (!match) return null;

  const num = Number.parseInt(match[1], 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Sort images:
 * - если у всех есть номер и включён sortByNumber -> сортируем ЧИСТО по номеру
 * - если номера есть не у всех -> сначала по номеру, затем по исходному порядку выделения
 * - если sortByNumber выключен -> по исходному порядку выделения
 */
function sortImages(images, sortByNumber) {
  const meta = images.map((item, i) => ({
    item,
    index: extractIndexFromItem(item),
    orig: i, // порядок в selection
  }));

  const allHaveIndex = meta.every((m) => m.index !== null);

  console.groupCollapsed("Image Grid Aligner – parsed indices");
  meta.forEach((m) => {
    console.log(m.item.title || m.item.alt || m.item.id, "->", m.index);
  });
  console.groupEnd();

  if (sortByNumber) {
    if (allHaveIndex) {
      // самый стабильный случай: только по номеру
      meta.sort((a, b) => a.index - b.index);
    } else {
      // у кого есть номер — по номеру, у остальных — после, но без геометрии
      meta.sort((a, b) => {
        const ai = a.index;
        const bi = b.index;

        if (ai !== null && bi !== null) {
          if (ai !== bi) return ai - bi;
          return a.orig - b.orig; // одинаковые номера -> по исходному порядку выделения
        }
        if (ai !== null) return -1;
        if (bi !== null) return 1;
        return a.orig - b.orig;
      });
    }
  } else {
    // вообще без номеров — просто по порядку выделения
    meta.sort((a, b) => a.orig - b.orig);
  }

  return meta.map((m) => m.item);
}

/**
 * Read form values.
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

    // 1. Sort images
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

    // After resizing, sizes are up to date
    const widths = images.map((img) => img.width);
    const heights = images.map((img) => img.height);

    const maxWidth = Math.max(...widths);
    const maxHeight = Math.max(...heights);

    // 3. Current bounding box of selection
    const bounds = images.map((img) => ({
      item: img,
      left: img.x - img.width / 2,
      top: img.y - img.height / 2,
      right: img.x + img.width / 2,
      bottom: img.y + img.height / 2,
    }));

    const minLeft = Math.min(...bounds.map((b) => b.left));
    const minTop = Math.min(...bounds.map((b) => b.top));
    const maxRight = Math.max(...bounds.map((b) => b.right));
    const maxBottom = Math.max(...bounds.map((b) => b.bottom));

    // 4. Grid geometry
    const total = images.length;
    const cols = Math.max(1, imagesPerRow);
    const rows = Math.ceil(total / cols);

    const cellWidth = maxWidth + horizontalGap;
    const cellHeight = maxHeight + verticalGap;

    const gridWidth = cols * maxWidth + (cols - 1) * horizontalGap;
    const gridHeight = rows * maxHeight + (rows - 1) * verticalGap;

    let originLeft;
    let originTop;

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

    // 5. Place images into grid
    images.forEach((img, index) => {
      // row/col в режиме top-left
      let row = Math.floor(index / cols); // 0..rows-1 сверху вниз
      let col = index % cols; // 0..cols-1 слева направо

      // модифицируем row/col в зависимости от угла
      switch (startCorner) {
        case "top-left":
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
