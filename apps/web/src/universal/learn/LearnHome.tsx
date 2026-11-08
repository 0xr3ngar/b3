import type { LearnMapActionInput, LearnStartInput, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { SidebarInset } from "~/components/ui/sidebar";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { universal } from "../state";
import { useSpaceStore } from "../spaceStore";
import "./learnMap.css";
import { TransitMap } from "./TransitMap";

export function LearnHome() {
  const learnEnvironment = useSpaceStore((store) => store.environments.learn);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = learnEnvironment ?? primaryEnvironmentId;
  const mapQuery = useEnvironmentQuery(
    environmentId === null ? null : universal.learnMap({ environmentId, input: {} }),
  );
  const learnStart = useAtomCommand(universal.learnStart, "learn start");
  const learnAction = useAtomCommand(universal.learnAction, "learn action");
  const navigate = useNavigate();

  const start = async (input: LearnStartInput) => {
    if (environmentId === null) return false;
    const result = await learnStart({ environmentId, input });
    if (result._tag !== "Success") return false;
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: result.value.threadId },
    });
    return true;
  };
  const act = async (input: LearnMapActionInput) => {
    if (environmentId === null) return;
    const result = await learnAction({ environmentId, input });
    if (result._tag === "Success") mapQuery.refresh();
  };
  const openThread = (threadId: ThreadId) => {
    if (environmentId === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
    });
  };

  const map = mapQuery.data;
  const composer = <TopicComposer onSubmit={(text) => start({ kind: "topic", text })} />;
  let body: ReactNode;
  if (environmentId === null) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Learn is not connected</EmptyTitle>
          <EmptyDescription>Connect an environment to build a knowledge map.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (map === null) {
    body = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {mapQuery.error ? "The map could not be loaded" : "Loading the knowledge map"}
          </EmptyTitle>
          <EmptyDescription>
            {mapQuery.error ?? "Stops show up here once the tutor has something to teach."}
          </EmptyDescription>
        </EmptyHeader>
        {composer}
      </Empty>
    );
  } else if (map.stations.length === 0) {
    body = (
      <>
        <header className="z-10 flex h-12 shrink-0 items-center gap-1.5 pr-4 pl-5">
          <h1 className="mr-2.5 text-sm font-medium">Knowledge map</h1>
        </header>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing on the map yet</EmptyTitle>
            <EmptyDescription>
              Ask about something you want to understand. The tutor builds a line of stops you can
              learn, quiz, and review.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <div className="px-4 pb-4">{composer}</div>
      </>
    );
  } else {
    body = (
      <TransitMap
        map={map}
        onStart={(input) => void start(input)}
        onAction={(input) => void act(input)}
        onOpenThread={openThread}
        composer={composer}
      />
    );
  }

  return (
    <SidebarInset
      className="flex h-dvh min-h-0 flex-col overflow-hidden overscroll-y-none"
      data-learn-map=""
    >
      {body}
    </SidebarInset>
  );
}

function TopicComposer(props: { readonly onSubmit: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  return (
    <form
      data-part="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) return;
        void props.onSubmit(trimmed).then((ok) => {
          if (ok) setText("");
        });
      }}
    >
      <div className="min-w-0 flex-1">
        <Input
          size="lg"
          value={text}
          aria-label="What do you want to understand?"
          placeholder="What do you want to understand?"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <Button
        type="submit"
        size="icon-sm-pill"
        aria-label="Start topic"
        disabled={trimmed.length === 0}
      >
        <ArrowUpIcon />
      </Button>
    </form>
  );
}
