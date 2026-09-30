import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, HostListener, Injectable, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, Loader } from '@gh/core';
import { EmptyStateComponent, SkeletonComponent } from './bits';
import { IconComponent } from './icon';

// ------------------------------------------------------------------ page state

@Component({
  selector: 'gh-page-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkeletonComponent, EmptyStateComponent],
  template: `
    @switch (state().status()) {
      @case ('loading') { <gh-skeleton [variant]="skeleton()" [count]="skeleton() === 'cards' ? 6 : 6" /> }
      @case ('empty') {
        <div class="card"><gh-empty [title]="emptyTitle()" [text]="emptyText()" [icon]="emptyIcon()"><ng-content select="[empty]" /></gh-empty></div>
      }
      @case ('forbidden') {
        <div class="card"><gh-empty icon="lock" title="You don't have access to this" text="Ask your company admin if you need access." /></div>
      }
      @case ('notfound') {
        <div class="card"><gh-empty icon="search" title="Not found" text="It may have been removed, or it isn't visible to you." /></div>
      }
      @case ('error') {
        <div class="card">
          <gh-empty icon="alert" title="Something went wrong" [text]="state().error()?.message ?? null">
            <button class="btn btn-secondary" type="button" (click)="state().reload()">Try again</button>
          </gh-empty>
          @if (state().error()?.requestId) { <p class="caption" style="text-align:center">Reference: {{ state().error()?.requestId }}</p> }
        </div>
      }
      @default { <ng-content /> }
    }`,
})
export class PageStateComponent {
  readonly state = input.required<Loader<unknown>>();
  readonly skeleton = input<'table' | 'cards' | 'detail'>('detail');
  readonly emptyTitle = input('Nothing here yet');
  readonly emptyText = input<string | null>(null);
  readonly emptyIcon = input('inbox');
}

// ---------------------------------------------------------------------- toasts

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private id = 0;

  show(kind: Toast['kind'], text: string) {
    const t = { id: ++this.id, kind, text };
    this.toasts.update((l) => [...l.slice(-2), t]);
    if (kind !== 'error') setTimeout(() => this.dismiss(t.id), 5000);
  }
  success = (text: string) => this.show('success', text);
  info = (text: string) => this.show('info', text);
  /** Accepts an ApiError / unknown error and shows its human message. */
  error = (e: unknown) => this.show('error', typeof e === 'string' ? e : ApiError.from(e).message);
  dismiss(id: number) {
    this.toasts.update((l) => l.filter((t) => t.id !== id));
  }
}

