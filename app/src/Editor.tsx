import { useCallback, useEffect, useRef, useState } from "react";
import { CrdtClient } from "@frontend/crdtClient";
import { Undo2, Redo2 } from "lucide-react";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const DOC_ID = "default";

function getOrCreateSiteId(): string {
  let id = localStorage.getItem("skepsi_site_id");
  if (!id) {
    id = "site-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("skepsi_site_id", id);
  }
  return id;
}

export default function Editor() {
  const [, setRefresh] = useState(0);
  const clientRef = useRef<CrdtClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const siteId = getOrCreateSiteId();
    const siteBias = Math.floor(Math.random() * 100);
    const client = new CrdtClient({
      url: WS_URL,
      docId: DOC_ID,
      siteId,
      siteBias,
      onStateChange: () => {
        setRefresh((n) => n + 1);
        if (clientRef.current)
          cursorRef.current = clientRef.current.getCursorIndex();
      },
    });
    clientRef.current = client;
    cursorRef.current = 0;
    client.connect();
    setRefresh((n) => n + 1);
    const t = setTimeout(() => setConnected(true), 400);
    return () => {
      clearTimeout(t);
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  const client = clientRef.current;
  const text = client?.getVisibleText() ?? "";
  const canUndo = client?.canUndo() ?? false;
  const canRedo = client?.canRedo() ?? false;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== cursorIndex || ta.selectionEnd !== cursorIndex) {
      ta.setSelectionRange(cursorIndex, cursorIndex);
    }
  }, [text, cursorIndex]);

  const syncCursorFromClient = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const idx = client.getCursorIndex();
    cursorRef.current = idx;
    setCursorIndex(idx);
    const ta = textareaRef.current;
    if (ta) ta.setSelectionRange(idx, idx);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const client = clientRef.current;
      if (!client) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (client.redo()) setRefresh((n) => n + 1);
        } else {
          if (client.undo()) setRefresh((n) => n + 1);
        }
        syncCursorFromClient();
      }
    },
    [syncCursorFromClient],
  );

  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    const client = clientRef.current;
    if (!ta || !client) return;
    const start = ta.selectionStart;
    client.setCursorIndex(start);
    cursorRef.current = start;
    setCursorIndex(start);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const client = clientRef.current;
      if (!client) return;

      const newVal = e.target.value;
      const oldVal = client.getVisibleText();
      const ta = textareaRef.current;

      let start = 0;
      while (
        start < oldVal.length &&
        start < newVal.length &&
        oldVal[start] === newVal[start]
      ) {
        start++;
      }

      let oldEnd = oldVal.length - 1;
      let newEnd = newVal.length - 1;
      while (
        oldEnd >= start &&
        newEnd >= start &&
        oldVal[oldEnd] === newVal[newEnd]
      ) {
        oldEnd--;
        newEnd--;
      }

      const deleted = oldVal.slice(start, oldEnd + 1);
      const inserted = newVal.slice(start, newEnd + 1);

      if (deleted.length > 0) {
        const positions = client.getVisibleState().getPositions();
        const posToDelete = [];
        for (let i = start; i <= oldEnd; i++) {
          if (positions[i]) posToDelete.push(positions[i]);
        }
        for (const pos of posToDelete) {
          client.deleteAtPosition(pos);
        }
      }

      if (inserted.length > 0) {
        for (let i = 0; i < inserted.length; i++) {
          client.insertAt(start + i, inserted[i]);
        }
      }

      if (ta) {
        const cursor = ta.selectionStart;
        client.setCursorIndex(cursor);
        cursorRef.current = cursor;
        setCursorIndex(cursor);
      }
      setRefresh((n) => n + 1);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (clientRef.current?.undo()) setRefresh((n) => n + 1);
    syncCursorFromClient();
  }, [syncCursorFromClient]);

  const handleRedo = useCallback(() => {
    if (clientRef.current?.redo()) setRefresh((n) => n + 1);
    syncCursorFromClient();
  }, [syncCursorFromClient]);

  return (
    <div className="doc-wrap">
      <div className="toolbar">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo"
          style={{ cursor: "pointer" }}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo"
          style={{ cursor: "pointer" }}
        >
          <Redo2 size={14} />
        </button>
      </div>
      <div className="editor-area">
        <textarea
          ref={textareaRef}
          key="editor"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          placeholder="Start typing…"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
