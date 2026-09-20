import * as A from "../src/lib/adaptiveDetector.ts";
import * as B from "../src/lib/authorAudit.ts";
import { LABYRINTH_ADAPTIVE_DETECTOR_SEED as SEED } from "../src/data/labyrinth/adaptive-detector-seed.ts";
console.log("adaptiveDetector exports:", Object.keys(A).join(", "));
console.log("authorAudit exports:", Object.keys(B).join(", "));
console.log("seed type:", Array.isArray(SEED) ? `array len=${SEED.length}` : typeof SEED, JSON.stringify(SEED).slice(0, 900));
