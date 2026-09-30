import { ApplicationConfig } from '@angular/core';
import { provideGenZHire } from '@gh/core';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: provideGenZHire('recruiter', routes),
};
