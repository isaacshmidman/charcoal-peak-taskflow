// @ts-nocheck
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { apiClient } from "@/api/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isOnline, queuePriorityMutation, queueTagMutation, dequeuePriorityCreate, dequeueTagCreate } from "@/lib/offlineCache";
import { isRecoverableConnectionError } from "@/lib/network";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, X, Tag, Check, LogOut, ArrowUp, ArrowDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger } from
"@/components/ui/alert-dialog";
import RecentlyDeleted from "@/pages/RecentlyDeleted";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";

import { COLOR_OPTIONS, colorDot } from "@/lib/colors";

export const NAV_OPTIONS = [
{ value: "/Active", label: "All Tasks" },
{ value: "/Today", label: "Today" },
{ value: "/Groupings", label: "Groupings" },
{ value: "/Completed", label: "Completed" }];


const NAV_LABELS = {
  "/Active": "All Tasks",
  "/Today": "Today",
  "/Groupings": "Groupings",
  "/Completed": "Completed"
};

function getSavedNavOrder() {
  try {
    const saved = localStorage.getItem("navOrder");
    if (saved) return sanitizeNavOrder(JSON.parse(saved));
  } catch {}
  return DEFAULT_NAV_ORDER;
}

function PriorityRow({ p, idx, total, isEditing, onStartEdit, onStopEdit, onDelete, onUpdate, onMoveUp, onMoveDown }) {
  const [editName, setEditName] = useState(p.name);
  const [editColor, setEditColor] = useState(p.color);

  // When this row becomes the active edit target, seed the draft fields from the current priority.
  // When another row steals the edit, this effect resets its draft back to the saved values so the
  // next time this row is opened we don't show stale input.
  useEffect(() => {
    if (isEditing) {
      setEditName(p.name);
      setEditColor(p.color);
    }
  }, [isEditing, p.name, p.color]);

  const save = () => {
    if (editName.trim()) onUpdate(p.id, { name: editName.trim(), color: editColor });
    onStopEdit();
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
        <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[editColor] || colorDot.slate)} />
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {if (e.key === "Enter") save();if (e.key === "Escape") onStopEdit();}}
          className="h-7 text-sm flex-1 border-0 border-b rounded-none px-0 focus-visible:ring-0"
          autoFocus />
        
        <Select value={editColor} onValueChange={setEditColor}>
          <SelectTrigger className="w-24 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLOR_OPTIONS.map((c) =>
            <SelectItem key={c.value} value={c.value}>
                <span className="flex items-center gap-1.5">
                  <span className={cn("w-2 h-2 rounded-full", c.class)} />{c.label}
                </span>
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={save}>
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={onStopEdit}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>);

  }

  return (
    <div
      className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-3 py-2.5 hover:border-slate-200 transition-colors"
      onDoubleClick={onStartEdit}>
      
      <div className="flex flex-col gap-0.5">
        <button onClick={onMoveUp} disabled={idx === 0} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
          <ArrowUp className="w-3 h-3" />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>
      <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[p.color] || colorDot.slate)} />
      <span className="text-sm font-medium text-slate-900 flex-1 min-w-0 break-words whitespace-normal">{p.name}</span>
      
      <button className="text-slate-300 hover:text-red-400 transition-colors" onClick={(e) => {e.stopPropagation();onDelete(p.id);}}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>);

}

