import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const HOOK_DURATION = 150; // 5秒 @ 30fps

export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  const subtitleOpacity = interpolate(frame, [40, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineWidth = interpolate(frame, [20, 60], [0, 600], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bgGradientPos = interpolate(frame, [0, 150], [0, 100]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${135 + bgGradientPos * 0.3}deg, #0f172a 0%, #1e293b 40%, #334155 100%)`,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      {/* 装飾パーティクル */}
      {[...Array(20)].map((_, i) => {
        const x = interpolate(frame, [0, 150], [Math.random() * 1920, Math.random() * 1920]);
        const y = interpolate(frame, [0, 150], [1080 + i * 50, -100 + i * 20]);
        const particleOpacity = interpolate(frame, [0, 30, 120, 150], [0, 0.3, 0.3, 0]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: 4 + i % 3 * 2,
              height: 4 + i % 3 * 2,
              borderRadius: "50%",
              backgroundColor: i % 2 === 0 ? "#60a5fa" : "#34d399",
              opacity: particleOpacity,
            }}
          />
        );
      })}

      {/* メインテキスト */}
      <div
        style={{
          transform: `scale(${titleScale})`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#f8fafc",
            letterSpacing: "-0.02em",
            lineHeight: 1.3,
            textShadow: "0 4px 20px rgba(0,0,0,0.5)",
          }}
        >
          その在庫、捨てる前に
        </div>
      </div>

      {/* アクセントライン */}
      <div
        style={{
          width: lineWidth,
          height: 3,
          background: "linear-gradient(90deg, #60a5fa, #34d399)",
          borderRadius: 2,
          marginTop: 20,
        }}
      />

      {/* サブテキスト */}
      <div
        style={{
          opacity: subtitleOpacity,
          marginTop: 30,
          fontSize: 42,
          fontWeight: 500,
          color: "#94a3b8",
          letterSpacing: "0.05em",
        }}
      >
        マッチングしませんか？
      </div>
    </AbsoluteFill>
  );
};
