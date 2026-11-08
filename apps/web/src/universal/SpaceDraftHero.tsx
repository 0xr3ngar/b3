import { universalSpaceOfProject } from "@t3tools/contracts";

const HEADINGS = {
  chat: "What's on your mind?",
  learn: "What do you want to understand?",
} as const;

/** Chat and Learn drafts greet like their space, not like a code project. */
export function spaceDraftHeading(projectId: string | null | undefined): string | null {
  if (projectId == null) return null;
  const space = universalSpaceOfProject(projectId);
  return space === "chat" || space === "learn" ? HEADINGS[space] : null;
}

export function SpaceDraftHero({ heading }: { heading: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        {heading}
      </h1>
    </div>
  );
}
