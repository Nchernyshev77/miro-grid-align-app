/**
 * Сортировка по среднему цвету:
 *  - цветные (s >= threshold) идут первыми, по hue (0..360)
 *  - серые / почти серые (s < threshold) — в конце, по lightness
 * Если ни у одной картинки не получилось получить URL/цвет,
 * делаем fallback на sortByGeometry.
 */
async function sortImagesByColor(images) {
  const meta = [];

  for (const imgItem of images) {
    // Главное изменение: пробуем и url, и contentUrl
    const url = imgItem.url || imgItem.contentUrl;
    if (!url) {
      console.warn("No image URL (url/contentUrl) for image:", imgItem.id);
      continue;
    }

    try {
      const img = await loadImage(url);
      const avg = getAverageColorFromImageElement(img);
      if (!avg) {
        console.warn("Failed to compute color, fallback neutral:", imgItem.id);
        meta.push({
          img: imgItem,
          h: 0,
          s: 0,
          l: 0.5,
        });
        continue;
      }
      const { h, s, l } = rgbToHsl(avg.r, avg.g, avg.b);
      meta.push({ img: imgItem, h, s, l });
    } catch (e) {
      console.error("Error reading image for color sort", imgItem.id, e);
      meta.push({
        img: imgItem,
        h: 0,
        s: 0,
        l: 0.5,
      });
    }
  }

  // Если вообще ни у кого не получилось получить цвет —
  // не падаем, а сортируем по геометрии
  if (!meta.length) {
    console.warn(
      "Could not compute colors for any image, falling back to geometry sort."
    );
    return sortByGeometry(images);
  }

  console.groupCollapsed("Sorting (color) – HSL");
  meta.forEach((m) => {
    console.log(
      m.img.title || m.img.id,
      "=>",
      `h=${m.h.toFixed(1)}, s=${m.s.toFixed(2)}, l=${m.l.toFixed(2)}`
    );
  });
  console.groupEnd();

  const SAT_GRAY_THRESHOLD = 0.1;

  meta.sort((a, b) => {
    const aGray = a.s < SAT_GRAY_THRESHOLD;
    const bGray = b.s < SAT_GRAY_THRESHOLD;

    // цветные сначала, серые потом
    if (aGray && !bGray) return 1;
    if (!aGray && bGray) return -1;

    if (!aGray && !bGray) {
      // оба цветные => по hue, потом по lightness
      if (a.h !== b.h) return a.h - b.h;
      return a.l - b.l;
    }

    // оба серые => по lightness
    return a.l - b.l;
  });

  return meta.map((m) => m.img);
}
