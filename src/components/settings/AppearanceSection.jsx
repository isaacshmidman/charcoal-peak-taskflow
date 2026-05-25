// @ts-nocheck
/**
 * @file Appearance section — System / Light / Dark dropdown. Reads and
 * writes via the ThemeProvider context (which owns the localStorage
 * `appearance` key and applies the .dark class to <html>).
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/lib/ThemeProvider";

export default function AppearanceSection() {
  const { appearance, setAppearance } = useTheme();
  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">Default Appearance</h2>
      <Select value={appearance} onValueChange={setAppearance}>
        <SelectTrigger className="w-48 h-9 bg-white dark:bg-[#111111] dark:border-[#343434] text-sm font-medium text-slate-900 dark:text-slate-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white dark:bg-[#111111] dark:border-[#343434]">
          <SelectItem value="system" className="text-sm font-medium text-slate-900 dark:text-slate-100">System</SelectItem>
          <SelectItem value="light" className="text-sm font-medium text-slate-900 dark:text-slate-100">Light</SelectItem>
          <SelectItem value="dark" className="text-sm font-medium text-slate-900 dark:text-slate-100">Dark</SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}