@Component({
  selector: 'gh-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of svc.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast-' + t.kind" [attr.role]="t.kind === 'error' ? 'alert' : 'status'">
          <gh-icon [name]="t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'" [size]="16" />
          <span class="grow">{{ t.text }}</span>
          <button class="btn btn-ghost btn-sm btn-icon" type="button" (click)="svc.dismiss(t.id)" aria-label="Dismiss"><gh-icon name="x" [size]="14" /></button>
        </div>
      }
    </div>`,
  styles: `
    .toasts { position: fixed; right: 16px; bottom: 16px; z-index: 200; display: flex; flex-direction: column; gap: 8px; width: min(380px, calc(100vw - 32px)); }
    .toast { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: var(--radius-md);
      background: var(--surface-raised); border: 1px solid var(--border); box-shadow: var(--shadow-2); animation: rise var(--dur-base) var(--ease); }
    .toast-success gh-icon { color: var(--success); } .toast-error gh-icon { color: var(--danger); } .toast-info gh-icon { color: var(--primary); }
    @media (max-width: 767px) { .toasts { bottom: auto; top: 12px; right: 16px; } }`,
})
export class ToastHostComponent {
  protected readonly svc = inject(ToastService);
}

// --------------------------------------------------------------------- confirm

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText: string;
  tone?: 'primary' | 'danger';
  /** When set, the dialog collects a free-text reason (required unless reasonOptional). */
  reasonLabel?: string;
  reasonOptional?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<(ConfirmOptions & { resolve: (v: { ok: boolean; reason: string }) => void }) | null>(null);

  /** Resolves ok=false on cancel. The viewer blocks native confirm(), so this is our only confirmation UI. */
  ask(o: ConfirmOptions): Promise<{ ok: boolean; reason: string }> {
    return new Promise((resolve) => this.current.set({ ...o, resolve }));
  }
  async confirm(o: ConfirmOptions) {
    return (await this.ask(o)).ok;
  }
  close(ok: boolean, reason = '') {
    this.current()?.resolve({ ok, reason });
    this.current.set(null);
  }
}

@Component({
  selector: 'gh-confirm-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, FormsModule],
  template: `
    @if (svc.current(); as c) {
      <div class="overlay" (click)="svc.close(false)">
        <div class="modal modal-sm" role="alertdialog" aria-modal="true" [attr.aria-label]="c.title" cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (click)="$event.stopPropagation()">
          <div class="modal-head"><h3>{{ c.title }}</h3>@if (c.message) { <p>{{ c.message }}</p> }</div>
          @if (c.reasonLabel) {
            <div class="modal-body field">
              <label for="gh-confirm-reason">{{ c.reasonLabel }}</label>
              <textarea id="gh-confirm-reason" class="textarea" [(ngModel)]="reason" maxlength="1000"></textarea>
            </div>
          } @else { <div style="height:20px"></div> }
          <div class="modal-foot">
            <button class="btn btn-secondary" type="button" (click)="svc.close(false)">Cancel</button>
            <button class="btn" [class.btn-danger]="c.tone === 'danger'" [class.btn-primary]="c.tone !== 'danger'" type="button"
              [disabled]="!!c.reasonLabel && !c.reasonOptional && reason.trim().length < 3" (click)="done()">{{ c.confirmText }}</button>
          </div>
        </div>
      </div>
    }`,
})
export class ConfirmHostComponent {
  protected readonly svc = inject(ConfirmService);
  protected reason = '';
  protected done() {
    const r = this.reason;
    this.reason = '';
    this.svc.close(true, r);
  }
  @HostListener('document:keydown.escape') esc() {
    if (this.svc.current()) this.svc.close(false);
  }
}

// ---------------------------------------------------------------- modal/drawer

@Component({
  selector: 'gh-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule],
  template: `
    @if (open()) {
      <div class="overlay" (click)="closed.emit()">
        <div class="modal" [class.modal-lg]="size() === 'lg'" [class.modal-sm]="size() === 'sm'" role="dialog" aria-modal="true"
             [attr.aria-label]="title()" cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (click)="$event.stopPropagation()">
          <div class="modal-head"><h3>{{ title() }}</h3>@if (subtitle()) { <p>{{ subtitle() }}</p> }</div>
          <div class="modal-body"><ng-content /></div>
          <div class="modal-foot"><ng-content select="[footer]" /></div>
        </div>
      </div>
    }`,
})
export class ModalComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly closed = output<void>();
  @HostListener('document:keydown.escape') esc() {
    if (this.open()) this.closed.emit();
  }
}

@Component({
  selector: 'gh-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, IconComponent],
  template: `
    @if (open()) {
      <div class="overlay drawer-overlay" (click)="closed.emit()">
        <aside class="drawer" role="dialog" aria-modal="true" [attr.aria-label]="title()" cdkTrapFocus [cdkTrapFocusAutoCapture]="true" (click)="$event.stopPropagation()">
          <div class="drawer-head">
            <h3 class="truncate">{{ title() }}</h3>
            <button class="btn btn-ghost btn-icon" type="button" (click)="closed.emit()" aria-label="Close"><gh-icon name="x" /></button>
          </div>
          <div class="drawer-body"><ng-content /></div>
        </aside>
      </div>
    }`,
})
export class DrawerComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly closed = output<void>();
  @HostListener('document:keydown.escape') esc() {
    if (this.open()) this.closed.emit();
  }
}
