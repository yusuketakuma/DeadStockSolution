import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { HookScene, HOOK_DURATION } from "./scenes/HookScene";
import {
  ProblemPromiseScene,
  PROBLEM_PROMISE_DURATION,
} from "./scenes/ProblemPromiseScene";
import {
  UploadDemoScene,
  UPLOAD_DEMO_DURATION,
  MatchingDemoScene,
  MATCHING_DEMO_DURATION,
  DashboardDemoScene,
  DASHBOARD_DEMO_DURATION,
} from "./scenes/FeatureDemoScene";
import {
  DifferentiatorScene,
  DIFFERENTIATOR_DURATION,
} from "./scenes/DifferentiatorScene";
import { CTAScene, CTA_DURATION } from "./scenes/CTAScene";

const TRANSITION_DURATION = 15;

export const ProductVideo: React.FC = () => {
  return (
    <TransitionSeries>
      {/* 1. Hook: その在庫、捨てる前に (5秒) */}
      <TransitionSeries.Sequence durationInFrames={HOOK_DURATION}>
        <HookScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 2. Problem + Promise (10秒) */}
      <TransitionSeries.Sequence durationInFrames={PROBLEM_PROMISE_DURATION}>
        <ProblemPromiseScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 3. Upload Demo (15秒) */}
      <TransitionSeries.Sequence durationInFrames={UPLOAD_DEMO_DURATION}>
        <UploadDemoScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 4. Matching Demo (20秒) */}
      <TransitionSeries.Sequence durationInFrames={MATCHING_DEMO_DURATION}>
        <MatchingDemoScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 5. Dashboard Demo (15秒) */}
      <TransitionSeries.Sequence durationInFrames={DASHBOARD_DEMO_DURATION}>
        <DashboardDemoScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 6. Differentiator (10秒) */}
      <TransitionSeries.Sequence durationInFrames={DIFFERENTIATOR_DURATION}>
        <DifferentiatorScene />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
      />

      {/* 7. CTA (15秒) */}
      <TransitionSeries.Sequence durationInFrames={CTA_DURATION}>
        <CTAScene />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
