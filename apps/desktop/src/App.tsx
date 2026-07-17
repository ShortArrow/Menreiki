import { useEffect, useState } from "react";
import { getConfig, initialProject, setConfig } from "./api";
import HomeView from "./HomeView";
import ReviewView from "./ReviewView";
import type { ProjectInfo } from "./types";

type ThemeName = "light" | "dark";

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [theme, setTheme] = useState<ThemeName>("light");

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
    setConfig({ theme: next }).catch(() => {});
  }

  return (
    <>
      {project ? (
        <ReviewView
          project={project}
          onProjectChange={setProject}
          onClose={() => setProject(null)}
        />
      ) : (
        <HomeView onOpened={setProject} />
      )}
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title="テーマを切り替える"
      >
        {theme === "dark" ? "☀" : "🌙"}
      </button>
    </>
  );
}
