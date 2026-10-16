import { Excalidraw, getSceneVersion, restore, serializeAsJSON, THEME } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { createAutosave, type Autosave, type SaveStatus } from "./autosave";
import type { Ref } from "./types";

type Loaded = { scene: ExcalidrawInitialDataState; rev: string; version: number };
type Load = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; autosave: Autosave };

const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false } };

// Adding an image can leave every element version unchanged, so the file count is folded in.
const sceneVersion = (elements: Parameters<typeof getSceneVersion>[0], files: object) =>
  getSceneVersion(elements) + Object.keys(files).length * 1e9;

async function loadBoard(ref: Ref): Promise<Loaded> {
  const { json, rev } = await api.getBoard(ref);
  const restored = restore(JSON.parse(json), null, null);
  return { scene: restored, rev, version: sceneVersion(restored.elements, restored.files) };
}

/** Remounting through `generation` is how "Load theirs" and "Retry" reset the scene and the autosave baseline. */
// Not `ref`: React 18 strips that prop from function components.
export default function Editor({ board }: { board: Ref }) {
  const [generation, setGeneration] = useState(0);
  return <Board key={generation} board={board} reload={() => setGeneration((g) => g + 1)} />;
}

function Board({ board, reload }: { board: Ref; reload: () => void }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const theme = useColorScheme();

  // One fetch per mount, shared by initialData (Excalidraw mounts while it runs) and the autosave setup.
  const { group, name } = board;
  const loading = useMemo(() => loadBoard({ group, name }), [group, name]);
  const initialData = useMemo(() => loading.then((l) => l.scene, () => null), [loading]);

  useEffect(() => {
    let live = true;
    let autosave: Autosave | null = null;
    loading.then(
      (l) => {
        if (!live) return;
        autosave = createAutosave({ save: (json, rev) => api.saveBoard({ group, name }, json, rev), rev: l.rev, version: l.version });
        setLoad({ kind: "ready", autosave });
      },
      (e) => live && setLoad({ kind: "failed", message: describe(e) }),
    );
    return () => {
      live = false;
      // A save still failing keeps retrying in the background after a board switch; nothing else is left scheduled.
      void autosave?.flush();
    };
  }, [loading, group, name]);

  const autosave = load.kind === "ready" ? load.autosave : null;
  useEffect(() => {
    if (!autosave) return;
    const flush = () => void autosave.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosave.status().kind === "saved") return;
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [autosave]);

  if (load.kind === "failed") {
    return (
      <div className="editor-failed" role="alert">
        <p>Could not open “{board.name}”: {load.message}</p>
        <button type="button" onClick={reload}>Retry</button>
      </div>
    );
  }

  return (
    <div className="editor">
      <Excalidraw
        initialData={initialData}
        theme={theme}
        name={board.name}
        UIOptions={UI_OPTIONS}
        onChange={(elements, appState, files) => {
          autosave?.push(() => serializeAsJSON(elements, appState, files, "local"), sceneVersion(elements, files));
        }}
      />
      {autosave && <SaveState autosave={autosave} reload={reload} />}
    </div>
  );
}

const LABELS: Record<SaveStatus["kind"], string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved",
  conflict: "Conflict",
  error: "Save failed",
};

function SaveState({ autosave, reload }: { autosave: Autosave; reload: () => void }) {
  const status = useSyncExternalStore(autosave.subscribe, autosave.status);
  return (
    <>
      <div className={`save-chip save-${status.kind}`} aria-live="polite" title={status.kind === "error" ? status.message : undefined}>
        {LABELS[status.kind]}
      </div>
      {status.kind === "conflict" && (
        <div className="conflict-banner" role="alert">
          <span>This board changed elsewhere.</span>
          <button type="button" onClick={reload}>Load theirs</button>
          <button type="button" onClick={() => void autosave.overwrite()}>Overwrite</button>
        </div>
      )}
    </>
  );
}

const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function useColorScheme() {
  const isDark = useSyncExternalStore(
    (cb) => {
      dark?.addEventListener("change", cb);
      return () => dark?.removeEventListener("change", cb);
    },
    () => dark?.matches ?? false,
  );
  return isDark ? THEME.DARK : THEME.LIGHT;
}

function describe(e: unknown): string {
  if (e instanceof ApiError) return e.status === 404 ? "this board does not exist." : e.message;
  if (e instanceof SyntaxError) return "the file is not valid JSON.";
  return e instanceof Error ? e.message : String(e);
}
