import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal, viewChild } from '@angular/core';
import { Api } from '@gh/core';

export interface Skill {
  id: number;
  name: string;
}

let uid = 0;

/** Typeahead multi-select over the controlled skill taxonomy (GET /meta/skills). */
@Component({
  selector: 'gh-skill-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker" (click)="box()?.nativeElement.focus()">
      @for (s of value(); track s.id) {
        <span class="chip active">{{ s.name }}
          <button type="button" class="x" (click)="remove(s); $event.stopPropagation()" [attr.aria-label]="'Remove ' + s.name">×</button>
        </span>
      }
      @if (value().length < max()) {
        <input #box class="picker-input" [id]="inputId()" role="combobox" autocomplete="off" [attr.aria-expanded]="open()"
          [attr.aria-controls]="listId" [placeholder]="value().length ? 'Add more…' : placeholder()"
          (input)="onType($any($event.target).value)" (focus)="open.set(true); onType(query())" (blur)="close()"
          (keydown)="key($event)" [value]="query()" />
      }
    </div>
    @if (open() && results().length) {
      <ul class="menu list-reset options" [id]="listId" role="listbox">
        @for (r of results(); track r.id; let i = $index) {
          <li role="option" [attr.aria-selected]="i === active()" class="menu-item" [class.hl]="i === active()"
              (mousedown)="$event.preventDefault(); add(r)">{{ r.name }}</li>
        }
      </ul>
    }
    <span class="hint">{{ value().length }}/{{ max() }} skills</span>`,
  styles: `
    :host { position: relative; display: block; }
    .picker { display: flex; flex-wrap: wrap; gap: 6px; min-height: 42px; padding: 6px 8px; background: var(--surface);
      border: 1px solid var(--border-strong); border-radius: var(--radius-sm); cursor: text; }
    .picker:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-tint); }
    .picker-input { flex: 1; min-width: 140px; border: 0; outline: 0; background: none; color: var(--text); font: inherit; padding: 4px; }
    .options { left: 0; right: 0; top: calc(100% - 18px); max-height: 260px; overflow: auto; }
    .hl { background: var(--surface-hover); }
    .hint { display: block; margin-top: 4px; font-size: var(--fs-caption); color: var(--text-muted); }`,
})
export class SkillPickerComponent {
  private readonly api = inject(Api);
  readonly value = model<Skill[]>([]);
  readonly max = input(15);
  readonly placeholder = input('Type a skill, e.g. Python');
  readonly inputId = input(`skill-${++uid}`);
  protected readonly listId = `skill-list-${uid}`;
  protected readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  private readonly found = signal<Skill[]>([]);
  protected readonly results = computed(() => this.found().filter((f) => !this.value().some((v) => v.id === f.id)).slice(0, 10));
  private timer?: ReturnType<typeof setTimeout>;

  onType(q: string) {
    this.query.set(q);
    this.active.set(0);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => this.found.set(await this.api.get<Skill[]>('/meta/skills', { q: q.trim() })), 150);
  }
  add(s: Skill) {
    if (this.value().length >= this.max()) return;
    this.value.update((v) => [...v, { id: s.id, name: s.name }]);
    this.query.set('');
    this.onType('');
  }
  remove(s: Skill) {
    this.value.update((v) => v.filter((x) => x.id !== s.id));
  }
  close() {
    setTimeout(() => this.open.set(false), 120);
  }
  key(e: KeyboardEvent) {
    const n = this.results().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set((this.active() + 1) % Math.max(n, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set((this.active() - 1 + n) % Math.max(n, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.results()[this.active()]; if (r) this.add(r); }
    else if (e.key === 'Backspace' && !this.query() && this.value().length) this.remove(this.value()[this.value().length - 1]);
    else if (e.key === 'Escape') this.open.set(false);
  }
}

/** Free-text tags with suggestions (cities, degrees). Enter or comma adds. */
@Component({
  selector: 'gh-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker">
      @for (t of value(); track t) {
        <span class="chip active">{{ t }}<button type="button" class="x" (click)="remove(t)" [attr.aria-label]="'Remove ' + t">×</button></span>
      }
      @if (value().length < max()) {
        <input class="picker-input" [id]="inputId()" [attr.list]="listId" [placeholder]="placeholder()" [value]="text()"
          (input)="text.set($any($event.target).value)" (keydown)="key($event)" (blur)="commit()" autocomplete="off" />
        <datalist [id]="listId">@for (s of suggestions(); track s) { <option [value]="s"></option> }</datalist>
      }
    </div>`,
  styles: `
    .picker { display: flex; flex-wrap: wrap; gap: 6px; min-height: 42px; padding: 6px 8px; background: var(--surface);
      border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
    .picker:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-tint); }
    .picker-input { flex: 1; min-width: 120px; border: 0; outline: 0; background: none; color: var(--text); font: inherit; padding: 4px; }`,
})
export class TagInputComponent {
  readonly value = model<string[]>([]);
  readonly suggestions = input<string[]>([]);
  readonly max = input(10);
  readonly placeholder = input('Type and press Enter');
  readonly inputId = input(`tag-${++uid}`);
  protected readonly listId = `tags-${uid}`;
  protected readonly text = signal('');

  key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); this.commit(); }
    else if (e.key === 'Backspace' && !this.text() && this.value().length) this.remove(this.value()[this.value().length - 1]);
  }
  commit() {
    const t = this.text().trim().replace(/,$/, '');
    if (t && !this.value().some((v) => v.toLowerCase() === t.toLowerCase()) && this.value().length < this.max()) {
      this.value.update((v) => [...v, t]);
    }
    this.text.set('');
  }
  remove(t: string) {
    this.value.update((v) => v.filter((x) => x !== t));
  }
}
