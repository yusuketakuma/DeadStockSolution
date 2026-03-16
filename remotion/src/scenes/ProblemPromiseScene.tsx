import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const PROBLEM_PROMISE_DURATION = 300; // 10秒 @ 30fps

const ProblemItem: React.FC<{ text: string; icon: string; delay: number }> = ({
  text,
  icon,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 80 },
  });

  const x = interpolate(slideIn, [0, 1], [-200, 0]);
  const opacity = interpolate(slideIn, [0, 1], [0, 1]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 20,
        transform: `translateX(${x}px)`,
        opacity,
        marginBottom: 24,
      }}
    >
      <span style={{ fontSize: 48 }}>{icon}</span>
      <span
        style={{
          fontSize: 36,
          color: "#e2e8f0",
          fontWeight: 500,
        }}
      >
        {text}
      </span>
    </div>
  );
};

export const ProblemPromiseScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const problemOpacity = interpolate(frame, [0, 20, 130, 160], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const promiseOpacity = interpolate(frame, [150, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const promiseScale = spring({
    frame: Math.max(0, frame - 160),
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      {/* 問題提起フェーズ */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          paddingLeft: 160,
          opacity: problemOpacity,
        }}
      >
        <div
          style={{
            fontSize: 28,
            color: "#f87171",
            fontWeight: 700,
            marginBottom: 40,
            letterSpacing: "0.1em",
          }}
        >
          薬局の共通課題
        </div>
        <ProblemItem icon="📦" text="棚に眠るデッドストック" delay={15} />
        <ProblemItem icon="💸" text="年間数十万円の廃棄ロス" delay={35} />
        <ProblemItem icon="🔍" text="必要な薬局を見つけられない" delay={55} />
      </div>

      {/* 解決の約束フェーズ */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          opacity: promiseOpacity,
        }}
      >
        <div
          style={{
            transform: `scale(${promiseScale})`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 32,
              color: "#34d399",
              fontWeight: 700,
              marginBottom: 20,
              letterSpacing: "0.1em",
            }}
          >
            SOLUTION
          </div>
          <div
            style={{
              fontSize: 56,
              color: "#f8fafc",
              fontWeight: 900,
              lineHeight: 1.4,
            }}
          >
            薬局間で在庫をマッチング
          </div>
          <div
            style={{
              fontSize: 32,
              color: "#94a3b8",
              marginTop: 20,
            }}
          >
            アップロードするだけで、候補が自動で見つかる
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
