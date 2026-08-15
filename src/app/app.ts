import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenerationResult, PlaygroundConfig, RuleKind, generate, iso, parseIso, pythonExample, serializeSchedule } from './recurrence-engine';

interface Scenario { name: string; description: string; config: Partial<PlaygroundConfig>; }
interface CalendarCell { day: number | null; date: string; occurrences: number; adjusted: boolean; included: boolean; holiday: boolean; }

const currentYear = new Date().getFullYear();
const initialStart = `${currentYear}-01-01`;
const DEFAULT_CONFIG: PlaygroundConfig = {
  name: 'Biweekly Friday schedule', kind: 'weekly', start: initialStart,
  rangeStart: initialStart, rangeEnd: `${currentYear + 1}-01-01`, every: 2,
  weekdays: [4], monthDays: [1, 15], months: [1, 4, 7, 10],
  ordinalWeekday: 0, ordinal: 2, overflow: 'clamp', until: '', count: null,
  adjustment: 'none', collision: 'keep', weekend: [5, 6], holidays: [], include: [], exclude: [],
};

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly currentYear = currentYear;
  config: PlaygroundConfig = structuredClone(DEFAULT_CONFIG);
  activeView: 'calendar' | 'timeline' | 'python' | 'json' = 'calendar';
  calendarMonth = initialStart.slice(0, 7);
  holidayText = '';
  includeText = '';
  excludeText = '';
  toast = '';

  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  readonly months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  readonly ruleKinds: { value: RuleKind; label: string; detail: string }[] = [
    { value: 'once', label: 'One time', detail: 'A single calendar date' },
    { value: 'weekly', label: 'Weekly', detail: 'Selected weekdays' },
    { value: 'monthly', label: 'Monthly dates', detail: 'Specific days of a month' },
    { value: 'monthly_weekday', label: 'Ordinal weekday', detail: 'First, second, or last weekday' },
    { value: 'yearly', label: 'Selected months', detail: 'Months and calendar days' },
  ];
  readonly scenarios: Scenario[] = [
    { name: 'Biweekly payroll', description: 'Every other Friday, moved earlier around holidays.', config: { name: 'Biweekly payroll', kind: 'weekly', every: 2, weekdays: [4], adjustment: 'previous_weekday', holidays: [`${currentYear}-07-03`, `${currentYear}-12-25`] } },
    { name: 'Month-end billing', description: 'The 31st, clamped in shorter months and moved forward.', config: { name: 'Month-end billing', kind: 'monthly', every: 1, monthDays: [31], overflow: 'clamp', adjustment: 'next_weekday' } },
    { name: 'Maintenance window', description: 'The second Tuesday of every month.', config: { name: 'Maintenance window', kind: 'monthly_weekday', ordinalWeekday: 1, ordinal: 2, every: 1, adjustment: 'none' } },
    { name: 'Quarterly reporting', description: 'The 10th of each quarter with nearest-weekday handling.', config: { name: 'Quarterly reporting', kind: 'yearly', months: [1, 4, 7, 10], monthDays: [10], adjustment: 'nearest_weekday', every: 1 } },
  ];

  ngOnInit(): void {
    const encoded = new URLSearchParams(location.search).get('config');
    if (!encoded) return;
    try { this.setConfig(JSON.parse(decodeURIComponent(escape(atob(encoded)))) as PlaygroundConfig); }
    catch { this.showToast('The shared configuration could not be loaded.'); }
  }

  get result(): GenerationResult { return generate(this.config); }
  get scheduleJson(): string { return JSON.stringify(serializeSchedule(this.config), null, 2); }
  get python(): string { return pythonExample(this.config); }
  get occurrenceSummary(): string {
    const count = this.result.occurrences.length;
    return `${count} occurrence${count === 1 ? '' : 's'} in the selected half-open range`;
  }
  get calendarTitle(): string {
    const [year, month] = this.calendarMonth.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  }
  get calendarCells(): CalendarCell[] {
    const [year, month] = this.calendarMonth.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = (first.getUTCDay() + 6) % 7;
    const byDate = new Map<string, { count: number; adjusted: boolean; included: boolean }>();
    for (const occurrence of this.result.occurrences) {
      const state = byDate.get(occurrence.date) ?? { count: 0, adjusted: false, included: false };
      state.count += 1;
      state.adjusted ||= occurrence.original !== occurrence.date;
      state.included ||= occurrence.source === 'included';
      byDate.set(occurrence.date, state);
    }
    const empty = (): CalendarCell => ({ day: null, date: '', occurrences: 0, adjusted: false, included: false, holiday: false });
    const cells = Array.from({ length: leading }, empty);
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const state = byDate.get(date);
      cells.push({ day, date, occurrences: state?.count ?? 0, adjusted: state?.adjusted ?? false, included: state?.included ?? false, holiday: this.config.holidays.includes(date) });
    }
    while (cells.length % 7) cells.push(empty());
    return cells;
  }

  toggleNumber(target: 'weekdays' | 'months' | 'weekend', value: number): void {
    const values = this.config[target];
    this.config[target] = values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort((a, b) => a - b);
  }
  isSelected(target: 'weekdays' | 'months' | 'weekend', value: number): boolean { return this.config[target].includes(value); }
  updateMonthDays(value: string): void {
    this.config.monthDays = [...new Set(value.split(',').map((part) => Number(part.trim())).filter((item) => Number.isInteger(item) && item >= 1 && item <= 31))].sort((a, b) => a - b);
  }
  syncDateLists(): void {
    this.config.holidays = this.parseDateList(this.holidayText);
    this.config.include = this.parseDateList(this.includeText);
    this.config.exclude = this.parseDateList(this.excludeText);
  }
  loadScenario(scenario: Scenario): void {
    this.setConfig({ ...structuredClone(DEFAULT_CONFIG), ...structuredClone(scenario.config) });
    this.showToast(`${scenario.name} loaded.`);
  }
  changeCalendarMonth(amount: number): void {
    const [year, month] = this.calendarMonth.split('-').map(Number);
    this.calendarMonth = iso(new Date(Date.UTC(year, month - 1 + amount, 1))).slice(0, 7);
  }
  async share(): Promise<void> {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(this.config))));
    const url = `${location.origin}${location.pathname}?config=${encodeURIComponent(encoded)}`;
    history.replaceState(null, '', url);
    await navigator.clipboard.writeText(url);
    this.showToast('Shareable URL copied.');
  }
  exportConfig(): void {
    const blob = new Blob([JSON.stringify(this.config, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'repeatable-dates-playground.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }
  importConfig(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { this.setConfig(JSON.parse(String(reader.result)) as PlaygroundConfig); this.showToast('Configuration imported.'); }
      catch { this.showToast('That file is not a valid playground configuration.'); }
      input.value = '';
    };
    reader.readAsText(file);
  }
  async copyPython(): Promise<void> { await navigator.clipboard.writeText(this.python); this.showToast('Python example copied.'); }
  reset(): void { this.setConfig(structuredClone(DEFAULT_CONFIG)); history.replaceState(null, '', location.pathname); this.showToast('Playground reset.'); }
  trackDate(_: number, item: { date: string; original: string; source: string }): string { return `${item.date}-${item.original}-${item.source}`; }

  private setConfig(value: PlaygroundConfig): void {
    this.config = { ...structuredClone(DEFAULT_CONFIG), ...value };
    this.holidayText = this.config.holidays.join('\n');
    this.includeText = this.config.include.join('\n');
    this.excludeText = this.config.exclude.join('\n');
    this.calendarMonth = (this.config.rangeStart || this.config.start).slice(0, 7);
  }
  private parseDateList(value: string): string[] { return [...new Set(value.split(/[\s,]+/).map((part) => part.trim()).filter((part) => parseIso(part)))].sort(); }
  private showToast(message: string): void { this.toast = message; window.setTimeout(() => { if (this.toast === message) this.toast = ''; }, 2600); }
}
