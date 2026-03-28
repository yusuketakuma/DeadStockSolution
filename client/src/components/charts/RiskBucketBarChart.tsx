import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export interface RiskBucketCounts {
  expired: number;
  within30: number;
  within60: number;
  within90: number;
  within120: number;
  over120: number;
  unknown: number;
}

export interface RiskBucketBarChartProps {
  bucketCounts: RiskBucketCounts;
  onBucketClick?: (bucket: keyof RiskBucketCounts) => void;
}

const LABELS = ['期限切れ', '30日以内', '60日以内', '90日以内', '120日以内', '120日超', '不明'];
const COLORS = [
  'rgba(220, 53, 69, 0.85)',   // danger — expired
  'rgba(253, 126, 20, 0.85)',  // orange — within30
  'rgba(255, 193, 7, 0.85)',   // warning — within60
  'rgba(25, 135, 84, 0.85)',   // success — within90
  'rgba(13, 202, 240, 0.85)',  // info — within120
  'rgba(13, 110, 253, 0.85)',  // primary — over120
  'rgba(108, 117, 125, 0.85)', // secondary — unknown
];

const OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items: { dataIndex: number }[]) => LABELS[items[0].dataIndex] ?? '',
      },
    },
  },
  scales: {
    x: { display: false },
    y: { display: false },
  },
} as const;

export default function RiskBucketBarChart({ bucketCounts, onBucketClick }: RiskBucketBarChartProps) {
  const data = {
    labels: LABELS,
    datasets: [
      {
        data: [
          bucketCounts.expired,
          bucketCounts.within30,
          bucketCounts.within60,
          bucketCounts.within90,
          bucketCounts.within120,
          bucketCounts.over120,
          bucketCounts.unknown,
        ],
        backgroundColor: COLORS,
        borderRadius: 2,
        borderSkipped: false,
      },
    ],
  };

  return (
    <div style={{ height: 70 }}>
      <Bar
        data={data}
        options={{
          ...OPTIONS,
          onClick: (_event, elements) => {
            const index = elements[0]?.index;
            const keys: Array<keyof RiskBucketCounts> = ['expired', 'within30', 'within60', 'within90', 'within120', 'over120', 'unknown'];
            const bucket = index !== undefined ? keys[index] : null;
            if (bucket && onBucketClick) {
              onBucketClick(bucket);
            }
          },
        }}
      />
    </div>
  );
}
