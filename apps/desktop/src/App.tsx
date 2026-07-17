import { useEffect, useState } from "react";
import { initialProject } from "./api";
import HomeView from "./HomeView";
import ReviewView from "./ReviewView";
import type { ProjectInfo } from "./types";

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);

  useEffect(() => {
    initialProject()
      .then((loaded) => {
        if (loaded) setProject(loaded);
      })
      .catch(() => {});
  }, []);

  if (!project) {
    return <HomeView onOpened={setProject} />;
  }
  return (
    <ReviewView
      project={project}
      onProjectChange={setProject}
      onClose={() => setProject(null)}
    />
  );
}
