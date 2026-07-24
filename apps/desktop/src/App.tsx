import { Moon, Sun } from "./icons";
import { useEffect, useState } from "react";
import { getConfig, initialProject, setConfig } from "./api";
import FirstRunNotice, { needsAcknowledgement } from "./FirstRunNotice";
import HomeView from "./HomeView";
import ReviewView from "./ReviewView";
import type { ProjectInfo } from "./types";

type ThemeName = "light" | "dark";

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [theme, setTheme] = useState<ThemeName>("light");
  const [showNotice, setShowNotice] = useState(needsAcknowledgement);

  useEffect(() => {
    initialProject()
      .then((loaded) => {
        if (loaded) setProject(loaded);
      })
      .catch(() => {});
    getConfig()
      .then((config) => applyTheme(config.theme))
      .catch(() => {});
  }, []);

  function applyTheme(next: ThemeName) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  function toggleTheme() {
    const next: ThemeName = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    // Preserve the rest of the config (inference settings) when saving.
    getConfig()
      .then((config) => setConfig({ ...config, theme: next }))
      .catch(() => {});
  }

  return (
    <>
      {showNotice && (
        <FirstRunNotice onAcknowledge={() => setShowNotice(false)} />
      )}
      {project ? (
        <ReviewView
          project={project}
          onProjectChange={setProject}
          onClose={() => setProject(null)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      ) : (
        <>
          <HomeView onOpened={setProject} />
          {/* Review view carries its own toggle in the toolbar so this
              floating one never overlaps the side pane's content. */}
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title="テーマを切り替える"
            aria-label="テーマを切り替える"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </>
      )}
    </>
  );
}
