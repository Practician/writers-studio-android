import fs from "node:fs";

const sources = [
  ["src/data/labyrinth/world-bible-user.txt", "src/data/labyrinth/world-bible-user.content.ts"],
  ["src/data/labyrinth/book-plan-20-user.txt", "src/data/labyrinth/book-plan-20-user.content.ts"],
];

for (const [input, output] of sources) {
  const text = fs.readFileSync(input, "utf8").trim();
  fs.writeFileSync(output, `const text = ${JSON.stringify(text)};\nexport default text;\n`, "utf8");
  console.log(`Embedded ${input} → ${output}`);
}
