import { useState } from "react";
import { generateDocId, setDocIdInUrl, parseDocIdFromUrl } from "./useDocId";

export default function Landing() {
  const [pasteUrl, setPasteUrl] = useState("");

  const handleNewLecture = () => {
    const id = generateDocId();
    setDocIdInUrl(id);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseDocIdFromUrl(pasteUrl.trim());
    if (id) {
      setDocIdInUrl(id);
    }
  };

  return (
    <div className="landing">
      <div className="landing-card">
        <h1>Skepsi</h1>
        <p className="landing-subtitle">Live collaborative notes for lectures</p>
        <div className="landing-actions">
          <button type="button" className="landing-btn primary" onClick={handleNewLecture}>
            New lecture
          </button>
          <form onSubmit={handleJoin} className="landing-join">
            <input
              type="url"
              placeholder="Paste link to join…"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              className="landing-input"
            />
            <button type="submit" className="landing-btn" disabled={!pasteUrl.trim()}>
              Join
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
