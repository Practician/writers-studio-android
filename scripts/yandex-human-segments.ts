import fs from "node:fs";

const file = process.argv[2]!;
const text = fs.readFileSync(file, "utf8");
const res = await fetch("https://yandex.ru/lab/neurodetector/api/analyze/text", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://yandex.ru",
    Referer: "https://yandex.ru/lab/neurodetector",
    "User-Agent": "Mozilla/5.0",
  },
  body: JSON.stringify({ text }),
});
const d = await res.json();
const segs = (d.results || d).segments || [];
for (const s of segs) {
  if (s.label === "HUMAN" || s.label === "LIKELY_HUMAN") {
    console.log("===", s.label, "===");
    console.log(s.text);
    console.log();
  }
}
console.log(
  "all labels",
  segs.reduce((a: any, s: any) => {
    a[s.label] = (a[s.label] || 0) + 1;
    return a;
  }, {}),
);
