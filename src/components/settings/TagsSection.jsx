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
import { Plus, Tag } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { Button } from "@/components/ui/button";
import { ClearButton } from "@/components/ui/clear-button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "./parts";
import {
  isOnline,
} from "@/lib/offlineCache";
import { SavedTagOffline } from "@/lib/offlineEntityRegistry";
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
            SavedTagOffline.queueMutation({ type: "create", name });
            return optimistic;
          }
          applyTag((current) => current.filter((tag) => tag.id !== optimistic.id));
          throw error;
        }
      } else {
        SavedTagOffline.queueMutation({ type: "create", name });
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
        if (tagToDelete?.name) SavedTagOffline.dequeueCreateWhere((m) => m.data?.name === tagToDelete.name);
        return;
      }
      if (isOnline()) {
        try {
          await apiClient.entities.SavedTag.delete(id);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            SavedTagOffline.queueMutation({ type: "delete", id });
            return;
          }
          invalidateTags();
        }
      } else {
        SavedTagOffline.queueMutation({ type: "delete", id });
      }
    },
  });

  return (
    <SettingsSection label="Tags">
      <div className="ds-list">
        {savedTags.slice(-20).length === 0 ?
          <p className="px-4 py-3 text-xs text-ink-500 dark:text-ink-400">No saved tags yet</p> :

          savedTags.slice(-20).map((tag) =>
            <div key={tag.id} className="flex min-h-[2.75rem] items-center gap-3 py-1.5 pl-4 pr-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-ink-400 dark:text-ink-500" />
              <span className="min-w-0 flex-1 break-words text-sm font-medium text-ink-900 dark:text-ink-100">{tag.name}</span>
              <ClearButton label={`Delete tag ${tag.name}`} onClick={() => deleteTagMutation.mutate(tag.id)} className="h-7 w-7" />
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
          aria-label="New tag" />

        <Button aria-label="Add tag"
          onClick={() => {
            const t = newTagName.trim();
            if (t && !savedTags.find((s) => s.name === t)) createTagMutation.mutate(t);
            setNewTagName("");
          }}
          variant="outline" className="h-9 w-9 px-0 shrink-0">

          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </SettingsSection>
  );
}
