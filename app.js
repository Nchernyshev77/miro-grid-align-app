// app.js
// Image Tools: Sorting (align selection) & Stitch (import and align).
const { board } = window.miro;

/* ---------- helpers: titles & numbers ---------- */

function getTitle(item) {
  return (item.title || "").toString();
}

/**
 * Попробовать вытащить URL картинки из разных полей виджета.
 * Сейчас используем только в Stitch, когда ещё есть dataURL;
 * для Sorting по цвету URL больше не нужен.
 */
function getImageUrlFromWidget(widget) {
  if (!widget) return null;

  if (widget.url) return widget.url;
  if (widget.contentUrl) return widget.contentUrl;
  if (widget.previewUrl) return widget.previewUrl;
  if (widget.originalUrl) return widget.originalUrl;

  if (widget.style) {
    if (widget.style.imageUrl) return widget.style.imageUrl;
    if (widget.style.backgroundImage) return widget.style.backgroundImage;
    if (widget.style.src) return widget.style.src;
  }

  if (widget.metadata) {
    if (widget.metadata.imageUrl) return widget.metadata.imageUrl;
    if (widget.metadata.url) return widget.metadata.url;
  }

  return null;
}

/**
 * Вытянуть ПОСЛЕДНЕЕ целое число из строки.
 * "Name_01"   -> 1
 * "Name0003"  -> 3
 * "Name 10a2" -> 2 (последняя группа цифр)
 */
function extractTrailingNumber(str) {
  const match = str.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isNaN(num) ? null : num;
}

/**
 * Сортировка по геометрии: сверху вниз, внутри строки слева направо.
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

/* ---------- helpers: image loading & brightness ---------- */

/**
 * Загрузить картинку по URL в <img>.
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Посчитать яркость и признак "ч/б" из РАЗМЫТОГО изображения,
 * игнорируя верхние 20% по высоте.
 *
 * Возвращает { brightness: 0..1, isGray: boolean } или null при ошибке.
 */
function getBrightnessAndGrayFromImageElement(
  img,
  smallSize = 50,
  blurPx = 3,
  cropTopRatio = 0.2
) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const width = smallSize;
  const height = smallSize;

  canvas.width = width;
  canvas.height = height;

  const prevFilter = ctx.filter || "none";
  try {
    ctx.filter = `blur(${blurPx}px)`;
  } catch (e) {
    // если фильтры не поддерживаются, просто игнорируем
  }

  ctx.drawImage(img, 0, 0, width, height);
  ctx.filter = prevFilter;

  const cropY = Math.floor(height * cropTopRatio);
  const cropH = height - cropY;
  if (cropH <= 0) return null;

  let imageData;
  try {
    imageData = ctx.getImageData(0, cropY, width, cropH);
  } catch (e) {
    console.error("getImageData failed (CORS?):", e);
    return null;
  }

  const data = imageData.data;
  const totalPixels = width * cropH;
  let sumY = 0;
  let sumDiff = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // яркость
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumY += y;

    // "цветность": разброс между каналами
    const maxv = Math.max(r, g, b);
    const minv = Math.min(r, g, b);
    sumDiff += maxv - minv;
  }

  const avgY = sumY / totalPixels; // 0..255
  const avgDiff = sumDiff / totalPixels; // 0..255

  const brightness = avgY / 255; // 0..1
  const saturationApprox = avgDiff / 255; // 0..1

  // если средний разброс каналов маленький — считаем ч/б.
  const isGray = saturationApprox < 0.08;

  return { brightness, isGray };
}

/* ---------- helpers: alignment ---------- */

/**
 * Выравнять картинки в том порядке, в котором они приходят в массиве images.
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

  // нормализация размера при необходимости
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

  const total = images.length;
  const cols = Math.max(1, imagesPerRow);
  const rows = Math.ceil(total / cols);

  const rowHeights = new Array(rows).fill(0);
  const rowWidths = new Array(rows).fill(0);

  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / cols);
    const img = images[i];

    if (img.height > rowHeights[r]) rowHeights[r] = img.height;

    if (rowWidths[r] > 0) rowWidths[r] += horizontalGap;
    rowWidths[r] += img.width;
  }

  const gridWidth = rowWidths.length ? Math.max(...rowWidths) : 0;
  const gridHeight =
    rowHeights.reduce((sum, h) => sum + h, 0) +
    verticalGap * Math.max(0, rows - 1);

  const rowTop = new Array(rows).fill(0);
  for (let r = 1; r < rows; r++) {
    rowTop[r] = rowTop[r - 1] + rowHeights[r - 1] + verticalGap;
  }

  const baseX = new Array(total).fill(0);
  const baseY = new Array(total).fill(0);
  const rowCursorX = new Array(rows).fill(0);

  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / cols);
    const img = images[i];

    const centerY = rowTop[r] + rowHeights[r] / 2;
    const centerX = rowCursorX[r] + img.width / 2;

    baseX[i] = centerX;
    baseY[i] = centerY;

    rowCursorX[r] += img.width + horizontalGap;
  }

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

  let originLeft;
  let originTop;
  let flipX = false;
  let flipY = false;

  switch (startCorner) {
    case "top-left":
      originLeft = minLeft;
      originTop = minTop;
      break;
    case "top-right":
      originLeft = maxRight - gridWidth;
      originTop = minTop;
      flipX = true;
      break;
    case "bottom-left":
      originLeft = minLeft;
      originTop = maxBottom - gridHeight;
      flipY = true;
      break;
    case "bottom-right":
      originLeft = maxRight - gridWidth;
      originTop = maxBottom - gridHeight;
      flipX = true;
      flipY = true;
      break;
    default:
      originLeft = minLeft;
      originTop = minTop;
  }

  for (let i = 0; i < total; i++) {
    let x0 = baseX[i];
    let y0 = baseY[i];

    if (flipX) x0 = gridWidth - x0;
    if (flipY) y0 = gridHeight - y0;

    const img = images[i];
    img.x = originLeft + x0;
    img.y = originTop + y0;
  }

  await Promise.all(images.map((img) => img.sync()));
}

/* ---------- SORTING: by number ---------- */