export default function Settings() {
  const [newPriorityName, setNewPriorityName] = useState("");
  const [newPriorityColor, setNewPriorityColor] = useState("slate");
  const [newTagName, setNewTagName] = useState("");
  const [orderedPriorities, setOrderedPriorities] = useState([]);
  const [editingPriorityId, setEditingPriorityId] = useState(null);
  const [navOrder, setNavOrder] = useState(getSavedNavOrder);
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const scrollPosRef = useRef(0);
  const pendingScrollRestoreRef = useRef(null);
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();

  useLayoutEffect(() => {
    if (showRecentlyDeleted || pendingScrollRestoreRef.current === null) return;

    window.scrollTo({ top: pendingScrollRestoreRef.current, left: 0, behavior: "auto" });
    pendingScrollRestoreRef.current = null;
  }, [showRecentlyDeleted]);

  // Return to main Settings (restoring scroll) when the top Settings icon is clicked
  useEffect(() => {
    const handler = () => {
      setShowRecentlyDeleted((current) => {
        if (!current) return current;
        pendingScrollRestoreRef.current = scrollPosRef.current;
        return false;
      });
    };
    window.addEventListener("settingsNavClicked", handler);
    return () => window.removeEventListener("settingsNavClicked", handler);
  }, []);

  const moveNav = (idx, dir) => {
    const reordered = [...navOrder];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= reordered.length) return;
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setNavOrder(reordered);
    localStorage.setItem("navOrder", JSON.stringify(reordered));
    window.dispatchEvent(new Event("navOrderChanged"));
  };

  const { data: priorities = [], isSuccess: prioritiesLoaded } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => apiClient.entities.Priority.list("order", 50)
  });

  // Keep orderedPriorities in sync with the query cache (covers both fetched and optimistic updates)
  useEffect(() => {
    setOrderedPriorities([...priorities].sort((a, b) => a.order - b.order));
  }, [priorities]);

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => apiClient.entities.SavedTag.list("name", 100)
  });

  const invalidatePriorities = () => queryClient.invalidateQueries({ queryKey: ["priorities"] });
  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: ["savedTags"] });

  // --- Priority mutations (query cache is source of truth; localStorage is synced by useOfflineData) ---

  const applyPriority = (fn) => {
    const current = queryClient.getQueryData(['priorities']) || [];
    const updated = fn(current);
    queryClient.setQueryData(['priorities'], updated);
    return updated;
  };

  const createPriorityMutation = useMutation({
    mutationFn: async (data) => {
      const optimisticId = `offline_${Date.now()}`;
      const optimistic = { ...data, id: optimisticId, created_date: new Date().toISOString() };
      // Always add optimistically first so the UI never flickers
      applyPriority((current) => [...current, optimistic]);
      if (isOnline()) {
        try {
          const result = await apiClient.entities.Priority.create(data);
          // Replace optimistic entry with the real server record
          applyPriority((current) => current.map((p) => p.id === optimisticId ? { ...p, ...result } : p));
          return result;
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: 'create', data: { ...data, _offlineId: optimisticId } });
            return optimistic;
          }

          applyPriority((current) => current.filter((p) => p.id !== optimisticId));
          throw error;
        }
      } else {
        queuePriorityMutation({ type: 'create', data: { ...data, _offlineId: optimisticId } });
        return optimistic;
      }
    }
  });

  const updatePriorityMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      applyPriority((current) => current.map((p) => p.id === id ? { ...p, ...data } : p));
      if (isOnline()) {
        try {
          await apiClient.entities.Priority.update(id, data);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: 'update', id, data });
            return;
          }
          invalidatePriorities();
        }
      } else {
        queuePriorityMutation({ type: 'update', id, data });
      }
    }
  });

  const deletePriorityMutation = useMutation({
    mutationFn: async (id) => {
      applyPriority((current) => current.filter((p) => p.id !== id));
      if (String(id).startsWith('offline_')) {
        dequeuePriorityCreate(id);
        return;
      }
      if (isOnline()) {
        try {
          await apiClient.entities.Priority.delete(id);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queuePriorityMutation({ type: 'delete', id });
            return;
          }
          invalidatePriorities();
        }
      } else {
        queuePriorityMutation({ type: 'delete', id });
      }
    }
  });

  // --- Tag mutations ---

  const applyTag = (fn) => {
    const current = queryClient.getQueryData(['savedTags']) || [];
    const updated = fn(current);
    queryClient.setQueryData(['savedTags'], updated);
    return updated;
  };

  const createTagMutation = useMutation({
    mutationFn: async (name) => {
      const optimistic = { id: `offline_${Date.now()}`, name, created_date: new Date().toISOString() };
      applyTag((current) => [...current, optimistic]);
      if (isOnline()) {
        try {
          const result = await apiClient.entities.SavedTag.create({ name });
          invalidateTags(); // replaces optimistic with real record
          return result;
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queueTagMutation({ type: 'create', name });
            return optimistic;
          }

          applyTag((current) => current.filter((tag) => tag.id !== optimistic.id));
          throw error;
        }
      } else {
        queueTagMutation({ type: 'create', name });
        return optimistic;
      }
    }
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (id) => {
      // Look up the tag name before removing from cache so we can dequeue by name
      const current = queryClient.getQueryData(['savedTags']) || [];
      const tagToDelete = current.find((t) => t.id === id);
      applyTag((list) => list.filter((t) => t.id !== id));
      if (String(id).startsWith('offline_')) {
        if (tagToDelete?.name) dequeueTagCreate(tagToDelete.name);
        return;
      }
      if (isOnline()) {
        try {
          await apiClient.entities.SavedTag.delete(id);
        } catch (error) {
          if (isRecoverableConnectionError(error)) {
            queueTagMutation({ type: 'delete', id });
            return;
          }
          invalidateTags();
        }
      } else {
        queueTagMutation({ type: 'delete', id });
      }
    }
  });

  const sorted = orderedPriorities;

  const addPriority = () => {
    if (!newPriorityName.trim()) return;
    const maxOrder = sorted.length > 0 ? Math.max(...sorted.map((p) => p.order)) + 1 : 0;
    createPriorityMutation.mutate({ name: newPriorityName.trim(), color: newPriorityColor, order: maxOrder });
    setNewPriorityName("");setNewPriorityColor("slate");
  };

  const movePriority = (idx, dir) => {
    const reordered = [...sorted];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= reordered.length) return;
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    // Immediately update local display order
    setOrderedPriorities(reordered);
    // Always persist new order values so TaskForm reflects the change immediately
    reordered.forEach((p, i) => {
      updatePriorityMutation.mutate({ id: p.id, data: { order: i } });
    });
  };

  // Default nav setting
  const defaultNav = sanitizeNavRoute(localStorage.getItem("defaultNav"));
  const [selectedDefaultNav, setSelectedDefaultNav] = useState(defaultNav);

  const saveDefaultNav = (val) => {
    const nextValue = sanitizeNavRoute(val);
    setSelectedDefaultNav(nextValue);
    localStorage.setItem("defaultNav", nextValue);
    window.dispatchEvent(new Event("navOrderChanged"));
  };

  if (showRecentlyDeleted) {
    return (
      <div>
        <RecentlyDeleted onBack={() => {
          pendingScrollRestoreRef.current = scrollPosRef.current;
          setShowRecentlyDeleted(false);
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-slate-900">Settings</h1>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{user?.email || "..."}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 text-slate-900 hover:text-red-400 hover:border-red-200 text-sm font-medium shrink-0">
              <LogOut className="w-4 h-4" />
              Log out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => logout()}>Log out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Default nav */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Default View</h2>
        
        <Select value={selectedDefaultNav} onValueChange={saveDefaultNav}>
          <SelectTrigger className="w-48 h-9 bg-white text-sm font-medium text-slate-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white">
            {navOrder.map((path) => {
              const opt = NAV_OPTIONS.find((o) => o.value === path);
              return opt ? <SelectItem key={opt.value} value={opt.value} className="text-sm font-medium text-slate-900">{opt.label}</SelectItem> : null;
            })}
          </SelectContent>
        </Select>
      </section>

      {/* Nav Order */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Navigation Order</h2>
        
        <div className="space-y-2">
          {navOrder.map((path, idx) =>
          <div key={path} className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-3 py-2.5 hover:border-slate-200 transition-colors">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveNav(idx, -1)} disabled={idx === 0} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button onClick={() => moveNav(idx, 1)} disabled={idx === navOrder.length - 1} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
              <span className="text-sm font-medium text-slate-900 flex-1">{NAV_LABELS[path]}</span>
              
            </div>
          )}
        </div>
      </section>

      {/* Priorities */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Priority Levels</h2>
        

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
          <Button onClick={addPriority} className="h-9 px-3 bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </section>

      {/* Tags */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Tags</h2>
        

        <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
          {savedTags.slice(-20).length === 0 ?
          <p className="text-xs text-slate-400 px-4 py-3">No saved tags yet</p> :

          savedTags.slice(-20).map((tag, i, arr) =>
          <div key={tag.id} className={cn("flex items-center justify-between px-4 py-2", i < arr.length - 1 && "border-b border-slate-50")}>
                <span className="text-sm font-medium text-slate-900 flex items-center gap-2 min-w-0 break-words whitespace-normal">
                  <Tag className="w-3 h-3 text-slate-900 shrink-0" /><span className="break-words whitespace-normal">{tag.name}</span>
                </span>
                <button onClick={() => deleteTagMutation.mutate(tag.id)} className="text-slate-300 hover:text-red-400 transition-colors">
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
            className="h-9 px-3 bg-slate-900 hover:bg-slate-800">
            
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </section>

      {/* Recently Deleted */}
      <section>
        <button
          onClick={() => { scrollPosRef.current = window.scrollY; setShowRecentlyDeleted(true); }}
          className="w-full flex items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-3 hover:border-slate-200 transition-colors"
        >
          <span className="text-sm font-medium text-slate-900 flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-400" />
            Recently Deleted
          </span>
          <ChevronRight className="w-4 h-4 text-slate-300" />
        </button>
      </section>

    </div>);

}
