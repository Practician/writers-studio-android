import test from "node:test";
import assert from "node:assert/strict";
import { MARK_CARD_FALLBACK, MARK_CARD_GAP, MARK_CARD_MARGIN, placeMarkCard } from "../src/lib/markAnchor";

const AREA = { width: 360, height: 400 };
const CARD = { width: 304, height: 200 };

test("карточка встаёт под словом, когда снизу есть место", () => {
  const place = placeMarkCard({ top: 100, bottom: 120, left: 40 }, AREA, CARD);
  assert.equal(place.top, 120 + MARK_CARD_GAP);
  assert.equal(place.left, 40);
});

test("карточка переезжает над словом, когда снизу места нет", () => {
  const place = placeMarkCard({ top: 300, bottom: 320, left: 40 }, AREA, CARD);
  assert.equal(place.top, 300 - MARK_CARD_GAP - CARD.height);
  assert.ok(place.top + CARD.height <= AREA.height - MARK_CARD_MARGIN);
});

test("карточка не выходит за нижний край поля ни при каком слове", () => {
  for (let bottom = 20; bottom <= AREA.height; bottom += 10) {
    const word = { top: bottom - 20, bottom, left: 40 };
    for (const height of [120, 200, 280, 400]) {
      const card = { width: CARD.width, height };
      const place = placeMarkCard(word, AREA, card);
      const fitted = Math.min(height, AREA.height - MARK_CARD_MARGIN * 2);
      assert.ok(place.top >= MARK_CARD_MARGIN, `верх ${place.top} при слове ${bottom}`);
      assert.ok(
        place.top + fitted <= AREA.height - MARK_CARD_MARGIN,
        `высота ${height} при слове ${bottom}: низ ${place.top + fitted} > ${AREA.height - MARK_CARD_MARGIN}`,
      );
    }
  }
});

test("карточка выше поля ужимается по высоте поля", () => {
  const area = { width: 360, height: 300 };
  const place = placeMarkCard({ top: 100, bottom: 120, left: 40 }, area, { width: 304, height: 400 });
  const fitted = area.height - MARK_CARD_MARGIN * 2;
  assert.equal(place.top, MARK_CARD_MARGIN);
  assert.equal(place.top + fitted, area.height - MARK_CARD_MARGIN);
});

test("карточка не выходит за правый край поля", () => {
  const place = placeMarkCard({ top: 100, bottom: 120, left: 300 }, AREA, CARD);
  assert.equal(place.left, AREA.width - CARD.width - MARK_CARD_MARGIN);
});

test("карточка держится у левого края, если слово у самого края", () => {
  const place = placeMarkCard({ top: 100, bottom: 120, left: -20 }, AREA, CARD);
  assert.equal(place.left, MARK_CARD_MARGIN);
});

test("не измеренная карточка считается по запасу, а не по нулю", () => {
  const place = placeMarkCard({ top: 300, bottom: 320, left: 40 }, AREA, { width: 0, height: 0 });
  assert.equal(place.top, Math.max(MARK_CARD_MARGIN, 300 - MARK_CARD_GAP - MARK_CARD_FALLBACK.height));
  assert.ok(place.top + MARK_CARD_FALLBACK.height <= AREA.height - MARK_CARD_MARGIN);
});

test("нулевое поле не даёт отрицательных координат", () => {
  const place = placeMarkCard({ top: 0, bottom: 0, left: 0 }, { width: 0, height: 0 }, CARD);
  assert.equal(place.top, MARK_CARD_MARGIN);
  assert.equal(place.left, MARK_CARD_MARGIN);
});