async function sortImagesByNumber(images) {
  const hasAnyEmptyTitle = images.some((img) => !getTitle(img));

  if (hasAnyEmptyTitle) {
    const geoOrder = sortByGeometry(images);
    let counter = 1;
    for (const img of geoOrder) {
      img.title = String(counter);
      counter++;
    }
    await Promise.all(geoOrder.map((img) => img.sync()));
    images = geoOrder;
  }

  const meta = images.map((img, index) => {
    const title = getTitle(img);
    const lower = title.toLowerCase();
    const num = extractTrailingNumber(title);
    const hasNumber = num !== null;
    return { img, index, title, lower, hasNumber, num };
  });

  console.groupCollapsed("Sorting (number) – titles & numbers");
  meta.forEach((m) => {
    console.log(m.title || m.img.id, "=>", m.num);
  });
  console.groupEnd();

  meta.sort((a, b) => {
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

  return meta.map((m) => m.img);
}

/* ---------- SORTING: by color code in title ---------- */

/**
 * Color-sort: читаем префикс вида "C0000 " из title
 * (он выставляется во время импорта через Stitch),
 * и сортируем по нему.
 *
 * Первая цифра: 0 – ч/б, 1 – цвет.
 * Следующие три: яркость 000..999 (000 – светлый, 999 – тёмный).
 *
 * Если ни у одной картинки нет такого префикса — fallback на геометрию.
 */
async function sortImagesByColor(images) {
  const meta = images.map((img, index) => {
    const title = getTitle(img);
    const match = title.match(/^C(\d{4})\s+/); // C#### в начале
    const code = match ? Number.parseInt(match[1], 10) : null;
    return { img, index, title, code };
  });

  const anyCode = meta.some((m) => m.code !== null);
  if (!anyCode) {
    console.warn(
      "No color codes found in titles; falling back to geometry sort."
    );
    return sortByGeometry(images);
  }

  console.groupCollapsed("Sorting (color-code) – titles & codes");
  meta.forEach((m) => {
    console.log(m.title || m.img.id, "=>", m.code);
  });
  console.groupEnd();

  meta.sort((a, b) => {
    const ac = a.code;
    const bc = b.code;

    if (ac != null && bc != null) {
      if (ac !== bc) return ac - bc; // меньше код -> раньше
      return a.index - b.index;
    }
    if (ac != null) return -1;
    if (bc != null) return 1;
    return a.index - b.index;
  });

  return meta.map((m) => m.img);
}

/* ---------- SORTING: main handler ---------- */

async function handleSortingSubmit(event) {
  event.preventDefault();

  try {
    const form = document.getElementById("sorting-form");
    if (!form) return;

    const imagesPerRow = Number(form.sortingImagesPerRow.value) || 1;
    const horizontalGap = Number(form.sortingHorizontalGap.value) || 0;
    const verticalGap = Number(form.sortingVerticalGap.value) || 0;
    const sizeMode = form.sortingSizeMode.value;
    const startCorner = form.sortingStartCorner.value;

    const sortModeEl = document.getElementById("sortingSortMode");
    const sortMode = sortModeEl ? sortModeEl.value : "number";

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

    let orderedImages;

    if (sortMode === "color") {
      await board.notifications.showInfo("Sorting by color code…");
      orderedImages = await sortImagesByColor(images);
    } else {
      orderedImages = await sortImagesByNumber(images);
    }

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
 * Сортировка файлов по имени:
 *  - если хотя бы у одного файла есть числовой суффикс — сортируем, как раньше:
 *      сначала с числами (по числам), потом без (по алфавиту);
 *  - если НИ У ОДНОГО файла нет числа — просто рандомно перемешиваем.
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

  const anyHasNumber = arr.some((m) => m.hasNumber);

  if (!anyHasNumber) {
    // ни у одного файла нет числа в имени — просто рандом
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  } else {
    // стандартная сортировка с числами
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
  }

  return arr.map((m) => m.file);
}

/**
 * Stitch:
 *  - читаем выбранные файлы в dataURL,
 *  - считаем яркость и "ч/б/цвет" для нижних 80% картинки,
 *  - кодируем это в colorCode = [0/1][000..999],
 *  - сортируем/рандомим по имени (как раньше),
 *  - создаём картинки на доске с title: "Cxxxx originalName",
 *  - выравниваем без gap,
 *  - зумим в область.
 */
async function handleStitchSubmit(event) {
  event.preventDefault();

  const stitchButton = document.getElementById("stitchButton");
  const progressEl = document.getElementById("stitchProgress");

  try {
    const form = document.getElementById("stitch-form");
    if (!form) return;

    const imagesPerRow = Number(form.stitchImagesPerRow.value) || 1;
    const startCorner = form.stitchStartCorner.value;

    const input = document.getElementById("stitchFolderInput");
    const files = input ? input.files : null;

    if (!files || !files.length) {
      await board.notifications.showError(
        "Please choose one or more image files."
      );
      return;
    }

    if (imagesPerRow < 1) {
      await board.notifications.showError(
        "“Images per row” must be greater than 0."
      );
      return;
    }

    if (stitchButton) stitchButton.disabled = true;
    if (progressEl) progressEl.textContent = "Reading files…";

    const filesArray = Array.from(files);
    const fileInfos = [];

    // 1. читаем dataURL и считаем brightness + isGray + colorCode
    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];

      if (progressEl) {
        progressEl.textContent = `Processing ${i + 1} / ${filesArray.length}…`;
      }

      const dataUrl = await readFileAsDataUrl(file);

      let brightness = 0.5;
      let isGray = false;

      try {
        const imgEl = await loadImage(dataUrl);
        const res = getBrightnessAndGrayFromImageElement(imgEl);
        if (res) {
          brightness = res.brightness;
          isGray = res.isGray;
        }
      } catch (e) {
        console.warn(
          "Failed to compute brightness for stitched image:",
          file.name,
          e
        );
      }

      const brightnessCodeRaw = Math.round((1 - brightness) * 999); // 0..999
      const brightnessCode = Math.max(0, Math.min(999, brightnessCodeRaw));
      const colorFlag = isGray ? 0 : 1; // 0 – ч/б, 1 – цвет
      const colorCode = colorFlag * 1000 + brightnessCode; // 0..1999

      fileInfos.push({ file, dataUrl, brightness, isGray, colorCode });
    }

    // 2. порядок по имени/номеру (как раньше)
    if (progressEl) progressEl.textContent = "Ordering files…";

    const orderedFiles = sortFilesByNameWithNumber(filesArray);
    const infoByFile = new Map();
    fileInfos.forEach((info) => infoByFile.set(info.file, info));

    const orderedInfos = orderedFiles.map((f) => infoByFile.get(f));

    // 3. создаём виджеты
    if (progressEl) progressEl.textContent = "Creating images…";

    const createdImages = [];
    const baseX = 0;
    const baseY = 0;
    const offsetStep = 50;

    const padColor = (n) => String(n).padStart(4, "0");

    for (let i = 0; i < orderedInfos.length; i++) {
      const info = orderedInfos[i];
      const title = `C${padColor(info.colorCode)} ${info.file.name}`;

      if (progressEl) {
        progressEl.textContent = `Creating ${i + 1} / ${orderedInfos.length}…`;
      }

      const img = await board.createImage({
        url: info.dataUrl,
        x: baseX + (i % 5) * offsetStep,
        y: baseY + Math.floor(i / 5) * offsetStep,
        title,
      });

      createdImages.push(img);
    }

    if (progressEl) progressEl.textContent = "Aligning images…";

    await alignImagesInGivenOrder(createdImages, {
      imagesPerRow,
      horizontalGap: 0,
      verticalGap: 0,
      sizeMode: "none",
      startCorner,
    });

    try {
      await board.viewport.zoomTo(createdImages);
    } catch (e) {
      console.warn("zoomTo failed or not supported with items:", e);
    }

    if (progressEl) progressEl.textContent = "Done.";
    await board.notifications.showInfo(
      `Imported and stitched ${createdImages.length} image${
        createdImages.length === 1 ? "" : "s"
      }.`
    );
  } catch (err) {
    console.error(err);
    if (progressEl) progressEl.textContent = "Error.";
    await board.notifications.showError(
      "Something went wrong while importing images. Please check the console."
    );
  } finally {
    if (stitchButton) stitchButton.disabled = false;
  }
}

/* ---------- init ---------- */

window.addEventListener("DOMContentLoaded", () => {
  const sortingForm = document.getElementById("sorting-form");
  if (sortingForm) sortingForm.addEventListener("submit", handleSortingSubmit);

  const stitchForm = document.getElementById("stitch-form");
  if (stitchForm) stitchForm.addEventListener("submit", handleStitchSubmit);
});
