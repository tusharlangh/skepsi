import Editor from "./Editor";
import Landing from "./Landing";
import { useDocIdOrNull } from "./useDocId";

export default function App() {
  const docId = useDocIdOrNull();

  return (
    <div className="app">
      {docId ? <Editor docId={docId} /> : <Landing />}
    </div>
  );
}
