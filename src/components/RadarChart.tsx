"use client";

import {
  Radar,
  RadarChart as RechartsRadar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { RadarDataPoint } from "@/types";

interface Props {
  data: RadarDataPoint[];
}

interface CustomLabelProps {
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  payload?: { value: string };
  textAnchor?: string;
}

function CustomAxisTick({ x = 0, y = 0, cx = 0, cy = 0, payload }: CustomLabelProps) {
  const label = payload?.value ?? "";
  // Determine text-anchor based on position relative to center
  const dx = x - cx;
  const textAnchor = dx < -10 ? "end" : dx > 10 ? "start" : "middle";

  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fill="#9ca3af"
      fontSize={12}
      dy={4}
    >
      {label}
    </text>
  );
}

export default function RadarChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <RechartsRadar data={data} cx="50%" cy="50%" outerRadius="75%">
        <PolarGrid stroke="#374151" />
        <PolarAngleAxis
          dataKey="axis"
          tick={(props) => <CustomAxisTick {...props} />}
        />
        <Radar
          name="Score"
          dataKey="score"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.25}
          strokeWidth={2}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1c1c1c",
            border: "1px solid #374151",
            borderRadius: "8px",
            color: "#e5e7eb",
            fontSize: 13,
          }}
          formatter={(value: number) => [value.toFixed(1), "Score"]}
        />
      </RechartsRadar>
    </ResponsiveContainer>
  );
}
