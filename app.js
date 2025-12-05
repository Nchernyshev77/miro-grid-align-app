// app.js
// Image Tools: Sorting (align selection) & Stitch (import and align).
const { board } = window.miro;

/* ---------- helpers: titles & numbers ---------- */

function getTitle(item) {
  return (item.title || "").toString();
}

/**
 * Extract the LAST integer number from a string.
 * "Name_01"   -> 1
 * "Name0003"  -> 3
 * "Name 10a2" -> 2 (last group)
 */
function extractTrailingNumber(str) {
  const match = str.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Geometry sort: top -> bottom, then left -> right
 */
function sortByGeometry(images) {
  return [...images].sort((a, b) => {
    if (a.y < b.y) return -1;
    if (a.y > b.y) return 1;
    if (a.x < b.x) return -1;
    if (a.x > b.x) return 1;
    return 0;
  });
}

/**
 * Align images in the order they are given in `images` array.
 * `config`:
 *  - imagesPerRow
 *  - horizontalGap
 *  - verticalGap
 *  - sizeMode  ('none' | 'width' | 'height')
 *  - startCorner ('top-left', 'top-right', 'bottom-left', 'bottom-right')
 */
async function alignImagesInGivenOrder(images, config) {
  const {
    imagesPerRow,
    horizontalGap,
    verticalGap,
    sizeMode,
    startCorner,
  } = config;

  if (!images.length) return;

  // resize if needed
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

  const widths = images.map((img) => img.width);
  const heights = images.map((img) => img.height);

  const maxWidth = Math.max(...widths);
  const maxHeight = Math.max(...heights);

  // current bounding box of selection
  const bounds = images.map((img) => ({
    left: img.x - img.width / 2,
    top: img.y - img.height / 2,
    right: img.x + img.width / 2,
    bottom: img.y + img.height / 2,
  }));

  const minLeft = Math.min(...bounds.map((b) => b.left));
  const minTop = Math.min(...bounds.map((b) => b.top));
  const maxRight = Math.max(...bounds.map((b) => b.right));
  const maxBottom = Math.max(...bounds.map((b) => b.bottom));

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

  images.forEach((img, index) => {
    // base row/col for top-left
    let row = Math.floor(index / cols); // 0..rows-1 (top->bottom)
    let col = index % cols; // 0..cols-1 (left->right)

    // adjust for chosen corner
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
}

/* ---------- SORTING TAB ---------- */

/**
 * For selected images:
 * 1) Check titles.
 * 2) If some have empty title -> number by geometry (top-left to bottom-right):
 *      img.title = "1", "2", ...
 * 3) Build order:
 *      - images with number at end of title go first, sorted by that number
 *      - then images without number, sorted alphabetically by title
 * 4) Align using this order.
 */
async function handleSortingSubmit(event) {
  event.preventDefault();

  try {
    const form = document.getElementById("sorting-form");
    const imagesPerRow = Number(form.sortingImagesPerRow.value) || 1;
    const horizontalGap = Number(form.sortingHorizontalGap.value) || 0;
    const verticalGap = Number(form.sortingVerticalGap.value) || 0;
    const sizeMode = form.sortingSizeMode.value;
    const startCorner = form.sortingStartCorner.value;

    const selection = await board.getSelection();
    let images = selection.filter((i) => i.type === "image");

    if (!images.length) {
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

    // 1) check titles
    const hasAnyEmptyTitle = images.some((img) => !getTitle(img));

    if (hasAnyEmptyTitle) {
      // 2) number by geometry
      const geoOrder = sortByGeometry(images);
      let counter = 1;
      for (const img of geoOrder) {
        img.title = String(counter);
        counter++;
      }
      await Promise.all(geoOrder.map((img) => img.sync()));
      images = geoOrder; // чуть логичнее дальше использовать этот порядок
    }

    // Now we sort images by (number in title) + alphabet
    const meta = images.map((img, index) => {
      const title = getTitle(img);
      const lower = title.toLowerCase();
      const num = extractTrailingNumber(title);
      const hasNumber = num !== null;
      return { img, index, title, lower, hasNumber, num };
    });

    console.groupCollapsed("Sorting – titles & numbers");
    meta.forEach((m) => {
      console.log(m.title || m.img.id, "=>", m.num);
    });
    console.groupEnd();

    meta.sort((a, b) => {
      // numbered first
      if (a.hasNumber && !b.hasNumber) return -1;
      if (!a.hasNumber && b.hasNumber) return 1;

      if (a.hasNumber && b.hasNumber) {
        if (a.num !== b.num) return a.num - b.num;
        if (a.lower < b.lower) return -1;
        if (a.lower > b.lower) return 1;
        return a.index - b.index;
      }

      // both without numbers: alphabet
      if (a.lower < b.lower) return -1;
      if (a.lower > b.lower) return 1;
      return a.index - b.index;
    });

    const orderedImages = meta.map((m) => m.img);

    await alignImagesInGivenOrder(orderedImages, {
      imagesPerRow,
      horizontalGap,
      verticalGap,
      sizeMode,
      startCorner,
    });

    await board.notifications.showInfo(
      `Done: aligned ${orderedImages.length} image${
        orderedImages.length === 1 ? "" : "s"
      }.`
    );
  } catch (err) {
    console.error(err);
    await board.notifications.showError(
      "Something went wrong while aligning images. Please check the console."
    );
  }
}

/* ---------- STITCH TAB ---------- */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Sort File objects by name:
 *  - files with trailing number go first, sorted by that number
 *  - then files without number, sorted alphabetically
 */
function sortFilesByNameWithNumber(files) {
  const arr = Array.from(files).map((file, index) => {
    const name = file.name || "";
    const lower = name.toLowerCase();
    const num = extractTrailingNumber(name);
    return {
      file,
      index,
      name,
      lower,
      hasNumber: num !== null,
      num,
    };
  });

  console.groupCollapsed("Stitch – files & numbers");
  arr.forEach((m) => {
    console.log(m.name, "=>", m.num);
  });
  console.groupEnd();

  arr.sort((a, b) => {
    if (a.hasNumber && !b.hasNumber) return -1;
    if (!a.hasNumber && b.hasNumber) return 1;

    if (a.hasNumber && b.hasNumber) {
      if (a.num !== b.num) return a.num - b.num;
      if (a.lower < b.lower) return -1;
      if (a.lower > b.lower) return 1;
      return a.index - b.index;
    }

    if (a.lower < b.lower) return -1;
    if (a.lower > b.lower) return 1;
    return a.index - b.index;
  });

  return arr.map((m) => m.file);
}

/**
 * Handle Stitch tab:
 *  - read folder input,
 *  - sort files by name (with numeric suffix),
 *  - create images on the board,
 *  - align them into a grid in the chosen corner.
 */
async function handleStitchSubmit(event) {
  event.preventDefault();

  try {
    const form = document.getElementById("stitch-form");
    const imagesPerRow = Number(form.stitchImagesPerRow.value) || 1;
    const horizontalGap = Number(form.stitchHorizontalGap.value) || 0;
    const verticalGap = Number(form.stitchVerticalGap.value) || 0;
    const startCorner = form.stitchStartCorner.value;

    const input = document.getElementById("stitchFolderInput");
    const files = input.files;

    if (!files || !files.length) {
      await board.notifications.showError(
        "Please choose a folder with image files."
      );
      return;
    }

    if (imagesPerRow < 1) {
      await board.notifications.showError(
        "“Images per row” must be greater than 0."
      );
      return;
    }

    const sortedFiles = sortFilesByNameWithNumber(files);

    await board.notifications.showInfo(
      "Importing images from folder… (this may take a bit)"
    );

    // Create images on the board in some rough cluster first (e.g. near 0,0),
    // then reuse the same align logic to arrange them in a grid.
    const createdImages = [];

    // We'll place them roughly near the origin; align will reposition anyway.
    const baseX = 0;
    const baseY = 0;
    const offsetStep = 50;

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      // Read as data URL (browser will handle it)
      const dataUrl = await readFileAsDataUrl(file);

      const img = await board.createImage({
        url: dataUrl,
        x: baseX + (i % 5) * offsetStep,
        y: baseY + Math.floor(i / 5) * offsetStep,
        title: file.name, // сохраним имя файла в title (для Sorting, если что)
      });

      createdImages.push(img);
    }

    await alignImagesInGivenOrder(createdImages, {
      imagesPerRow,
      horizontalGap,
      verticalGap,
      sizeMode: "none", // при stitch не меняем размер, можно потом Sorting-ом
      startCorner,
    });

    await board.notifications.showInfo(
      `Imported and stitched ${createdImages.length} image${
        createdImages.length === 1 ? "" : "s"
      }.`
    );
  } catch (err) {
    console.error(err);
    await board.notifications.showError(
      "Something went wrong while importing images. Please check the console."
    );
  }
}

/* ---------- init ---------- */

window.addEventListener("DOMContentLoaded", () => {
  const sortingForm = document.getElementById("sorting-form");
  if (sortingForm) sortingForm.addEventListener("submit", handleSortingSubmit);

  const stitchForm = document.getElementById("stitch-form");
  if (stitchForm) stitchForm.addEventListener("submit", handleStitchSubmit);
});
