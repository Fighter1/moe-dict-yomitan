// The little HTML the 兩岸詞典 sheet has in its definitions: a handful of tables, and inline
// <sup>, <sub>, <u>, <font> and <span style> in formulas and typography examples.
import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import type { StructuredContentNode, StructuredContentStyle } from "./content.ts";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// what Yomitan's structured content accepts in `style`
const STYLE_PROPERTIES = new Set([
  "fontStyle", "fontWeight", "fontSize", "color", "background", "backgroundColor",
  "textDecorationLine", "textDecorationStyle", "textDecorationColor",
  "borderColor", "borderStyle", "borderRadius", "borderWidth", "clipPath",
  "verticalAlign", "textAlign", "textEmphasis", "textShadow",
  "margin", "marginTop", "marginLeft", "marginRight", "marginBottom",
  "padding", "paddingTop", "paddingLeft", "paddingRight", "paddingBottom",
  "wordBreak", "whiteSpace", "cursor", "listStyleType",
]);

function parseStyle(css: string): StructuredContentStyle | undefined {
  const style: Record<string, string> = {};
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":"); // the value may contain colons itself
    if (colon < 0) continue;
    let property = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const value = declaration.slice(colon + 1).trim();
    if (property === "textDecoration") property = "textDecorationLine";
    if (value && STYLE_PROPERTIES.has(property)) style[property] = value;
  }
  return Object.keys(style).length ? (style as StructuredContentStyle) : undefined;
}

const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

function convert(node: Node, inTable = false): StructuredContentNode[] {
  if (node.nodeType === TEXT_NODE) {
    const text = node.textContent ?? "";
    // the line breaks and indentation between rows and cells are not content
    return text && !(inTable && !text.trim()) ? [text] : [];
  }
  if (node.nodeType !== ELEMENT_NODE) return []; // comments and the like
  const element = node as Element;
  const tag = element.nodeName.toLowerCase();
  const children = (childInTable = false) => Array.from(element.childNodes).flatMap((child) => convert(child, childInTable));
  const style = parseStyle(element.getAttribute("style") ?? "");
  if (TABLE_PARTS.has(tag))
    return [{ tag: tag as "table", content: children(true), data: { moedict: `table-${tag}` }, lang: "zh-TW" }];
  if (tag === "td" || tag === "th") {
    const span = (name: string) => {
      const n = Number(element.getAttribute(name));
      return n > 1 ? n : undefined;
    };
    const [colSpan, rowSpan] = [span("colspan"), span("rowspan")];
    return [
      {
        tag,
        content: children(),
        ...(style && { style }),
        ...(colSpan && { colSpan }),
        ...(rowSpan && { rowSpan }),
        data: { moedict: `table-${tag}` },
        lang: "zh-TW",
      },
    ];
  }
  if (tag === "br") return [{ tag: "br" }];
  if (tag === "sup" || tag === "sub")
    return [{ tag: "span", content: children(), style: { verticalAlign: tag === "sup" ? "super" : "sub", fontSize: "0.75em" } }];
  if (tag === "u") return [{ tag: "span", content: children(), style: { textDecorationLine: "underline" } }];
  // <font>, <span> and anything else: keep the text, and the style if it has one Yomitan accepts
  return style ? [{ tag: "span", content: children(), style }] : children();
}

/** An HTML fragment as structured content. Markup that cannot be parsed is dropped, the text kept. */
export function htmlToContent(html: string): StructuredContentNode[] {
  try {
    const document = new DOMParser({ onError: () => {} }).parseFromString(`<span>${html}</span>`, "text/html");
    const root = document.childNodes.item(0);
    if (root) return Array.from(root.childNodes).flatMap((child) => convert(child));
  } catch {
    // not well-formed enough for the parser
  }
  return [html.replace(/<[^>]*>/g, "")];
}

/** Text that may contain inline HTML: the text itself when it has no tags. */
export function inlineHtml(text: string): StructuredContentNode {
  if (!/<[a-zA-Z/]/.test(text)) return text;
  const content = htmlToContent(text);
  return content.length === 1 ? content[0]! : content;
}
