import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

export const TypeWriter: React.FC<{
  text: string;
  startFrame?: number;
  charsPerFrame?: number;
  style?: React.CSSProperties;
}> = ({ text, startFrame = 0, charsPerFrame = 0.5, style }) => {
  const frame = useCurrentFrame();
  const adjustedFrame = Math.max(0, frame - startFrame);
  const charCount = Math.floor(adjustedFrame * charsPerFrame);
  const displayText = text.slice(0, charCount);

  const cursorOpacity = interpolate(
    frame % 30,
    [0, 15, 16, 30],
    [1, 1, 0, 0],
  );

  return (
    <span style={style}>
      {displayText}
      {charCount < text.length && (
        <span style={{ opacity: cursorOpacity }}>|</span>
      )}
    </span>
  );
};
