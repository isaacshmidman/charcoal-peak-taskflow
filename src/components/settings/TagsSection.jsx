// @ts-nocheck
/**
 * @file Saved-tags section — chip list + add input. Owns the savedTags
 * query and the 2 tag mutations (create / delete). Optimistic +
 * offline-aware (same pattern as PrioritiesSection).
 *
 * Only shows the most-recent 20 tags (`slice(-20)`) — older tags are
 * still searchable via the TaskForm tag input.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, X } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  dequeueTagCreate,
  isOnline,
  queueTagMutation,
} from "@/lib/offlineCache";
import { isRecoverableConnectionError } from "@/lib/network";

export default function TagsSection() {
  const [newTagName, setNewTagName] = useState("");
  const queryClient = useQueryClient();

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100),
  });

  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: ["savedTags"] });

  const applyTag = (fn) => {
    const current = queryClient.getQueryData(["savedTags"]) || [];
    const updated = fn(current);
    queryClient.setQueryData(["savedTags"], updated);
    return updated;
  };

  const createTagMutation = useMutation({
    mutationFn: async (name) => {
      const optimistic = { id: `offline_${Date.now()}`, name, created_date: new Date().toISOString() };
      applyTag((current) => [...current, optimistic]);
      if (isOnline()) {
        try {
          const result = await apiClient.entities.SavedTag.create({ name });
          invalidateTags();
          return result;
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queueTagMutation({ type: "create", name });
            return optimistic;
          }
          applyTag((current) => current.filter((tag) => tag.id !== optimistic.id));
          throw error;
        }
      } else {
        queueTagMutation({ type: "create", name });
        return optimistic;
      }
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (id) => {
      const current = queryClient.getQueryData(["savedTags"]) || [];
      const tagToDelete = current.find((t) => t.id === id);
      applyTag((list) => list.filter((t) => t.id !== id));
      if (String(id).startsWith("offline_")) {
        if (tagToDelete?.name) dequeueTagCreate(tagToDelete.name);
        return;
      }
      if (isOnline()) {
        try {
          await apiClient.entities.SavedTag.delete(id);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queueTagMutation({ type: "delete", id });
            return;
          }
          invalidateTags();
        }
      } else {
        queueTagMutation({ type: "delete", id });
      }
    },
  });

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Tags</h2>

      <div className="border border-slate-100 dark:border-[#303030] rounded-xl overflow-hidden bg-white dark:bg-[#111111]">
        {savedTags.slice(-20).length === 0 ?
          <p className="text-xs text-slate-400 px-4 py-3">No saved tags yet</p> :

          savedTags.slice(-20).map((tag, i, arr) =>
            <div key={tag.id} className={cn("flex items-center justify-between px-4 py-2", i < arr.length - 1 && "border-b border-slate-50 dark:border-[#303030]")}>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2 min-w-0 break-words whitespace-normal">
                <Tag className="w-3 h-3 text-slate-900 dark:text-slate-100 shrink-0" /><span className="break-words whitespace-normal">{tag.name}</span>
              </span>
              <button onClick={() => deleteTagMutation.mutate(tag.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-300 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        }
      </div>

      <div className="flex gap-2 mt-3">
        <Input
          placeholder="New tag..."
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = newTagName.trim();
              if (t && !savedTags.find((s) => s.name === t)) createTagMutation.mutate(t);
              setNewTagName("");
            }
          }}
          className="" />

        <Button
          onClick={() => {
            const t = newTagName.trim();
            if (t && !savedTags.find((s) => s.name === t)) createTagMutation.mutate(t);
            setNewTagName("");
          }}
          className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">

          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </section>
  );
}
