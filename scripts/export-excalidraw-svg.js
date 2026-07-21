const fs = require("fs");
const path = require("path");
const LZString = require("./vendor/lz-string.min.js");

const escapeXml = value => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function decodeDrawing(file) {
  const source = fs.readFileSync(file, "utf8");
  const block = source.match(/```compressed-json\s*([\s\S]*?)```/);
  if (!block) throw new Error(`No compressed-json block: ${file}`);
  const decoded = LZString.decompressFromBase64(block[1].replace(/\s+/g, ""));
  if (!decoded) throw new Error(`Unable to decompress: ${file}`);
  return JSON.parse(decoded);
}

function dashArray(element) {
  if (element.strokeStyle === "dashed") return `${element.strokeWidth * 5} ${element.strokeWidth * 4}`;
  if (element.strokeStyle === "dotted") return `${element.strokeWidth} ${element.strokeWidth * 3}`;
  return "";
}

function rotation(element) {
  if (!element.angle) return "";
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  return ` transform="rotate(${element.angle * 180 / Math.PI} ${cx} ${cy})"`;
}

function commonStyle(element) {
  const dash = dashArray(element);
  return `stroke="${escapeXml(element.strokeColor || "#1e1e1e")}" stroke-width="${element.strokeWidth || 1}"${dash ? ` stroke-dasharray="${dash}"` : ""} opacity="${(element.opacity ?? 100) / 100}"`;
}

function renderElement(element, markerId) {
  const fill = !element.backgroundColor || element.backgroundColor === "transparent" ? "none" : element.backgroundColor;
  if (element.type === "rectangle") {
    const radius = element.roundness ? Math.min(10, element.width / 10, element.height / 4) : 0;
    return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeXml(fill)}" ${commonStyle(element)}${rotation(element)}/>`;
  }
  if (element.type === "ellipse") {
    return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${Math.abs(element.width / 2)}" ry="${Math.abs(element.height / 2)}" fill="${escapeXml(fill)}" ${commonStyle(element)}${rotation(element)}/>`;
  }
  if (element.type === "diamond") {
    const cx = element.x + element.width / 2, cy = element.y + element.height / 2;
    const points = `${cx},${element.y} ${element.x + element.width},${cy} ${cx},${element.y + element.height} ${element.x},${cy}`;
    return `<polygon points="${points}" fill="${escapeXml(fill)}" ${commonStyle(element)}${rotation(element)}/>`;
  }
  if (["arrow", "line", "freedraw"].includes(element.type)) {
    const points = (element.points || []).map(point => `${element.x + point[0]},${element.y + point[1]}`).join(" ");
    const markerStart = element.startArrowhead ? ` marker-start="url(#${markerId}-start)"` : "";
    const markerEnd = element.endArrowhead ? ` marker-end="url(#${markerId}-end)"` : "";
    return `<polyline points="${points}" fill="none" ${commonStyle(element)} stroke-linecap="round" stroke-linejoin="round"${markerStart}${markerEnd}${rotation(element)}/>`;
  }
  if (element.type === "text") {
    const lines = (element.text || "").split("\n");
    const fontSize = element.fontSize || 20;
    const lineHeight = fontSize * (element.lineHeight || 1.25);
    const anchor = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
    const x = anchor === "middle" ? element.x + element.width / 2 : anchor === "end" ? element.x + element.width : element.x;
    const totalHeight = lineHeight * lines.length;
    const firstY = element.y + element.height / 2 - totalHeight / 2 + lineHeight / 2;
    const family = element.fontFamily === 3 ? "Cascadia Code, Consolas, monospace" : "Arial, Noto Sans SC, Microsoft YaHei, sans-serif";
    const tspans = lines.map((line, index) => `<tspan x="${x}" y="${firstY + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
    return `<text text-anchor="${anchor}" dominant-baseline="middle" font-family="${escapeXml(family)}" font-size="${fontSize}" fill="${escapeXml(element.strokeColor || "#1e1e1e")}" opacity="${(element.opacity ?? 100) / 100}"${rotation(element)}>${tspans}</text>`;
  }
  throw new Error(`Unsupported Excalidraw element type: ${element.type}`);
}

function exportSvg(sourceFile) {
  const drawing = decodeDrawing(sourceFile);
  const elements = drawing.elements.filter(element => !element.isDeleted);
  const supported = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "freedraw", "text"]);
  const unsupported = [...new Set(elements.filter(element => !supported.has(element.type)).map(element => element.type))];
  if (unsupported.length) throw new Error(`Unsupported types: ${unsupported.join(", ")}`);

  const bounds = elements.flatMap(element => {
    if (element.points?.length) return element.points.map(point => [element.x + point[0], element.y + point[1]]);
    return [[element.x, element.y], [element.x + element.width, element.y + element.height]];
  });
  const padding = 24;
  const minX = Math.min(...bounds.map(point => point[0])) - padding;
  const minY = Math.min(...bounds.map(point => point[1])) - padding;
  const maxX = Math.max(...bounds.map(point => point[0])) + padding;
  const maxY = Math.max(...bounds.map(point => point[1])) + padding;
  const width = maxX - minX, height = maxY - minY;
  const background = drawing.appState?.viewBackgroundColor || "#ffffff";
  const markers = elements.filter(element => element.type === "arrow").map((element, index) => {
    const id = `arrow-${index}`;
    const color = escapeXml(element.strokeColor || "#1e1e1e");
    return `<marker id="${id}-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="${color}"/></marker><marker id="${id}-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="${color}"/></marker>`;
  }).join("");
  let arrowIndex = 0;
  const content = elements.map(element => {
    const id = element.type === "arrow" ? `arrow-${arrowIndex++}` : "arrow-0";
    return renderElement(element, id);
  }).join("\n  ");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="Excalidraw diagram">\n  <defs>${markers}</defs>\n  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${escapeXml(background)}"/>\n  ${content}\n</svg>\n`;
  const outputFile = sourceFile.replace(/\.md$/i, ".svg");
  fs.writeFileSync(outputFile, svg, "utf8");
  return { outputFile, elements: elements.length, width, height };
}

const input = process.argv[2];
if (!input) throw new Error("Pass an .excalidraw.md file path");
const absolute = path.resolve(input);
const result = exportSvg(absolute);
console.log(JSON.stringify(result));
