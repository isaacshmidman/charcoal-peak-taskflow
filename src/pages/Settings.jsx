// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isOnline, queuePriorityMutation, queueTagMutation } from "@/lib/offlineCache";
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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger } from
"@/components/ui/alert-dialog";
import RecentlyDeleted from "@/pages/RecentlyDeleted";
import { DEFAULT_NAV_ORDER, sanitizeNavOrder, sanitizeNavRoute } from "@/lib/navigation";

const COLOR_OPTIONS = [
{ value: "red", label: "Red", class: "bg-red-400" },
{ value: "orange", label: "Orange", class: "bg-orange-400" },
{ value: "yellow", label: "Yellow", class: "bg-yellow-400" },
{ value: "green", label: "Green", class: "bg-green-400" },
{ value: "blue", label: "Blue", class: "bg-blue-400" },
{ value: "violet", label: "Violet", class: "bg-violet-400" },
{ value: "pink", label: "Pink", class: "bg-pink-400" },
{ value: "teal", label: "Teal", class: "bg-teal-400" },
{ value: "cyan", label: "Cyan", class: "bg-cyan-400" },
{ value: "rose", label: "Rose", class: "bg-rose-400" },
{ value: "slate", label: "Gray", class: "bg-slate-400" }];


const colorDot = {
  red: "bg-red-400", orange: "bg-orange-400", yellow: "bg-yellow-400",
  green: "bg-green-400", blue: "bg-blue-400", violet: "bg-violet-400",
  pink: "bg-pink-400", teal: "bg-teal-400", cyan: "bg-cyan-400",
  rose: "bg-rose-400", slate: "bg-slate-400"
};

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

function PriorityRow({ p, idx, total, onDelete, onUpdate, onMoveUp, onMoveDown }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(p.name);
  const [editColor, setEditColor] = useState(p.color);

  const save = () => {
    if (editName.trim()) onUpdate(p.id, { name: editName.trim(), color: editColor });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
        <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[editColor] || colorDot.slate)} />
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {if (e.key === "Enter") save();if (e.key === "Escape") setEditing(false);}}
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
        <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400" onClick={() => setEditing(false)}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>);

  }

  return (
    <div
      className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-3 py-2.5 hover:border-slate-200 transition-colors"
      onDoubleClick={() => {setEditName(p.name);setEditColor(p.color);setEditing(true);}}>
      
      <div className="flex flex-col gap-0.5">
        <button onClick={onMoveUp} disabled={idx === 0} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
          <ArrowUp className="w-3 h-3" />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} className="disabled:opacity-20 text-slate-300 hover:text-slate-500 transition-colors">
          <ArrowDown className="w-3 h-3" />
        </button>
      </div>
      <span className={cn("w-3 h-3 rounded-full shrink-0", colorDot[p.color] || colorDot.slate)} />
      <span className="text-sm font-medium text-slate-900 flex-1">{p.name}</span>
      
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
  const [navOrder, setNavOrder] = useState(getSavedNavOrder);
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);
  const scrollPosRef = useRef(0);
  const queryClient = useQueryClient();
  const { user } = useAuth();
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
    queryFn: () => base44.entities.Priority.list("order", 50)
  });

  // Keep orderedPriorities in sync with the query cache (covers both fetched and optimistic updates)
  useEffect(() => {
    setOrderedPriorities([...priorities].sort((a, b) => a.order - b.order));
  }, [priorities]);

  useEffect(() => {
    if (!prioritiesLoaded) return;
    if (priorities.length === 0) {
      const defaults = [
      { name: "High", color: "red", order: 1 },
      { name: "Medium", color: "orange", order: 2 },
      { name: "Low", color: "green", order: 3 }];

      // Use the offline-aware mutation so defaults are seeded even when offline
      defaults.forEach((p) => createPriorityMutation.mutate(p));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prioritiesLoaded, priorities.length]);

  const { data: savedTags = [] } = useQuery({
    queryKey: ["savedTags"],
    queryFn: () => base44.entities.SavedTag.list("name", 100)
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
        const result = await base44.entities.Priority.create(data);
        // Replace optimistic entry with the real server record
        applyPriority((current) => current.map((p) => p.id === optimisticId ? { ...p, ...result } : p));
        return result;
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
          await base44.entities.Priority.update(id, data);
        } catch {
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
      if (isOnline() && !String(id).startsWith('offline_')) {
        try {
          await base44.entities.Priority.delete(id);
        } catch {
          invalidatePriorities();
        }
      } else if (!String(id).startsWith('offline_')) {
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
        const result = await base44.entities.SavedTag.create({ name });
        invalidateTags(); // replaces optimistic with real record
        return result;
      } else {
        queueTagMutation({ type: 'create', name });
        return optimistic;
      }
    }
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (id) => {
      applyTag((current) => current.filter((t) => t.id !== id));
      if (isOnline() && !String(id).startsWith('offline_')) {
        try {
          await base44.entities.SavedTag.delete(id);
        } catch {
          invalidateTags();
        }
      } else if (!String(id).startsWith('offline_')) {
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
      <div className="max-w-xl">
        <RecentlyDeleted onBack={() => {
          setShowRecentlyDeleted(false);
          setTimeout(() => window.scrollTo({ top: scrollPosRef.current, behavior: "instant" }), 0);
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-base font-semibold text-slate-900">Settings</h1>
        <p className="text-xs text-slate-400 mt-0.5">{user?.email || "..."}</p>
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
                <span className="text-sm font-medium text-slate-900 flex items-center gap-2">
                  <Tag className="w-3 h-3 text-slate-900" />{tag.name}
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

      {/* Logout */}
      <section className="pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-slate-900 hover:text-red-400 hover:border-red-200 gap-2 text-sm font-medium">
              <LogOut className="w-4 h-4" />
              Log out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log out?</AlertDialogTitle>
              <AlertDialogDescription>Are you sure you want to log out?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => base44.auth.logout()}>Log out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </div>);

}
