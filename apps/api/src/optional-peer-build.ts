import type { chatObjectsEntryPlugin } from "./chat-objects-entry.ts";

/**
 * Optional peers declared by `agents` that this Worker neither installs nor
 * uses. `agents/skills` imports them for unused adapters; marking exactly these
 * externals side-effect-free lets tree shaking drop the unused imports while
 * keeping every used binding intact. If a binding were actually used, the
 * emitted bundle would still import the absent module, so the guard below fails
 * the build instead of shipping another module-not-found Worker.
 */
export const UNSUPPORTED_OPTIONAL_PEERS = ["ai", "@cloudflare/codemode", "just-bash"] as const;

const isUnsupportedOptionalPeer = (id: string): boolean =>
  (UNSUPPORTED_OPTIONAL_PEERS as readonly string[]).includes(id);

/** A surviving root or unsupported subpath of an absent optional peer. */
const isUnsupportedPeerSpecifier = (id: string): boolean =>
  (UNSUPPORTED_OPTIONAL_PEERS as readonly string[]).some(
    (peer) => id === peer || id.startsWith(`${peer}/`),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeArray = (value: unknown): value is unknown[] => Array.isArray(value);

const literalSource = (node: unknown): string | null => {
  if (!isRecord(node)) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type !== "TemplateLiteral" || !isNodeArray(node.expressions)) return null;
  if (node.expressions.length !== 0 || !isNodeArray(node.quasis)) return null;
  const quasi = node.quasis[0];
  if (!isRecord(quasi) || !isRecord(quasi.value)) return null;
  if (typeof quasi.value.cooked === "string") return quasi.value.cooked;
  return typeof quasi.value.raw === "string" ? quasi.value.raw : null;
};

/** Real import/re-export sources and literal dynamic imports from emitted code. */
const importSources = (program: unknown): string[] => {
  const sources = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ImportExpression"
    ) {
      const source = literalSource(node.source);
      if (source !== null) sources.add(source);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      visit(value);
    }
  };
  visit(program);
  return [...sources];
};

export const optionalPeerBuildPlugin = (): ReturnType<typeof chatObjectsEntryPlugin> => ({
  name: "starter:optional-peer-imports",
  resolveId(source: string) {
    return isUnsupportedOptionalPeer(source)
      ? { id: source, external: true, moduleSideEffects: false }
      : null;
  },
  generateBundle(_options, bundle) {
    const survivors = new Set<string>();
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== "chunk") continue;
      for (const source of importSources(this.parse(chunk.code))) {
        if (isUnsupportedPeerSpecifier(source)) survivors.add(`${chunk.fileName}:${source}`);
      }
    }
    if (survivors.size > 0) {
      throw new Error(
        `Worker bundle references absent optional peers: ${[...survivors].toSorted().join(", ")}`,
      );
    }
  },
});
