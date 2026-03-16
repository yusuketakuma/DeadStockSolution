import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const CTA_DURATION = 450; // 15秒 @ 30fps

export const CTAScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 60 },
    from: 0.6,
    to: 1,
  });

  const titleOpacity = interpolate(frame, [20, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const urlOpacity = interpolate(frame, [60, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const buttonScale = spring({
    frame: Math.max(0, frame - 80),
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  // パルスアニメーション
  const pulse = interpolate(frame % 60, [0, 30, 60], [1, 1.05, 1]);

  const fadeOut = interpolate(frame, [390, 450], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
        opacity: fadeOut,
      }}
    >
      {/* 背景グロウ */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.15), transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      {/* ロゴ */}
      <div
        style={{
          transform: `scale(${logoScale})`,
          fontSize: 64,
          marginBottom: 16,
        }}
      >
        💊
      </div>

      {/* タイトル */}
      <div
        style={{
          opacity: titleOpacity,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 56,
            fontWeight: 900,
            color: "#f8fafc",
            marginBottom: 12,
          }}
        >
          DeadStock Solution
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#94a3b8",
          }}
        >
          薬局のデッドストックを、価値ある在庫に
        </div>
      </div>

      {/* URL */}
      <div
        style={{
          opacity: urlOpacity,
          marginTop: 40,
          fontSize: 22,
          color: "#60a5fa",
          letterSpacing: "0.05em",
        }}
      >
        deadstock-solution.vercel.app
      </div>

      {/* ボタン */}
      <div
        style={{
          transform: `scale(${buttonScale * pulse})`,
          marginTop: 30,
          padding: "18px 48px",
          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
          borderRadius: 12,
          fontSize: 24,
          fontWeight: 700,
          color: "#fff",
          boxShadow: "0 8px 32px rgba(59,130,246,0.4)",
        }}
      >
        今すぐ無料で始める →
      </div>
    </AbsoluteFill>
  );
};
