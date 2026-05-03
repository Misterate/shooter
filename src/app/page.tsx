"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Axis, SessionWithScores, RadarDataPoint } from "@/types";

const RadarChart = dynamic(() => import("@/components/RadarChart"), {
  ssr: false,
});

export default function Dashboard() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [sessions, setSessions] = useState<SessionWithScores[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [axesRes, sessionsRes] = await Promise.all([
          fetch("/api/axes"),
          fetch("/api/sessions"),
        ]);
        const axesData: Axis[] = await axesRes.json();
        const sessionsData: SessionWithScores[] = await sessionsRes.json();
        setAxes(axesData);
        setSessions(sessionsData);
      } catch (e) {
        console.error("Failed to load dashboard data", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const completedSessions = sessions.filter((s) => s.completed === 1);
  const latestSession = completedSessions[0];

  // Build radar chart data from latest session scores
  const radarData: RadarDataPoint[] = axes
    .filter((a) => a.active === 1)
    .map((a) => {
      const score = latestSession?.scores.find((s) => s.axis_id === a.id);
      return {
        axis: a.name,
        score: score ? Math.round(score.score * 10) / 10 : 0,
        fullMark: 10,
      };
    });

  const hasData = latestSession && latestSession.scores.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-neutral-500 text-sm">Loading&hellip;</div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-light text-neutral-100">Your Profile</h1>
          <p className="text-neutral-500 text-sm mt-1">
            {completedSessions.length} session
            {completedSessions.length !== 1 ? "s" : ""} completed
          </p>
        </div>
        <Link
          href="/session"
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          New Session
        </Link>
      </div>

      {/* Radar Chart or Empty State */}
      {hasData ? (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 mb-8">
          <RadarChart data={radarData} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 justify-center">
            {radarData.map((d) => (
              <span key={d.axis} className="text-xs text-neutral-500">
                {d.axis}:{" "}
                <span
                  className={
                    d.score >= 0 ? "text-indigo-400" : "text-rose-400"
                  }
                >
                  {d.score > 0 ? "+" : ""}
                  {d.score}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-10 mb-8 text-center">
          <p className="text-neutral-400 text-base mb-2 font-light">
            No data yet
          </p>
          <p className="text-neutral-600 text-sm mb-6">
            Complete your first session to see your character profile
          </p>
          <Link
            href="/session"
            className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Start your first session
          </Link>
        </div>
      )}

      {/* Session History */}
      {completedSessions.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-neutral-500 uppercase tracking-wide mb-4">
            Recent Sessions
          </h2>
          <div className="flex flex-col gap-3">
            {completedSessions.slice(0, 10).map((session) => {
              const date = new Date(session.created_at);
              const axisScores = session.scores.slice(0, 4);
              return (
                <div
                  key={session.id}
                  className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-neutral-300">
                      {date.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {date.toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {axisScores.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {axisScores.map((s) => {
                        const axis = axes.find((a) => a.id === s.axis_id);
                        return (
                          <span
                            key={s.axis_id}
                            className="text-xs px-2 py-1 rounded-md bg-neutral-800 text-neutral-400"
                          >
                            {axis?.name ?? s.axis_id}:{" "}
                            <span
                              className={
                                s.score >= 0
                                  ? "text-indigo-400"
                                  : "text-rose-400"
                              }
                            >
                              {s.score > 0 ? "+" : ""}
                              {s.score.toFixed(1)}
                            </span>
                          </span>
                        );
                      })}
                      {session.scores.length > 4 && (
                        <span className="text-xs px-2 py-1 text-neutral-600">
                          +{session.scores.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
