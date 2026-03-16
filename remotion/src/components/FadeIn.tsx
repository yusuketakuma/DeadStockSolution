import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export const FadeIn: React.FC<{
  children: React.ReactNode;
  durationInFrames?: number;
}> = ({ children, durationInFrames = 30 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });

  return <div style={{ opacity }}>{children}</div>;
};
