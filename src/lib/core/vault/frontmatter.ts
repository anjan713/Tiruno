// Minimal, dependency-free frontmatter (YAML-subset) parser/serializer.
// Supports strings, numbers, booleans, and flat arrays of scalars — enough for
// tags, versions, scores, and timestamps. Keeps the Vault free of a YAML dep.

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  content: string;
}

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // Strip surrounding quotes if present.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseFrontmatter(raw: string): ParsedNote {
  if (!raw.startsWith("---")) return { frontmatter: {}, content: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, content: raw };

  const header = raw.slice(3, end).trim();
  const content = raw.slice(end + 4).replace(/^\r?\n/, "");
  const frontmatter: Record<string, unknown> = {};

  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    const val = valRaw.trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      frontmatter[key] = inner ? inner.split(",").map((s) => parseScalar(s)) : [];
    } else {
      frontmatter[key] = parseScalar(val);
    }
  }
  return { frontmatter, content };
}

function serializeScalar(v: unknown): string {
  if (typeof v === "string") {
    // Quote strings that could be misread (contain :, #, leading/trailing space).
    return /[:#]|^\s|\s$/.test(v) ? JSON.stringify(v) : v;
  }
  return String(v);
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, content: string): string {
  const keys = Object.keys(frontmatter);
  if (keys.length === 0) return content.endsWith("\n") ? content : content + "\n";

  const lines = keys.map((k) => {
    const v = frontmatter[k];
    if (Array.isArray(v)) return `${k}: [${v.map(serializeScalar).join(", ")}]`;
    return `${k}: ${serializeScalar(v)}`;
  });
  const body = content.endsWith("\n") ? content : content + "\n";
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}
