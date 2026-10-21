/**
 * Verified private-library reads for one conversation owner.
 *
 * The snapshot comes from the owner catalog route with the trusted owner
 * header; the actual owner scope is the catalog stub id, never a browser or
 * model argument. Every body is read completely from the private bucket, then
 * checked against its immutable size and digest before any text is decoded.
 * Skill identity is the authoritative filename; frontmatter metadata is
 * optional description enrichment, never an identity override.
 */
import type * as cf from "@cloudflare/workers-types";
import { parseSkillMarkdown } from "agents/skills";
import { decodeOption } from "./chat-internal.ts";
import type { SkillDocument } from "./chat-skills-document.ts";
import { verifySkillManifest } from "./skills-manifest.ts";
import { readSkillText, SkillObjectUnavailable } from "./skills-objects.ts";
import {
  MAX_SKILLS,
  MAX_SKILL_BYTES,
  SkillManifest,
  type SkillVersionRef,
} from "./skills-model.ts";

export class SkillLibraryError extends Error {
  readonly kind: "unavailable" | "integrity";
  constructor(kind: "unavailable" | "integrity", message: string) {
    super(message);
    this.name = "SkillLibraryError";
    this.kind = kind;
  }
}

export type SkillLibrary = {
  readonly manifest: SkillManifest;
  readonly documents: readonly SkillDocument[];
};

export type SkillLibrarySource = {
  /** Owner catalog stub; its id is the only accepted owner scope. */
  readonly catalog: cf.DurableObjectStub;
  /** Required only for a nonempty library; an empty verified library needs no bucket. */
  readonly bucket: cf.R2Bucket | null;
};

const MAX_LIBRARY_BYTES = MAX_SKILLS * MAX_SKILL_BYTES;

const fallbackDescription = (text: string): string => {
  for (const raw of text.split("\n")) {
    const line = raw
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/^[-*]\s+/, "");
    if (line.length > 0) return line;
  }
  return "";
};

const unwrap = (raw: unknown): unknown => {
  if (typeof raw === "object" && raw !== null && "ok" in raw) {
    if (Reflect.get(raw, "ok") !== true)
      throw new SkillLibraryError("unavailable", "The owner skill library is unavailable.");
    return Reflect.get(raw, "value");
  }
  return raw;
};

/**
 * Reads one immutable snapshot: latest when `revision` is absent, otherwise
 * exactly that revision or an explicit failure — never a silent fallback.
 */
export const loadSkillLibrary = async (
  source: SkillLibrarySource,
  ownerId: string,
  revision?: string,
): Promise<SkillLibrary> => {
  const expectedScope = source.catalog.id.toString();
  const query = revision === undefined ? "" : `?revision=${encodeURIComponent(revision)}`;
  let raw: unknown = null;
  try {
    const response = await source.catalog.fetch(`https://chat.internal/skills/snapshot${query}`, {
      method: "GET",
      headers: { accept: "application/json", "x-chat-owner": ownerId },
    });
    if (response.status !== 200)
      throw new SkillLibraryError("unavailable", "The owner skill library is unavailable.");
    raw = await response.json();
  } catch (error) {
    if (error instanceof SkillLibraryError) throw error;
    throw new SkillLibraryError("unavailable", "The owner skill library is unavailable.");
  }
  const manifest = decodeOption(SkillManifest, unwrap(raw));
  if (manifest === null)
    throw new SkillLibraryError("integrity", "The skill library manifest is invalid.");
  if (!(await verifySkillManifest(manifest, expectedScope)))
    throw new SkillLibraryError("integrity", "The skill library manifest failed verification.");
  if (manifest.files.length === 0) return { manifest, documents: [] };
  const bucket = source.bucket;
  if (bucket === null)
    throw new SkillLibraryError("unavailable", "The skill object store is unavailable.");
  const documents: SkillDocument[] = [];
  const names = new Set<string>();
  let loaded = 0;
  for (const file of manifest.files) {
    const text = await readSkillBody(bucket, expectedScope, file);
    loaded += new TextEncoder().encode(text).byteLength;
    if (loaded > MAX_LIBRARY_BYTES)
      throw new SkillLibraryError("integrity", "The skill library exceeds its byte budget.");
    const parsed = parseSkillMarkdown(text);
    // Exact authoritative filename: leading/trailing spaces are part of the
    // uploaded identity and must match the manifest/active binding verbatim.
    const name = file.filename;
    if (name.length === 0 || names.has(name))
      throw new SkillLibraryError("integrity", "A skill filename is empty or duplicated.");
    names.add(name);
    const description = (parsed?.description ?? fallbackDescription(text)).slice(0, 160);
    documents.push({ name, description, version: file.version, digest: file.digest, text });
  }
  return { manifest, documents };
};

/** Complete bytes, size, digest and strict UTF-8 — never a truncated success. */
export const readSkillBody = async (
  bucket: cf.R2Bucket,
  ownerScope: string,
  file: SkillVersionRef,
): Promise<string> => {
  if (file.byteSize > MAX_SKILL_BYTES)
    throw new SkillLibraryError("integrity", "A skill original exceeds its byte limit.");
  let text: string;
  try {
    // The shared integrity reader verifies size, digest and strict UTF-8.
    text = await readSkillText(bucket, ownerScope, file);
  } catch (error) {
    if (error instanceof SkillObjectUnavailable)
      throw new SkillLibraryError("integrity", "A pinned skill original failed verification.");
    throw error;
  }
  if (text.trim().length === 0)
    throw new SkillLibraryError("integrity", "A pinned skill original is empty.");
  return text;
};
