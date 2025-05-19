import { Routes, PreloadAllModules } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
  { 
    path: 'knowledge_base', 
    loadComponent: () => import('./knowledge-base/knowledge-base.component').then(m => m.KnowledgeBaseComponent),
    data: { preload: true }
  },
  { path: 'chat', loadComponent: () => import('./chat/chat.component').then(m => m.ChatComponent) },
  { path: 'settings_base', loadComponent: () => import('./settings-base/settings-base.component').then(m => m.SettingsBaseComponent) },
  { path: 'settings_system', loadComponent: () => import('./settings-system/settings-system.component').then(m => m.SettingsSystemComponent) },
  { path: '**', redirectTo: '', pathMatch: 'full' }
];
