import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmHostComponent, ToastHostComponent } from '@gh/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHostComponent, ConfirmHostComponent],
  template: `<router-outlet /><gh-toasts /><gh-confirm-host />`,
})
export class App {}
