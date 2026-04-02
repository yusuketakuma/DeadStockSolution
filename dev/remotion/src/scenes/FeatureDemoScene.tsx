import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";

export const UPLOAD_DEMO_DURATION = 450; // 15秒
export const MATCHING_DEMO_DURATION = 600; // 20秒
export const DASHBOARD_DEMO_DURATION = 450; // 15秒

const MockBrowserChrome: React.FC<{
  url: string;
  children: React.ReactNode;
}> = ({ url, children }) => (
  <div
    style={{
      width: 1440,
      height: 820,
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
      border: "1px solid rgba(255,255,255,0.1)",
    }}
  >
    {/* ブラウザバー */}
    <div
      style={{
        height: 44,
        background: "#1e293b",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 8,
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#f87171" }} />
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#fbbf24" }} />
      <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#34d399" }} />
      <div
        style={{
          marginLeft: 16,
          flex: 1,
          height: 28,
          background: "#0f172a",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 13,
          color: "#64748b",
        }}
      >
        {url}
      </div>
    </div>
    {/* コンテンツエリア */}
    <div style={{ height: 776, background: "#f8fafc", overflow: "hidden" }}>
      {children}
    </div>
  </div>
);

// ===== アップロードデモ =====
export const UploadDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const browserScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 60 },
    from: 0.9,
    to: 1,
  });

  const uploadProgress = interpolate(frame, [120, 300], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const checkOpacity = interpolate(frame, [310, 340], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rowCount = Math.min(
    5,
    Math.floor(interpolate(frame, [320, 420], [0, 5], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })),
  );

  const mockDrugs = [
    { name: "ロキソプロフェン錠60mg", qty: "120錠", exp: "2027/03" },
    { name: "アムロジピン錠5mg", qty: "84錠", exp: "2027/06" },
    { name: "メトホルミン錠250mg", qty: "200錠", exp: "2026/12" },
    { name: "カルベジロール錠10mg", qty: "56錠", exp: "2027/01" },
    { name: "リバーロキサバン錠15mg", qty: "28錠", exp: "2027/09" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      <div style={{ transform: `scale(${browserScale})` }}>
        <MockBrowserChrome url="deadstock-solution.vercel.app/upload">
          <div style={{ padding: 40 }}>
            {/* ヘッダー */}
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginBottom: 24 }}>
              在庫アップロード
            </div>

            {/* ドラッグ&ドロップエリア */}
            <div
              style={{
                border: "2px dashed #94a3b8",
                borderRadius: 12,
                padding: 40,
                textAlign: "center",
                marginBottom: 24,
                background: uploadProgress > 0 ? "#f0fdf4" : "#fff",
              }}
            >
              {uploadProgress === 0 ? (
                <>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>📁</div>
                  <div style={{ fontSize: 18, color: "#64748b" }}>
                    Excel/CSV ファイルをドラッグ＆ドロップ
                  </div>
                </>
              ) : uploadProgress < 100 ? (
                <>
                  <div style={{ fontSize: 18, color: "#059669", marginBottom: 12 }}>
                    アップロード中... {Math.round(uploadProgress)}%
                  </div>
                  <div
                    style={{
                      width: "80%",
                      height: 8,
                      background: "#e2e8f0",
                      borderRadius: 4,
                      margin: "0 auto",
                    }}
                  >
                    <div
                      style={{
                        width: `${uploadProgress}%`,
                        height: 8,
                        background: "linear-gradient(90deg, #34d399, #059669)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ fontSize: 32, opacity: checkOpacity }}>✅</span>
                  <span style={{ fontSize: 18, color: "#059669", fontWeight: 600 }}>
                    5件の医薬品を検出しました
                  </span>
                </div>
              )}
            </div>

            {/* テーブル */}
            {rowCount > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", color: "#475569" }}>医薬品名</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#475569" }}>数量</th>
                    <th style={{ padding: "10px 16px", textAlign: "right", color: "#475569" }}>使用期限</th>
                  </tr>
                </thead>
                <tbody>
                  {mockDrugs.slice(0, rowCount).map((drug, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "10px 16px", color: "#1e293b" }}>{drug.name}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: "#475569" }}>{drug.qty}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: "#475569" }}>{drug.exp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </MockBrowserChrome>
      </div>
    </AbsoluteFill>
  );
};

