const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../src");

const methods = new Set();

function walk(dir) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);

    if (fs.statSync(full).isDirectory()) {
      walk(full);
      continue;
    }

    if (!/\.(ts|tsx)$/.test(full)) continue;

    const text = fs.readFileSync(full, "utf8");

    const regex = /callApi\(\s*['"`]([^'"`]+)['"`]/g;

    let match;
    while ((match = regex.exec(text))) {
      methods.add(match[1]);
    }
  }
}

walk(ROOT);

console.log([...methods].sort().join("\n"));