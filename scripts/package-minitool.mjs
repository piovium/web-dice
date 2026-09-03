import { cp, readdir, rm, readFile, rename } from "fs/promises";
import { createWriteStream } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ZipArchive } from "archiver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = resolve(root, "apps", "minitool");
const dist = resolve(appDir, "dist-minitool");
const outZip = resolve(root, "dice-minitool.zip");

async function main() {
  // 1. 复制小红书小工具入口 HTML，并改名为 index.html
  await cp(resolve(appDir, "index.html"), resolve(dist, "index.html"), {
    force: true,
  });

  // 2. 骰面图标已由 gi-dice-oimo 包内联为 data URL，无需再拷贝 assets

  // 3. 整理构建产物：删除垃圾文件，并把 CSS 重命名为 style.css
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  for (const f of files) {
    if (!f.isFile()) continue;
    const fullPath = resolve(dist, f.parentPath ?? f.path, f.name);
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".map") || lower === ".ds_store") {
      await rm(fullPath);
    } else if (lower.endsWith(".css") && f.name !== "style.css") {
      await rename(fullPath, resolve(dist, f.parentPath ?? f.path, "style.css"));
    }
  }

  // 4. 校验产物中无禁用模式
  const html = await readFile(resolve(dist, "index.html"), "utf8");
  const js = await readFile(resolve(dist, "app.js"), "utf8");
  const forbidden = [
    /type\s*=\s*["']module["']/,
    /\bimport\b/,
    /\bexport\b/,
    /eval\s*\(/,
    /new\s+Function\s*\(/,
    /WebAssembly\./,
    /fetch\s*\(/,
    /XMLHttpRequest/,
    /https?:\/\/(?!www\.w3\.org)/,
    /<base\s+href/,
    /<iframe/,
    /<object/,
  ];
  for (const re of forbidden) {
    if (re.test(html) || re.test(js)) {
      throw new Error(`小红书小工具产物命中禁用模式: ${re}`);
    }
  }

  // 5. 打包 zip（压缩的是目录内容，不是目录本身）
  const output = createWriteStream(outZip);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("warning", (err) => {
    if (err.code === "ENOENT") console.warn(err);
    else throw err;
  });
  archive.on("error", (err) => {
    throw err;
  });
  archive.pipe(output);
  archive.directory(dist, false);
  await archive.finalize();

  console.log("产物路径:", outZip);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