// ===== マッチングデモ =====
export const MatchingDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const browserScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 60 },
    from: 0.9,
    to: 1,
  });

  const matches = [
    { pharmacy: "東京中央薬局", drug: "ロキソプロフェン錠60mg", score: 95, distance: "2.3km" },
    { pharmacy: "新宿西薬局", drug: "アムロジピン錠5mg", score: 88, distance: "4.1km" },
    { pharmacy: "渋谷南薬局", drug: "メトホルミン錠250mg", score: 82, distance: "5.7km" },
    { pharmacy: "品川駅前薬局", drug: "カルベジロール錠10mg", score: 76, distance: "8.2km" },
  ];

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      <div style={{ transform: `scale(${browserScale})` }}>
        <MockBrowserChrome url="deadstock-solution.vercel.app/matching">
          <div style={{ padding: 40 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>
              マッチング候補
            </div>
            <div style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
              あなたの在庫に合う薬局が自動で見つかりました
            </div>

            {matches.map((match, i) => {
              const delay = 60 + i * 80;
              const cardSpring = spring({
                frame: Math.max(0, frame - delay),
                fps,
                config: { damping: 200, stiffness: 80 },
              });
              const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
              const cardY = interpolate(cardSpring, [0, 1], [30, 0]);

              const scoreColor = match.score >= 90 ? "#059669" : match.score >= 80 ? "#0284c7" : "#7c3aed";

              return (
                <div
                  key={i}
                  style={{
                    opacity: cardOpacity,
                    transform: `translateY(${cardY}px)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "20px 24px",
                    background: "#fff",
                    borderRadius: 10,
                    marginBottom: 12,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: "#1e293b" }}>{match.pharmacy}</div>
                    <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
                      {match.drug} · {match.distance}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 28,
                        fontWeight: 800,
                        color: scoreColor,
                      }}
                    >
                      {match.score}%
                    </div>
                    <div
                      style={{
                        padding: "8px 20px",
                        background: "#3b82f6",
                        color: "#fff",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      提案する
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </MockBrowserChrome>
      </div>
    </AbsoluteFill>
  );
};

// ===== ダッシュボードデモ =====
export const DashboardDemoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const browserScale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 60 },
    from: 0.9,
    to: 1,
  });

  const stats = [
    { label: "マッチング成立", value: "1,247", icon: "🤝", color: "#059669" },
    { label: "廃棄削減額", value: "¥12.4M", icon: "💰", color: "#0284c7" },
    { label: "登録薬局数", value: "356", icon: "🏥", color: "#7c3aed" },
    { label: "在庫品目数", value: "8,932", icon: "💊", color: "#dc2626" },
  ];

  const barHeights = [65, 80, 45, 90, 72, 55, 88, 60, 75, 95, 83, 70];

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Noto Sans JP', 'Hiragino Sans', sans-serif",
      }}
    >
      <div style={{ transform: `scale(${browserScale})` }}>
        <MockBrowserChrome url="deadstock-solution.vercel.app/dashboard">
          <div style={{ padding: 40 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginBottom: 24 }}>
              ダッシュボード
            </div>

            {/* 統計カード */}
            <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
              {stats.map((stat, i) => {
                const delay = 30 + i * 40;
                const cardSpring = spring({
                  frame: Math.max(0, frame - delay),
                  fps,
                  config: { damping: 200, stiffness: 80 },
                });
                const scale = interpolate(cardSpring, [0, 1], [0.8, 1]);
                const opacity = interpolate(cardSpring, [0, 1], [0, 1]);

                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      padding: 24,
                      background: "#fff",
                      borderRadius: 12,
                      border: "1px solid #e2e8f0",
                      transform: `scale(${scale})`,
                      opacity,
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{stat.icon}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                    <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{stat.label}</div>
                  </div>
                );
              })}
            </div>

            {/* グラフエリア */}
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                padding: 24,
                height: 280,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1e293b", marginBottom: 16 }}>
                月別マッチング成立数
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 16,
                  height: 200,
                  paddingTop: 10,
                }}
              >
                {barHeights.map((h, i) => {
                  const barProgress = interpolate(
                    frame,
                    [60 + i * 15, 90 + i * 15],
                    [0, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  );
                  const months = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
                  return (
                    <div key={i} style={{ flex: 1, textAlign: "center" }}>
                      <div
                        style={{
                          height: h * 2 * barProgress,
                          background: `linear-gradient(180deg, #3b82f6, #60a5fa)`,
                          borderRadius: "4px 4px 0 0",
                          transition: "height 0.3s",
                        }}
                      />
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                        {months[i]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </MockBrowserChrome>
      </div>
    </AbsoluteFill>
  );
};
