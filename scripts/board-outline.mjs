// Text outline of an Excalidraw scene for agents that cannot see the board.
// outline() is a pure function over parsed JSON (no I/O) so it ports to Go as is.

const SHAPES = new Set(["rectangle", "diamond", "ellipse", "embeddable", "iframe"]);
const KIND = { rectangle: "box", diamond: "diamond", ellipse: "ellipse", embeddable: "embed", iframe: "embed" };
const TYPE_ORDER = ["frame", "magicframe", "rectangle", "diamond", "ellipse", "embeddable", "iframe", "arrow", "line", "text", "freedraw", "image"];
const REGIONS = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];
const NEAR_PX = 40;
const BAND_PX = 40;

const oneLine = (s) => String(s).split("\n").join(" / ");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function readingOrder(a, b) {
  return Math.floor(a.y / BAND_PX) - Math.floor(b.y / BAND_PX) || a.x - b.x || cmp(a.id, b.id);
}

function endpoints(el) {
  const pts = el.points && el.points.length ? el.points : [[0, 0], [el.width || 0, el.height || 0]];
  const first = pts[0];
  const last = pts[pts.length - 1];
  return [
    { x: el.x + first[0], y: el.y + first[1] },
    { x: el.x + last[0], y: el.y + last[1] },
  ];
}

function distToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

export function outline(scene, title) {
  const all = (scene && scene.elements) || [];
  const live = all.filter((e) => !e.isDeleted);
  const deleted = all.length - live.length;
  const lines = [`# ${title}`, ""];

  if (live.length === 0) {
    lines.push(`Empty board. 0 elements, ${deleted} deleted ignored.`);
    return lines.join("\n") + "\n";
  }

  const minX = Math.min(...live.map((e) => e.x));
  const minY = Math.min(...live.map((e) => e.y));
  const maxX = Math.max(...live.map((e) => e.x + e.width));
  const maxY = Math.max(...live.map((e) => e.y + e.height));
  const W = maxX - minX;
  const H = maxY - minY;
  const cell = (v, min, size) => (size <= 0 ? 0 : Math.min(2, Math.max(0, Math.floor((3 * (v - min)) / size))));
  const regionOfPoint = (p) => REGIONS[cell(p.y, minY, H)][cell(p.x, minX, W)];
  const regionOf = (e) => regionOfPoint({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

  const counts = {};
  for (const e of live) counts[e.type] = (counts[e.type] || 0) + 1;
  const types = Object.keys(counts).sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a);
    const ib = TYPE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || cmp(a, b);
  });
  lines.push(
    `Canvas ${Math.round(W)} x ${Math.round(H)} px. ${live.length} elements: ` +
      types.map((t) => `${counts[t]} ${t}`).join(", ") +
      `. ${deleted} deleted ignored.`,
  );

  const byId = new Map(live.map((e) => [e.id, e]));
  const labelOf = new Map(); // container id -> label text
  for (const e of live) {
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) labelOf.set(e.containerId, e);
  }
  const label = (id) => (labelOf.has(id) ? oneLine(labelOf.get(id).text) : "");

  // Nodes: shapes get refs in reading order; images are connectable but listed under pictures.
  const shapes = live.filter((e) => SHAPES.has(e.type)).sort(readingOrder);
  const refOf = new Map(shapes.map((e, i) => [e.id, `n${i + 1}`]));
  const nameOf = (e) => {
    if (e.type === "image") return `image ${e.fileId || e.id}`;
    return label(e.id) || refOf.get(e.id);
  };
  const connectable = live.filter((e) => SHAPES.has(e.type) || e.type === "image").sort(readingOrder);

  const groupNo = new Map();
  for (const e of shapes) {
    const g = e.groupIds && e.groupIds.length ? e.groupIds[e.groupIds.length - 1] : null;
    if (g && !groupNo.has(g)) groupNo.set(g, groupNo.size + 1);
  }

  const frames = live.filter((e) => e.type === "frame" || e.type === "magicframe").sort(readingOrder);
  const looseTexts = live
    .filter((e) => e.type === "text" && !(e.containerId && byId.has(e.containerId)))
    .sort(readingOrder);

  if (frames.length) {
    lines.push("", "## Sections", "");
    for (const f of frames) {
      const inside = (e) => e.frameId === f.id;
      const members = [
        ...shapes.filter(inside).map(nameOf),
        ...looseTexts.filter(inside).map((t) => `"${oneLine(t.text)}"`),
      ];
      const name = f.name || "(unnamed)";
      lines.push(
        `- ${name}: ${regionOf(f)}, ${Math.round(f.width)} x ${Math.round(f.height)} px at (${Math.round(f.x)}, ${Math.round(f.y)})` +
          (members.length ? `; contains ${members.join(", ")}` : "; empty"),
      );
    }
  }

  if (shapes.length) {
    lines.push("", "## Nodes", "");
    for (const e of shapes) {
      const lab = label(e.id);
      const parts = [KIND[e.type], regionOf(e)];
      if (e.groupIds && e.groupIds.length) parts.push(`group ${groupNo.get(e.groupIds[e.groupIds.length - 1])}`);
      if (e.link) parts.push(`link ${e.link}`);
      const head = lab ? `${lab} (${refOf.get(e.id)})` : refOf.get(e.id);
      lines.push(`- ${head}: ${parts.join(", ")}`);
    }
  }

  const links = live.filter((e) => e.type === "arrow" || e.type === "line").sort(readingOrder);
  if (links.length) {
    lines.push("", "## Connections", "");
    for (const a of links) {
      const ends = endpoints(a);
      const bindings = [a.startBinding, a.endBinding];
      const [from, to] = ends.map((p, i) => {
        const bound = bindings[i] && byId.get(bindings[i].elementId);
        if (bound && connectable.includes(bound)) return nameOf(bound);
        let best = null;
        let bestD = Infinity;
        for (const n of connectable) {
          const d = distToRect(p, n);
          if (d <= NEAR_PX && d < bestD) {
            best = n;
            bestD = d;
          }
        }
        return best ? `${nameOf(best)}~` : `(loose end at ${regionOfPoint(p)})`;
      });
      const s = a.type === "arrow" && a.startArrowhead;
      const e = a.type === "arrow" && a.endArrowhead;
      const op = s && e ? "<->" : e ? "->" : s ? "<-" : "--";
      const lab = label(a.id);
      lines.push(`- ${from} ${op} ${to}` + (lab ? ` "${lab}"` : ""));
    }
  }

  if (looseTexts.length) {
    lines.push("", "## Text", "");
    for (const t of looseTexts) {
      lines.push(`- "${oneLine(t.text)}": ${regionOf(t)}` + (t.link ? `, link ${t.link}` : ""));
    }
  }

  const pictures = live.filter((e) => e.type === "freedraw" || e.type === "image").sort(readingOrder);
  if (pictures.length) {
    lines.push("", "## Needs a picture", "", "These cannot be read from the text; look at a rendering of the board.", "");
    for (const p of pictures) {
      const kind = p.type === "image" ? `image ${p.fileId || p.id}` : "freehand sketch";
      lines.push(`- ${kind}: ${Math.round(p.width)} x ${Math.round(p.height)} px, ${regionOf(p)}`);
    }
  }

  return lines.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const { basename, extname } = await import("node:path");
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node board-outline.mjs <file.excalidraw>");
    process.exit(2);
  }
  process.stdout.write(outline(JSON.parse(readFileSync(file, "utf8")), basename(file, extname(file))));
}
