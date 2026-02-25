import { useEffect, useState } from "react";

export const DOC_PATH_PREFIX = "#/doc/";

export function generateDocId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function getDocIdFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith(DOC_PATH_PREFIX)) return null;
  const id = hash.slice(DOC_PATH_PREFIX.length).split("/")[0];
  return id && /^[a-z0-9-]+$/i.test(id) ? id : null;
}

export function setDocIdInUrl(docId: string): void {
  const newHash = DOC_PATH_PREFIX + docId;
  const hashValue = newHash.startsWith("#") ? newHash.slice(1) : newHash;
  if (window.location.hash !== newHash) {
    window.location.hash = hashValue;
  }
}

/** Clears the doc from the URL and returns to the landing page. */
export function clearDocIdFromUrl(): void {
  window.location.hash = "";
}

export function parseDocIdFromUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    // Handle relative URLs (e.g. "#/doc/abc123" or "/#/doc/abc123")
    const parsed = trimmed.startsWith("http")
      ? new URL(trimmed)
      : new URL(trimmed, window.location.origin);
    const hash = parsed.hash;
    if (!hash.startsWith(DOC_PATH_PREFIX)) return null;
    const id = hash.slice(DOC_PATH_PREFIX.length).split("/")[0];
    return id && /^[a-z0-9-]+$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Returns the doc ID from the URL, or null if none. Uses hash routing: /#/doc/abc123
 */
export function useDocIdOrNull(): string | null {
  const [docId, setDocId] = useState<string | null>(() => getDocIdFromHash());

  useEffect(() => {
    const handleHashChange = () => setDocId(getDocIdFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return docId;
}

/**
 * Returns the current doc ID. Only use when docId is known to exist (e.g. inside Editor).
 */
export function useDocId(): string {
  const docId = useDocIdOrNull();
  if (!docId) throw new Error("useDocId called but no doc in URL");
  return docId;
}
