import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const DIFFERENTIATOR_DURATION = 300; // 10秒 @ 30fps

const StatCounter: React.FC<{
  value: string;
  label: string;
  delay: number;
  color: string;
}> = ({ value, label, delay, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const s = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 200, stiffness: 80 },
  });

  const scale = interpolate(s, [0, 1], [0.5, 1]);
  const opacity = interpolate(s, [0, 1], [0, 1]);

  return (
    <div
      style={{
        textAlign: "center",
        transform: `scale(${scale})`,
        opacity,
      }}
    >
      <div
        style={{
          fontSize: 72,
          fontWeight: 900,
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 22,
          color: "#94a3b8",
          marginTop: 12,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const DifferentiatorScene: React.FC = () => {
  const frame = useCurrentFrame();

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const badgeOpacity = interpolate(frame, [180, 210], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      {/* タイトル */}
      <div
        style={{
          opacity: titleOpacity,
          fontSize: 28,
          color: "#60a5fa",
          fontWeight: 700,
          letterSpacing: "0.15em",
          marginBottom: 60,
        }}
      >
        WHY DEADSTOCK SOLUTION?
      </div>

      {/* 数字カウンター */}
      <div
        style={{
          display: "flex",
          gap: 100,
          marginBottom: 60,
        }}
      >
        <StatCounter value="4,593+" label="自動テスト" delay={30} color="#34d399" />
        <StatCounter value="59" label="APIエンドポイント" delay={60} color="#60a5fa" />
        <StatCounter value="80+" label="UIコンポーネント" delay={90} color="#a78bfa" />
      </div>

      {/* バッジ */}
      <div
        style={{
          display: "flex",
          gap: 24,
          opacity: badgeOpacity,
        }}
      >
        {["厚労省薬価基準連携", "リアルタイム通知", "PWA対応"].map((badge, i) => (
          <div
            key={i}
            style={{
              padding: "12px 28px",
              background: "rgba(255,255,255,0.08)",
              borderRadius: 100,
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#e2e8f0",
              fontSize: 18,
              fontWeight: 500,
            }}
          >
            {badge}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
