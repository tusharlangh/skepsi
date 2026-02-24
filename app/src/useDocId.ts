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

export function parseDocIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
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
