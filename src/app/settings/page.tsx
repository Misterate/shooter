"use client";

import { useEffect, useState } from "react";
import type { Axis } from "@/types";

interface AxisFormData {
  name: string;
  positive: string;
  negative: string;
  description: string;
}

const EMPTY_FORM: AxisFormData = {
  name: "",
  positive: "",
  negative: "",
  description: "",
};

export default function SettingsPage() {
  const [axes, setAxes] = useState<Axis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AxisFormData>(EMPTY_FORM);
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AxisFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAxes();
  }, []);

  async function loadAxes() {
    setLoading(true);
    try {
      const res = await fetch("/api/axes");
      const data: Axis[] = await res.json();
      setAxes(data);
    } finally {
      setLoading(false);
    }
  }

  async function toggleAxis(axis: Axis) {
    const updated = { active: axis.active === 1 ? 0 : 1 };
    await fetch(`/api/axes/${axis.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setAxes((prev) =>
      prev.map((a) => (a.id === axis.id ? { ...a, ...updated } : a))
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.name || !addForm.positive || !addForm.negative || !addForm.description) {
      setAddError("All fields are required");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/axes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const err = await res.json();
        setAddError(err.error ?? "Failed to create axis");
        return;
      }
      const newAxis: Axis = await res.json();
      setAxes((prev) => [...prev, newAxis]);
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(axis: Axis) {
    setEditingId(axis.id);
    setEditForm({
      name: axis.name,
      positive: axis.positive,
      negative: axis.negative,
      description: axis.description,
    });
  }

  async function handleSaveEdit(axisId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/axes/${axisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) return;
      const updated: Axis = await res.json();
      setAxes((prev) => prev.map((a) => (a.id === axisId ? updated : a)));
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-neutral-500 text-sm">Loading&hellip;</div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-light text-neutral-100">Character Axes</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Manage the dimensions used to generate questions
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-xl transition-colors"
        >
          {showAdd ? "Cancel" : "+ Add Axis"}
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-6"
        >
          <h3 className="text-sm font-medium text-neutral-300 mb-4">New Axis</h3>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Name</label>
              <input
                type="text"
                placeholder="e.g. Resilience"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-500 mb-1 block">Positive pole</label>
                <input
                  type="text"
                  placeholder="e.g. Steadfast"
                  value={addForm.positive}
                  onChange={(e) => setAddForm({ ...addForm, positive: e.target.value })}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 mb-1 block">Negative pole</label>
                <input
                  type="text"
                  placeholder="e.g. Fragile"
                  value={addForm.negative}
                  onChange={(e) => setAddForm({ ...addForm, negative: e.target.value })}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">Description (used internally)</label>
              <textarea
                rows={2}
                placeholder="Describe what this axis measures in plain terms"
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
            {addError && (
              <p className="text-rose-400 text-xs">{addError}</p>
            )}
            <button
              type="submit"
              disabled={adding}
              className="self-start px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add Axis"}
            </button>
          </div>
        </form>
      )}

      {/* Axis List */}
      <div className="flex flex-col gap-3">
        {axes.map((axis) => (
          <div
            key={axis.id}
            className={`bg-neutral-900 border rounded-xl p-4 transition-opacity ${
              axis.active === 0
                ? "border-neutral-800 opacity-50"
                : "border-neutral-800"
            }`}
          >
            {editingId === axis.id ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Positive pole</label>
                    <input
                      type="text"
                      value={editForm.positive}
                      onChange={(e) => setEditForm({ ...editForm, positive: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Negative pole</label>
                    <input
                      type="text"
                      value={editForm.negative}
                      onChange={(e) => setEditForm({ ...editForm, negative: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Description</label>
                  <textarea
                    rows={2}
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(axis.id)}
                    disabled={saving}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 text-xs rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-neutral-100">
                      {axis.name}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {axis.positive} &harr; {axis.negative}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 line-clamp-2">
                    {axis.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(axis)}
                    className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleAxis(axis)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      axis.active === 1 ? "bg-indigo-600" : "bg-neutral-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        axis.active === 1 ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
