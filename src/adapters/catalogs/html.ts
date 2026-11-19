import { type DefaultTreeAdapterTypes, parse } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
export function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}
export function elements(node: Node, tag: string): DefaultTreeAdapterTypes.Element[] {
  const found: DefaultTreeAdapterTypes.Element[] = [];
  if ("tagName" in node && node.tagName === tag) found.push(node);
  for (const child of children(node)) found.push(...elements(child, tag));
  return found;
}
export function text(node: Node): string {
  if ("tagName" in node && ["script", "style", "noscript"].includes(node.tagName)) return "";
  if ("value" in node) return node.value;
  return children(node).map(text).join(" ").replace(/\s+/gu, " ").trim();
}
export function document(body: string) {
  return parse(body);
}
export interface Table {
  headers: string[];
  rows: { cells: string[]; codes: string[][] }[];
}
export function tables(body: string): Table[] {
  return elements(document(body), "table").map((table) => {
    const rows = elements(table, "tr").map((row) => {
      const cells = children(row).filter(
        (node): node is DefaultTreeAdapterTypes.Element =>
          "tagName" in node && ["th", "td"].includes(node.tagName),
      );
      return {
        cells: cells.map(text),
        codes: cells.map((cell) => elements(cell, "code").map(text)),
      };
    });
    return { headers: rows[0]?.cells ?? [], rows: rows.slice(1) };
  });
}
export function exactTable(body: string, headers: string[]): Table {
  const matches = tables(body).filter(
    (table) => JSON.stringify(table.headers) === JSON.stringify(headers),
  );
  if (matches.length !== 1 || !matches[0]?.rows.length)
    throw new Error(`Missing or ambiguous table: ${headers.join(" | ")}`);
  return matches[0];
}
