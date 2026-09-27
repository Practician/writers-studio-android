import test from "node:test";
import assert from "node:assert/strict";
import { keepQuotaOnlyBeat } from "../server/chapterGenerate";

// Живой прогон 27.09.2026: сцены 9 и 11 сгорели во всех трёх попытках на квоте
// молчаний, потолок которой был выбран ещё раньше, — и глава осталась без двух
// запланированных битов. Брак по квоте не должен стоить главе бита.

test("плановый бит с браком только по квоте реакций сохраняется", () => {
  assert.equal(keepQuotaOnlyBeat(1, false), true);
  assert.equal(keepQuotaOnlyBeat(3, false), true);
});

test("доборный бит за квоту по-прежнему выбрасывается: он сверх плана", () => {
  assert.equal(keepQuotaOnlyBeat(1, true), false);
  assert.equal(keepQuotaOnlyBeat(3, true), false);
});

test("без брака по квоте держать нечего", () => {
  assert.equal(keepQuotaOnlyBeat(0, false), false);
});
