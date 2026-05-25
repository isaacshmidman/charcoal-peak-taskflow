// @ts-nocheck
/**
 * @file Priorities section — list of PriorityRow + new-priority form.
 * Owns the priorities query, the 3 priority mutations (create / update /
 * delete) and the orderedPriorities local state used to render the
 * reordered list before the server roundtrip lands.
 *
 * Optimistic + offline-aware: every mutation updates the cache first
 * and queues a write via offlineCache when offline or on recoverable
 * connection errors.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COLOR_OPTIONS } from "@/lib/colors";
import {
  dequeuePriorityCreate,
  isOnline,
  queuePriorityMutation,
} from "@/lib/offlineCache";
import { isRecoverableConnectionError } from "@/lib/network";
import PriorityRow from "./PriorityRow.jsx";

export default function PrioritiesSection() {
  const [newPriorityName, setNewPriorityName] = useState("");
  const [newPriorityColor, setNewPriorityColor] = useState("slate");
  const [orderedPriorities, setOrderedPriorities] = useState([]);
  const [editingPriorityId, setEditingPriorityId] = useState(null);
  const queryClient = useQueryClient();

  const { data: priorities = [] } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50),
  });

  // Keep orderedPriorities in sync with the query cache (covers both fetched and optimistic updates)
  useEffect(() => {
    setOrderedPriorities([...priorities].sort((a, b) => a.order - b.order));
  }, [priorities]);

  const invalidatePriorities = () => queryClient.invalidateQueries({ queryKey: ["priorities"] });

  const applyPriority = (fn) => {
    const current = queryClient.getQueryData(["priorities"]) || [];
    const updated = fn(current);
    queryClient.setQueryData(["priorities"], updated);
    return updated;
  };

  const createPriorityMutation = useMutation({
    mutationFn: async (data) => {
      const optimisticId = `offline_${Date.now()}`;
      const optimistic = { ...data, id: optimisticId, created_date: new Date().toISOString() };
      applyPriority((current) => [...current, optimistic]);
      if (isOnline()) {
        try {
          const result = await apiClient.entities.Priority.create(data);
          applyPriority((current) => current.map((p) => p.id === optimisticId ? { ...p, ...result } : p));
          return result;
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: "create", data: { ...data, _offlineId: optimisticId } });
            return optimistic;
          }
          applyPriority((current) => current.filter((p) => p.id !== optimisticId));
          throw error;
        }
      } else {
        queuePriorityMutation({ type: "create", data: { ...data, _offlineId: optimisticId } });
        return optimistic;
      }
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      applyPriority((current) => current.map((p) => p.id === id ? { ...p, ...data } : p));
      if (isOnline()) {
        try {
          await apiClient.entities.Priority.update(id, data);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: "update", id, data });
            return;
          }
          invalidatePriorities();
        }
      } else {
        queuePriorityMutation({ type: "update", id, data });
      }
    },
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id) => {
      applyPriority((current) => current.filter((p) => p.id !== id));
      if (String(id).startsWith("offline_")) {
        dequeuePriorityCreate(id);
        return;
      }
      if (isOnline()) {
        try {
          await apiClient.entities.Priority.delete(id);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: "delete", id });
            return;
          }
          invalidatePriorities();
        }
      } else {
        queuePriorityMutation({ type: "delete", id });
      }
    },
  });

  const sorted = orderedPriorities;

  const addPriority = () => {
    if (!newPriorityName.trim()) return;
    const maxOrder = sorted.length > 0 ? Math.max(...sorted.map((p) => p.order)) + 1 : 0;
    createPriorityMutation.mutate({ name: newPriorityName.trim(), color: newPriorityColor, order: maxOrder });
    setNewPriorityName(""); setNewPriorityColor("slate");
  };

  const movePriority = (idx, dir) => {
    const reordered = [...sorted];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= reordered.length) return;
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setOrderedPriorities(reordered);
    reordered.forEach((p, i) => {
      updatePriorityMutation.mutate({ id: p.id, data: { order: i } });
    });
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Priority Levels</h2>

      <div className="space-y-2">
        {sorted.map((p, idx) =>
          <PriorityRow
            key={p.id}
            p={p}
            idx={idx}
            total={sorted.length}
            isEditing={editingPriorityId === p.id}
            onStartEdit={() => setEditingPriorityId(p.id)}
            onStopEdit={() => setEditingPriorityId((current) => (current === p.id ? null : current))}
            onDelete={(id) => deletePriorityMutation.mutate(id)}
            onUpdate={(id, data) => updatePriorityMutation.mutate({ id, data })}
            onMoveUp={() => movePriority(idx, -1)}
            onMoveDown={() => movePriority(idx, 1)} />
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          placeholder="New priority name..."
          value={newPriorityName}
          onChange={(e) => setNewPriorityName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPriority()}
          className="" />

        <Select value={newPriorityColor} onValueChange={setNewPriorityColor}>
          <SelectTrigger className="w-28 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_OPTIONS.map((c) =>
              <SelectItem key={c.value} value={c.value}>
                <span className="flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", c.class)} />{c.label}
                </span>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button onClick={addPriority} className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </section>
  );
}
