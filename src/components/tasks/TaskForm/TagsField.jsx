// @ts-nocheck
/**
 * @file Tag input + autocomplete dropdown of saved tags + chip display
 * with remove buttons.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";

export default function TagsField({ form, setForm, savedTags }) {
  const [tagInput, setTagInput] = useState("");
  const [tagInputFocused, setTagInputFocused] = useState(false);

  const addTag = (tagName) => {
    const tag = (tagName || tagInput).trim();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setTagInput("");
  };

  const removeTag = (tag) => setForm({ ...form, tags: form.tags.filter(t => t !== tag) });

  const filteredSuggestions = savedTags
    .map((tag) => tag.name)
    .filter((tag) => !form.tags.includes(tag))
    .filter((tag) => !tagInput || tag.toLowerCase().includes(tagInput.toLowerCase()))
    .slice(0, 30);

  return (
    <div>
      <Label className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1.5 block">Tags</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            placeholder="Type or pick a tag..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            onFocus={() => setTagInputFocused(true)}
            onBlur={() => setTimeout(() => setTagInputFocused(false), 150)}
            className=""
          />
          {tagInputFocused && filteredSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white dark:bg-[#111111] border border-slate-200 dark:border-[#343434] rounded-lg shadow-lg overflow-hidden max-h-40 overflow-y-auto">
              {filteredSuggestions.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                  className="w-full text-left text-xs font-medium px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-[#222222] text-slate-900 dark:text-slate-100"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button type="button" size="sm" onClick={() => addTag()} className="h-9 px-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {form.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {form.tags.map(tag => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1 max-w-full break-words whitespace-normal">
              <span className="break-words whitespace-normal">{tag}</span>
              <button type="button" onClick={() => removeTag(tag)} className="text-slate-400 dark:text-slate-500 hover:text-red-400 dark:hover:text-red-300 transition-colors"><X className="w-3 h-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
